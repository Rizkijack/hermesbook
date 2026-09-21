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

const SECS = 18;

export async function runTurn(world: TownSnapshot, agentId: string, brain?: Brain): Promise<OrderEvent | null> {
  const agent = world.herd.find((h) => h.id === agentId);
  if (!agent) return null;

  // Read phase: gather context
  const clock = dayClock(Date.now(), 900);
  const rng = () => Math.random();
  const nearby = world.herd.filter((h) => h.id !== agentId && h.mind.doing.place === agent.mind.doing.place).map((h) => h.id);

  const ctx = {
    needs: { ...agent.needs },
    clock,
    location: agent.mind.doing.place,
    nearbyAgents: nearby,
    rng,
  };

  // Decide phase
  const decision = brain ? await brain.decide(ctx) : simDecide(ctx);

  // Validate place
  const placeOk = LOCATION_BY_ID.has(decision.place);
  const place = placeOk ? decision.place : agent.mind.doing.place;
  const loc = LOCATION_BY_ID.get(place);
  const placeName = loc ? loc.name.toLowerCase() : place;

  // Move & Apply: update needs and mind
  agent.needs = tickNeeds(agent.needs, decision.act, SECS);
  // mood drift
  if (decision.act === "spit") agent.mind.spirits = Math.max(-1, agent.mind.spirits - 0.2);
  if (decision.speech) {
    // add to feed and memories
    const post = {
      id: "p" + Math.random().toString(36).slice(2, 10),
      t: Date.now(),
      by: agent.id,
      name: agent.name,
      handle: agent.handle,
      text: decision.speech,
      kind: "post" as const,
      replyTo: null,
    };
    world.feed.unshift(post);
    if (world.feed.length > 400) world.feed.length = 400;
    agent.mind.memories.unshift(decision.speech.slice(0, 80));
    if (agent.mind.memories.length > 12) agent.mind.memories.length = 12;
  }

  // occasionally spit
  if (nearby.length > 0 && rng() < 0.04 && decision.act === "argue") {
    const victim = nearby[Math.floor(rng() * nearby.length)]!;
    // broadcast will be handled by caller via separate spit event? included as order + post kind spit
    // For MVP we just add a feed entry
    world.feed.unshift({
      id: "p" + Math.random().toString(36).slice(2, 10),
      t: Date.now(),
      by: agent.id,
      name: agent.name,
      handle: agent.handle,
      text: `spat at ${world.herd.find((h) => h.id === victim)?.name ?? victim}`,
      kind: "spit",
      replyTo: null,
    });
    if (world.feed.length > 400) world.feed.length = 400;
  }

  agent.mind.doing = {
    act: decision.act,
    place,
    placeName,
    since: Date.now(),
    why: decision.reason,
  };

  // Projects: small progress bump if at civic/work site
  for (const p of world.projects) {
    if (rng() < 0.06) p.progress = Math.min(1, p.progress + 0.01);
  }

  world.now = Date.now();

  return { type: "order", id: agent.id, act: decision.act, place, secs: SECS };
}
