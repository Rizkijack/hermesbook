import type { ContestKind, TownConfig } from "./types.js";

/**
 * Length of one in-game day, in real seconds. 900 = 15 real minutes per day.
 *
 * Single source of truth. Previously hardcoded at seven sites
 * (shared config, backend needs/turn/gateway x2, mcp tools, canvas engine,
 * TownView) and only ever agreed by coincidence — see
 * 08-HERMES-TRIALS-TOURNAMENT.md §6.1.
 */
export const DAY_LENGTH_SEC = 900;

/**
 * Where the town clock sits within the current day, as 0..1.
 *
 * Pure wall-clock: it advances whether or not anything is simulated, so an
 * in-game hour is a fixed real-time slot — not a daily appointment.
 * (08 §6: at DAY_LENGTH_SEC=900 "20:00" recurs every 15 real minutes.)
 */
export function dayClock(dateMs: number = Date.now(), dayLengthSec: number = DAY_LENGTH_SEC): number {
  const sec = (dateMs / 1000) % dayLengthSec;
  return sec / dayLengthSec;
}

/** Day-of-year number (1..365) derived from the same wall clock. */
export function dayOfYear(dateMs: number = Date.now(), dayLengthSec: number = DAY_LENGTH_SEC): number {
  return Math.floor((dateMs / 1000 / dayLengthSec) % 365) + 1;
}

/**
 * Hermes Trials contest timing and rules (08 §4.3, §11, §14).
 *
 * The live window is 180s = exactly 100 ticks at TURN_MS 1800, which is where
 * the "~100 samples per contestant" budget in 08 §11 comes from.
 */
export const CONTEST = {
  /** announced → live. The window the HUD shows "starts in …" for. */
  announceMs: 60_000,
  /** live → resolved. 180s / 1800ms tick = 100 ticks per contestant. */
  durationMs: 180_000,
  /** how long the result card stays on screen before idle (08 §10.1). */
  resultCardMs: 45_000,
  /** below this the contest never starts — nothing was promised (D6). */
  minEntrants: 2,
  /** hard cap; keeps a single contest from swallowing the whole roster. */
  maxEntrants: 6,
  /** rank points: 1st, 2nd, 3rd, everyone else (08 §4.3). */
  pointsForRank: [10, 5, 1] as const,
  /** evidence kept per contest on persist (08 §11: ~600 raw rows, trim to 200). */
  maxSamples: 200,
} as const;

/**
 * Season shape — format A (D3): 10 trial days, then top 4 → semis → final.
 * 12 in-game days total (10 trials + semis + final), ≈3 real hours at
 * DAY_LENGTH_SEC 900 (08 §5).
 */
export const SEASON = {
  trials: 10,
  semifinalists: 4,
  /** total in-game days a season spans — the unit of return cadence (08 §6). */
  seasonDays: 12,
} as const;

/** Rank → points (08 §4.3). Ranks beyond the list earn 0. */
export function pointsForRank(rank: number): number {
  const idx = rank - 1;
  return idx >= 0 && idx < CONTEST.pointsForRank.length ? CONTEST.pointsForRank[idx] : 0;
}

export const CONTEST_VENUES: Record<ContestKind, readonly string[]> = {
  /** §4.2 — the square is where the town already gathers */
  gather_at: ["square", "board", "market"],
  /** §4.2 — a fixed spot to hold, away from the traffic */
  hold_ground: ["pond", "fire", "dock"],
  /**
   * §4.2 — no venue given, because `Project` has no site field: progress is
   * bumped by location-independent RNG (turn.ts:215, which claims otherwise).
   * Presence is measured at a civic site as a *convention*, not as causation —
   * the doc measures presence, not attributed progress.
   */
  tend_project: ["hall", "bank", "press"],
  /** §4.2 — `endure` has no target, so this is never consulted */
  endure: ["square"],
};

export const defaultConfig: TownConfig = {
  name: "Hermesbook",
  ticker: "HERMES",
  tokenAddress: "TLJ8QbLnNUxZJJ1dcqF9auUKHrtKd8aNUkscxhSDADj",
  chainName: "Base",
  network: "mainnet",
  rpcUrl: "https://mainnet.base.org",
  explorer: "https://basescan.org/token/TLJ8QbLnNUxZJJ1dcqF9auUKHrtKd8aNUkscxhSDADj",
  dexUrl: "https://dexscreener.com/base/",
  xUrl: "https://x.com/hermesbook",
  brain: "llm",
  forkCost: "Free",
  maxHerd: 64,
};
