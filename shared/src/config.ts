import type { TownConfig } from "./types.js";

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
