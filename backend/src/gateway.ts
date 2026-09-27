import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { TownSnapshot, Resident, AgentRecord, Post } from "@hermesbook/shared";
import { z } from "zod";
import {
  joinWorld,
  rollbackJoin,
  verifyToken,
  touch,
  isAfk,
  rateLimitAct,
  AgentError,
} from "./agents.js";
import { applyDecision } from "./turn.js";
import { postToBoard, getBoardsForWorld, getThreads } from "./bbs.js";
import { dayClock } from "./needs.js";
import { LOCATION_BY_ID } from "./locations.js";
import { claimQuest, updateQuestProgress } from "./quests.js";
import { saveAtomically, saveDebounced } from "./persist.js";

export interface GatewayContext {
  world: TownSnapshot;
  broadcast: (msg: unknown) => void;
  DATA_PATH: string;
  /** optional: register newly joined residents so the sim can take over when AFK */
  scheduler?: { add(id: string): void };
}

interface AgentContext {
  record: AgentRecord;
  resident: Resident;
}
type AgentRequest = Request & { agent?: AgentContext };

// same moderation regex as /api/fork (server.ts)
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

// join rate limit: 6/hour/IP (own Map, same pattern as forkRate in server.ts)
const joinRate = new Map<string, number[]>();
function rateLimitJoin(ip: string, max = 6, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  const arr = joinRate.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  joinRate.set(ip, recent);
  return true;
}

function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
}

const joinSchema = z.object({
  name: z.string().min(1).max(32),
  bio: z.string().max(180).optional().default(""),
  job: z.string().max(32).optional().default("herder"),
  traits: z.array(z.string().max(32)).max(3).optional().default([]),
  parent: z.string().max(64).optional(),
  origin: z.string().max(64).optional().default("unknown"),
});

const actSchema = z.object({
  act: z.string().min(1).max(32),
  place: z.string().max(64).optional(),
  speech: z.string().max(280).optional(),
  targetId: z.string().max(64).optional(),
  replyTo: z.string().max(64).optional(),
  why: z.string().max(280).optional(),
  board: z.string().max(64).optional(),
});

const saySchema = z.object({
  text: z.string().min(1).max(280),
  replyTo: z.string().max(64).optional(),
  targetId: z.string().max(64).optional(),
  board: z.string().max(64).optional(),
});

/** express 4 does not catch async rejections — funnel them to a 500 */
function asyncH(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error("gateway error", err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    });
  };
}

