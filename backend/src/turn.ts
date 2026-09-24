import type { TownSnapshot } from "@hermesbook/shared";
import type { Brain } from "./brain.js";
import { decide as simDecide } from "./simbrain.js";
import { tickNeeds, dayClock } from "./needs.js";
import { LOCATION_BY_ID } from "./locations.js";

export interface OrderEvent {
  type: "order";
  id: string;
  act: string;
  place: string;
  secs: number;
}

export interface SpitEvent {
  type: "spit";
  from: string;
  to: string;
}

const SECS = 18;

export async function runTurn(
  world: TownSnapshot,
  agentId: string,
  brain?: Brain
): Promise<{ order: OrderEvent | null; spit?: SpitEvent; post?: TownSnapshot["feed"][number] }> {
  const agent = world.herd.find((h) => h.id === agentId);
  if (!agent) return { order: null };

  // Read phase: gather enriched context - instinct + social
  const clock = dayClock(Date.now(), 900);
  const rng = () => Math.random();
  const nearbyIds = world.herd.filter((h) => h.id !== agentId && h.mind.doing.place === agent.mind.doing.place).map((h) => h.id);
  const nearbyDetailed = world.herd
    .filter((h) => nearbyIds.includes(h.id))
    .map((h) => ({ id: h.id, name: h.name, handle: h.handle, relationship: agent.mind.relationships[h.id] ?? 0 }));

  const ctx: Parameters<Brain["decide"]>[0] = {
    needs: { ...agent.needs },
    clock,
    location: agent.mind.doing.place,
    nearbyAgents: nearbyIds,
    rng,
    self: {
      id: agent.id,
      name: agent.name,
      traits: agent.traits,
      job: agent.job,
      obsession: agent.mind.obsession,
      spirits: agent.mind.spirits,
      memories: agent.mind.memories,
      relationships: agent.mind.relationships,
    },
    nearbyDetailed,
    world: {
      feed: world.feed.slice(0, 20),
      events: world.events.slice(-10),
      projects: world.projects,
    },
  } as any;

  // Decide phase - instinct-driven
  const decision = brain ? await brain.decide(ctx as any) : simDecide(ctx as any);
  // fallback: if brain returned without speech fields, ensure typed
  const decisionAny = decision as any;

  // Validate place
  const placeOk = LOCATION_BY_ID.has(decision.place);
  const place = placeOk ? decision.place : agent.mind.doing.place;
  const loc = LOCATION_BY_ID.get(place);
  const placeName = loc ? loc.name.toLowerCase() : place;

  // Move & Apply: update needs and mind
  agent.needs = tickNeeds(agent.needs, decision.act, SECS);
  // mood drift for spit
  if (decision.act === "spit") agent.mind.spirits = Math.max(-1, agent.mind.spirits - 0.2);
  // small spirits drift for social positive
  if (decision.act === "talk" || decision.act === "wander" || decision.act === "stroll") {
    if (nearbyDetailed.length > 0) agent.mind.spirits = Math.min(1, agent.mind.spirits + 0.04);
  }
  if (decision.act === "argue") agent.mind.spirits = Math.max(-1, agent.mind.spirits - 0.06);

  let createdPost: TownSnapshot["feed"][number] | undefined;
  let spitEvent: SpitEvent | undefined;

  // --- Chat / obrolan sesama: realistic conversation threading ---
  if (decision.speech) {
    let replyTo: string | null = null;
    let targetId: string | null = decisionAny.targetId ?? null;

    // 55% chance to reply to recent post from nearby agent (conversation threading)
    if (nearbyIds.length > 0 && rng() < 0.55) {
      const recentFromNearby = world.feed.slice(0, 12).find((p) => nearbyIds.includes(p.by) && p.by !== agent.id);
      if (recentFromNearby) {
        replyTo = recentFromNearby.id;
        if (!targetId) targetId = recentFromNearby.by;
      }
    } else if (world.feed.length > 0 && rng() < 0.18) {
      // occasional reply to any recent feed (gossip)
      const recent = world.feed[Math.floor(rng() * Math.min(5, world.feed.length))];
      if (recent && recent.by !== agent.id) {
        replyTo = recent.id;
        if (!targetId) targetId = recent.by;
      }
    }

    // If we have targetId but no replyTo, try to find any thread from target
    if (targetId && !replyTo && rng() < 0.35) {
      const fromTarget = world.feed.slice(0, 8).find((p) => p.by === targetId);
      if (fromTarget) replyTo = fromTarget.id;
    }

    const isReply = !!replyTo;
    const post: TownSnapshot["feed"][number] = {
      id: "p" + Math.random().toString(36).slice(2, 10),
      t: Date.now(),
      by: agent.id,
      name: agent.name,
      handle: agent.handle,
      text: decision.speech,
      kind: (isReply ? "reply" : "post") as TownSnapshot["feed"][number]["kind"],
      replyTo,
    };
    world.feed.unshift(post);
    if (world.feed.length > 400) world.feed.length = 400;
    agent.mind.memories.unshift(decision.speech.slice(0, 80));
    if (agent.mind.memories.length > 12) agent.mind.memories.length = 12;
    createdPost = post;

    // Relationship update on chat — instinct social bonding
    if (targetId) {
      const target = world.herd.find((h) => h.id === targetId);
      if (target) {
        const delta = decision.act === "argue" ? -0.07 : decision.act === "talk" ? 0.06 : isReply ? 0.04 : 0.02;
        agent.mind.relationships[targetId] = Math.max(-1, Math.min(1, (agent.mind.relationships[targetId] ?? 0) + delta));
        // reciprocal small
        target.mind.relationships[agent.id] = Math.max(-1, Math.min(1, (target.mind.relationships[agent.id] ?? 0) + delta * 0.6));
        // also remember this conversation
        if (target.mind.memories.length < 12) {
          target.mind.memories.unshift(`${agent.name}: ${decision.speech.slice(0, 60)}`);
          if (target.mind.memories.length > 12) target.mind.memories.length = 12;
        }
      }
    } else if (nearbyIds.length > 0 && isReply) {
      // generic social boost if talking without specific target but replying
      for (const nid of nearbyIds.slice(0, 2)) {
        agent.mind.relationships[nid] = Math.max(-1, Math.min(1, (agent.mind.relationships[nid] ?? 0) + 0.03));
      }
    }
  }

  // occasionally spit - instinct aggression when arguing with nearby
  // increased a bit for realism but still rare (6% when argue)
  const spitChance = nearbyIds.length > 0 && decision.act === "argue" ? 0.06 : nearbyIds.length > 0 && decision.act === "talk" && agent.mind.spirits < -0.3 ? 0.02 : 0;
  if (spitChance > 0 && rng() < spitChance) {
    const victim = nearbyIds[Math.floor(rng() * nearbyIds.length)]!;
    const spitPost: TownSnapshot["feed"][number] = {
      id: "p" + Math.random().toString(36).slice(2, 10),
      t: Date.now(),
      by: agent.id,
      name: agent.name,
      handle: agent.handle,
      text: `spat at ${world.herd.find((h) => h.id === victim)?.name ?? victim}`,
      kind: "spit",
      replyTo: null,
    };
    world.feed.unshift(spitPost);
    if (world.feed.length > 400) world.feed.length = 400;
    spitEvent = { type: "spit", from: agent.id, to: victim };
    if (!createdPost) createdPost = spitPost;
    const v = world.herd.find((h) => h.id === victim);
    if (v) {
      v.mind.spirits = Math.max(-1, v.mind.spirits - 0.25);
      // relationship damage
      agent.mind.relationships[victim] = Math.max(-1, (agent.mind.relationships[victim] ?? 0) - 0.25);
      v.mind.relationships[agent.id] = Math.max(-1, (v.mind.relationships[agent.id] ?? 0) - 0.35);
    }
  }

  agent.mind.doing = {
    act: decision.act,
    place,
    placeName,
    since: Date.now(),
    why: decision.reason,
  };

  // Projects: small progress bump if at civic/work site — instinct duty
  for (const p of world.projects) {
    if (rng() < 0.08) p.progress = Math.min(1, p.progress + 0.012);
  }

  world.now = Date.now();

  const order: OrderEvent = { type: "order", id: agent.id, act: decision.act, place, secs: SECS };
  return { order, spit: spitEvent, post: createdPost };
}
