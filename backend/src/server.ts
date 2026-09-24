import express from "express";
import cors from "cors";
import type { TownSnapshot, Resident } from "@hermesbook/shared";
import { Hc, rf, encodeGenes } from "@hermesbook/shared";
import { saveAtomically, saveDebounced } from "./persist.js";
import { createInitialWorld, makeResidentFromFork, generateEdition, generateWeatherEvent } from "./world.js";
import { loadWithRecovery } from "./persist.js";
import { LOCATIONS, LOCATION_BY_ID } from "./locations.js";
import { spend } from "./spend.js";
import { createBrain } from "./brain.js";
import { createScheduler } from "./scheduler.js";
import { runTurn } from "./turn.js";
import { z } from "zod";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

function resolveDataPath(): string {
  if (process.env.DATA_PATH) return process.env.DATA_PATH;
  // Try cwd/data/town.json (when running from project root)
  if (existsSync("data/town.json") || existsSync(path.join(process.cwd(), "data/town.json"))) {
    return path.join(process.cwd(), "data/town.json");
  }
  // Fallback: relative to this file (backend/src -> ../../data)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../data/town.json");
}

const DATA_PATH = resolveDataPath();

// Load or create world
let world: TownSnapshot;
try {
  const loaded = await loadWithRecovery(DATA_PATH) as TownSnapshot;
  // minimal validation
  if (loaded && Array.isArray(loaded.herd) && loaded.config) world = loaded;
  else world = createInitialWorld();
} catch {
  world = createInitialWorld();
}

const brain = createBrain();
const scheduler = createScheduler(world.herd.map((h) => h.id));

const app: import("express").Express = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

// Rate limit in-memory for fork per IP per hour
const forkRate = new Map<string, number[]>();
function checkRateLimit(ip: string, max = 6, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  const arr = forkRate.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  forkRate.set(ip, recent);
  return true;
}

// SSE clients
const clients = new Set<import("express").Response>();

function broadcast(msg: unknown): void {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {}
  }
}

// GET /api/snapshot
app.get("/api/snapshot", (_req, res) => {
  res.json({ ...world, now: Date.now() });
});

// GET /api/stream SSE
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(": open\n\n");
  clients.add(res);
  // ping every 25s
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch {}
  }, 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
    try { res.end(); } catch {}
  });
});

// POST /api/fork
const forkSchema = z.object({
  parent: z.string().min(1),
  name: z.string().min(1).max(32),
  bio: z.string().max(180).optional().default(""),
  traits: z.array(z.string()).max(3).optional().default([]),
  job: z.string().optional().default("herder"),
});

app.post("/api/fork", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "rate limited, try again later" });
    return;
  }

  const parsed = forkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { parent, name, bio, traits, job } = parsed.data;

  if (world.herd.length >= world.config.maxHerd) {
    res.status(400).json({ error: "the pasture is full" });
    return;
  }

  const parentResident = world.herd.find((h) => h.id === parent);
  if (!parentResident) {
    res.status(400).json({ error: "parent not found" });
    return;
  }

  const nameExists = world.herd.some((h) => h.name.toLowerCase() === name.toLowerCase());
  if (nameExists) {
    res.status(400).json({ error: "name already taken" });
    return;
  }

  // moderate: no control chars
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(name + bio)) {
    res.status(400).json({ error: "invalid characters" });
    return;
  }

  // genetics
  const parentGenes = Hc(parentResident.genes);
  const childGenes = rf(parentGenes, name);
  const childGenesStr = encodeGenes(childGenes);

  const child: Resident = makeResidentFromFork(parentResident, name, bio, traits, job, childGenesStr);
  world.herd.push(child);
  parentResident.forks = (parentResident.forks ?? 0) + 1;
  world.now = Date.now();

  // atomic flush immediate per 01:142
  try {
    await saveAtomically(DATA_PATH, world);
  } catch (e) {
    console.error("save failed", e);
    // rollback in-memory
    world.herd = world.herd.filter((h) => h.id !== child.id);
    parentResident.forks--;
    res.status(500).json({ error: "persist failed" });
    return;
  }

  scheduler.add(child.id);

  // broadcast via SSE
  broadcast({ type: "llama", llama: child });
  broadcast({ type: "herd", herd: world.herd });

  res.json(child);
});