export function createGatewayRouter(ctx: GatewayContext): express.Router {
  const { world, broadcast, DATA_PATH, scheduler } = ctx;
  const router = express.Router();

  function requireAgentMw(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const record = token ? verifyToken(world, token) : null;
    if (!record) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const resident = world.herd.find((h) => h.id === record.residentId);
    if (!resident) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as AgentRequest).agent = { record, resident };
    next();
  }

  function agentOf(req: Request): AgentContext {
    const ctx2 = (req as AgentRequest).agent;
    if (!ctx2) throw new Error("requireAgent did not run");
    return ctx2;
  }

  // ---- join (no auth, 6/hour/IP) ----
  router.post(
    "/api/agent/join",
    asyncH(async (req, res) => {
      if (!rateLimitJoin(clientIp(req))) {
        res.status(429).json({ error: "rate limited, try again later" });
        return;
      }
      const parsed = joinSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
        return;
      }
      let joined: { agentId: string; token: string; resident: Resident };
      try {
        joined = joinWorld(world, parsed.data);
      } catch (e) {
        if (e instanceof AgentError) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        throw e;
      }
      try {
        await saveAtomically(DATA_PATH, world);
      } catch (e) {
        console.error("save failed", e);
        rollbackJoin(world, joined.agentId, joined.resident.id, joined.resident.parent);
        res.status(500).json({ error: "persist failed" });
        return;
      }
      scheduler?.add(joined.resident.id);
      broadcast({ type: "llama", llama: joined.resident });
      broadcast({ type: "herd", herd: world.herd });
      res.json({ agentId: joined.agentId, token: joined.token, resident: joined.resident });
    })
  );

  // ---- resume: acknowledge session, refresh activity clock ----
  router.post("/api/agent/resume", requireAgentMw, (req, res) => {
    const { record, resident } = agentOf(req);
    touch(record);
    saveDebounced(DATA_PATH, world);
    res.json({
      agentId: record.id,
      residentId: record.residentId,
      origin: record.origin,
      joinedAt: record.joinedAt,
      lastActAt: record.lastActAt,
      resident,
      clock: dayClock(Date.now(), 900),
      now: Date.now(),
    });
  });

  // ---- me ----
  router.get("/api/agent/me", requireAgentMw, (req, res) => {
    const { record, resident } = agentOf(req);
    res.json({
      agentId: record.id,
      residentId: record.residentId,
      origin: record.origin,
      joinedAt: record.joinedAt,
      lastActAt: record.lastActAt,
      isAfk: isAfk(record),
      resident,
    });
  });

  // ---- perceive: everything an external agent needs to decide ----
  router.get("/api/agent/perceive", requireAgentMw, (req, res) => {
    const { record, resident } = agentOf(req);
    const nearby = world.herd
      .filter((h) => h.id !== resident.id && h.mind.doing.place === resident.mind.doing.place)
      .map((h) => ({
        id: h.id,
        name: h.name,
        handle: h.handle,
        job: h.job,
        gen: h.gen,
        act: h.mind.doing.act,
        placeName: h.mind.doing.placeName,
        spirits: h.mind.spirits,
        relationship: resident.mind.relationships[h.id] ?? 0,
      }));
    res.json({
      self: {
        agentId: record.id,
        origin: record.origin,
        joinedAt: record.joinedAt,
        lastActAt: record.lastActAt,
        afk: isAfk(record),
        resident,
      },
      nearby,
      feed: world.feed.slice(0, 40),
      events: world.events.slice(-30),
      quests: world.quests,
      boards: getBoardsForWorld(world),
      clock: dayClock(Date.now(), 900),
      now: Date.now(),
    });
  });

  // ---- act (Bearer, 30/min) ----
  router.post("/api/agent/act", requireAgentMw, asyncH(async (req, res) => {
    const { record, resident } = agentOf(req);
    const token = (req.headers.authorization ?? "").slice(7).trim();
    if (!rateLimitAct(token)) {
      res.status(429).json({ error: "rate limited" });
      return;
    }
    const parsed = actSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
      return;
    }
    const { act, place, speech, targetId, replyTo, why, board } = parsed.data;
    if ((speech && CONTROL_CHARS.test(speech)) || (why && CONTROL_CHARS.test(why))) {
      res.status(400).json({ error: "invalid characters" });
      return;
    }

    // invalid place falls back to current position (same rule as turn.ts)
    const placeOk = place && LOCATION_BY_ID.has(place) ? place : resident.mind.doing.place;
    if (board && !getBoardsForWorld(world).some((b) => b.id === board)) {
      res.status(400).json({ error: "unknown board" });
      return;
    }

    // Needs are not frozen: advance them by the real time since the last decision (cap 600s).
    // applyDecision owns the needs tick (opts.secs), so the act delta is applied exactly ONCE —
    // ticking here as well would double-apply it.
    const secs = Math.min(600, Math.max(0, (Date.now() - resident.mind.doing.since) / 1000));

    const result = applyDecision(
      world,
      resident,
      { act, place: placeOk, reason: why ?? "answered from outside", speech, targetId: targetId ?? null },
      { replyTo: replyTo ?? null, board, secs }
    );
    broadcast(result.order);
    if (result.spit) broadcast(result.spit);
    if (result.post) broadcast({ type: "post", post: result.post });
    touch(record);
    // external agents count toward town quests exactly like sim turns do
    const updatedQuests = updateQuestProgress(world, { act, place: result.order.place, agentId: resident.id, postKind: result.post?.kind });
    for (const q of updatedQuests) broadcast({ type: "quest", quest: q });
    await saveAtomically(DATA_PATH, world);
    res.json({ ok: true, order: result.order, post: result.post ?? null, doing: resident.mind.doing, needs: resident.needs });
  }));

  // ---- say (Bearer, 30/min) ----
  router.post("/api/agent/say", requireAgentMw, asyncH(async (req, res) => {
    const { record, resident } = agentOf(req);
    const token = (req.headers.authorization ?? "").slice(7).trim();
    if (!rateLimitAct(token)) {
      res.status(429).json({ error: "rate limited" });
      return;
    }
    const parsed = saySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
      return;
    }
    const { text, replyTo, board } = parsed.data;
    if (CONTROL_CHARS.test(text)) {
      res.status(400).json({ error: "invalid characters" });
      return;
    }
    // a post stamped with an unknown board would fall out of every board view (bbs.ts)
    if (board && !getBoardsForWorld(world).some((b) => b.id === board)) {
      res.status(400).json({ error: "unknown board" });
      return;
    }
    const post: Post = {
      id: "p" + Math.random().toString(36).slice(2, 10),
      t: Date.now(),
      by: resident.id,
      name: resident.name,
      handle: resident.handle,
      text,
      kind: replyTo ? "reply" : "post",
      replyTo: replyTo ?? null,
    };
    postToBoard(world, post, board ?? "general");
    broadcast({ type: "post", post });
    touch(record);
    const updatedQuests = updateQuestProgress(world, { act: "talk", place: resident.mind.doing.place, agentId: resident.id, postKind: post.kind });
    for (const q of updatedQuests) broadcast({ type: "quest", quest: q });
    await saveAtomically(DATA_PATH, world);
    res.json({ ok: true, post });
  }));

  // ---- claim quest (Bearer) ----
  router.post(
    "/api/agent/quests/:id/claim",
    requireAgentMw,
    asyncH(async (req, res) => {
      agentOf(req);
      const result = claimQuest(world, req.params.id);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      broadcast({ type: "quest", quest: result.quest });
      broadcast({ type: "herd", herd: world.herd });
      try {
        await saveAtomically(DATA_PATH, world);
      } catch (e) {
        console.error("save failed", e);
      }
      res.json(result.quest);
    })
  );

  // ---- delta events since cursor ----
  router.get("/api/agent/events", requireAgentMw, (req, res) => {
    agentOf(req);
    const since = Number(req.query.since ?? 0) || 0;
    const events = world.events.filter((e) => e.t >= since);
    const posts = world.feed.filter((p) => p.t >= since);
    res.json({ events, posts, cursor: Date.now() });
  });

  // ---- public boards ----
  router.get("/api/boards", (_req, res) => {
    res.json(getBoardsForWorld(world));
  });

  router.get("/api/boards/:id", (req, res) => {
    const board = getBoardsForWorld(world).find((b) => b.id === req.params.id);
    if (!board) {
      res.status(404).json({ error: "board not found" });
      return;
    }
    res.json({ board, threads: getThreads(world, req.params.id) });
  });

  return router;
}
