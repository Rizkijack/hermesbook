import { isNight } from "./needs.js";

export interface DecideContext {
  needs: { hunger: number; thirst: number; tired: number; lonely: number };
  clock: number;
  location: string;
  nearbyAgents: string[];
  rng: () => number;
}

export interface Decision {
  act: string;
  place: string;
  reason: string;
  speech?: string;
}

const TEMPLATES = [
  "the cart is late.",
  "made the case at the square. nobody conceded much.",
  "say that at the hall and see what happens",
  "still owes the mill three sacks",
  "the south meadow tastes different today",
  "nobody moved all morning.",
  "the fence must move ten paces",
];

function pickTemplate(rng: () => number): string | undefined {
  if (rng() < 0.35) return TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  return undefined;
}

export function decide(ctx: DecideContext): Decision {
  const { needs, clock, rng } = ctx;

  // 1. Night sleep drive
  if (isNight(clock) && needs.tired > 0.3) {
    return { act: "sleep", place: "barn", reason: "night is falling, need rest" };
  }
  // 2. Thirst
  if (needs.thirst > 0.6) {
    // 60% pond, 40% square fountain
    if (rng() < 0.6) return { act: "drink", place: "pond", reason: "parched, seeking water" };
    return { act: "drink", place: "square", reason: "throat dry, heading to fountain" };
  }
  // 3. Hunger
  if (needs.hunger > 0.6) {
    const opts = ["trough", "meadowW", "meadowE", "orchard"] as const;
    const place = opts[Math.floor(rng() * opts.length)]!;
    const reason = place === "meadowW" ? "craving the good grass" : place === "meadowE" ? "sour grass is still grass" : place === "orchard" ? "apples sound right" : "oats at the trough";
    return { act: "graze", place, reason };
  }
  // 4. Social
  if (needs.lonely > 0.55) {
    const opts = ["square", "tavern", "hall"] as const;
    const place = opts[Math.floor(rng() * opts.length)]!;
    const act = rng() < 0.5 ? "argue" : "talk";
    return { act, place, reason: "feeling lonely, seeking company", speech: pickTemplate(rng) };
  }

  // default: work or graze a bit
  if (rng() < 0.12) {
    return { act: "graze", place: "meadowW", reason: "keeping busy with grazing", speech: pickTemplate(rng) };
  }
  return { act: "work", place: ctx.location || "square", reason: "keeping busy" };
}
