import type { TownConfig } from "./types.js";

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