// GET /api/treasury (Base adaptation, cache 60s)
let treasuryCache: { data: unknown; at: number } | null = null;
app.get("/api/treasury", (_req, res) => {
  const now = Date.now();
  if (treasuryCache && now - treasuryCache.at < 60_000) {
    res.json(treasuryCache.data);
    return;
  }
  const data = {
    address: world.config.tokenAddress,
    chainName: world.config.chainName,
    network: world.config.network,
    sol: 6.00473291,
    solUsd: 119.2,
    usd: 715.764162872,
    updated: now,
  };
  treasuryCache = { data, at: now };
  res.json(data);
});

// GET /api/status
app.get("/api/status", (_req, res) => {
  res.json({
    brain: world.config.brain,
    herd: world.herd.length,
    feed: world.feed.length,
    spend: { dayKey: spend.dayKey, usd: spend.usd, calls: spend.calls, cap: spend.cap },
    llm: { calls: spend.calls, failures: spend.failures, promptTokens: spend.promptTokens, completionTokens: spend.completionTokens, lastError: spend.lastError },
  });
});

// health
app.get("/api/health", (_req, res) => res.json({ ok: true, now: Date.now() }));

// Turn scheduler interval (18s per doc demo; prod faster for testing 4s)
const TURN_MS = Number(process.env.TURN_MS ?? 1800);
let turnTimer: ReturnType<typeof setInterval> | null = null;
let turnCount = 0;
function startScheduler(): void {
  if (turnTimer) clearInterval(turnTimer);
  turnTimer = setInterval(async () => {
    const id = scheduler.next();
    if (!id) return;
    const result = await runTurn(world, id, brain);
    if (!result || !result.order) return;
    turnCount++;
    broadcast(result.order);
    if (result.spit) broadcast(result.spit);
    if (result.post && Date.now() - result.post.t < 3000) {
      broadcast({ type: "post", post: result.post });
      // Also push bubble via post SSE will trigger frontend; order already moves agent
    } else if (world.feed.length > 0) {
      const latest = world.feed[0]!;
      if (Date.now() - latest.t < 2500 && latest.id === result.post?.id) {
        // already broadcast
      } else if (Date.now() - latest.t < 2500) {
        broadcast({ type: "post", post: latest });
      }
    }

    // Weather events: 2% per turn (~one per ~50 turns), or ~30 per day
    if (Math.random() < 0.02) {
      const ev = generateWeatherEvent();
      world.events.push(ev);
      if (world.events.length > 120) world.events.shift();
      broadcast({ type: "event", event: ev });
    }

    // Daily Spit edition: every 60 turns (~108s at 1.8s tick) ~ 8-9 editions per dayLength 900s if tick 1.8s: 500 turns per day, but we publish every 60 for demo
    // Also publish when day wraps for realism
    if (turnCount % 60 === 0) {
      const edition = generateEdition(world);
      world.editions.unshift(edition);
      if (world.editions.length > 20) world.editions.length = 20;
      broadcast({ type: "edition", edition });
    }

    // debounced save for routine ticks
    saveDebounced(DATA_PATH, world);
  }, TURN_MS);
  // allow process to exit in tests
  if (turnTimer && typeof (turnTimer as NodeJS.Timeout).unref === "function") (turnTimer as NodeJS.Timeout).unref();
}

function stopScheduler(): void {
  if (turnTimer) clearInterval(turnTimer);
  turnTimer = null;
}

// Do not auto-start in test env (vitest sets NODE_ENV=test)
if (process.env.NODE_ENV !== "test") startScheduler();

export { app, world, broadcast, scheduler, brain, startScheduler, stopScheduler, DATA_PATH };
