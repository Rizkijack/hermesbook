export interface Resident {
  id: string;
  name: string;
  handle: string;
  genes: string;
  job: string;
  bio: string;
  traits: string[];
  gen: number;
  parent?: string;
  forks: number;
  born: number;
  needs: {
    hunger: number;
    thirst: number;
    tired: number;
    lonely: number;
  };
  mind: {
    doing: {
      act: string;
      place: string;
      placeName: string;
      since: number;
      why: string;
    };
    spirits: number;
    obsession: string;
    memories: string[];
    relationships: Record<string, number>;
  };
}

export interface Post {
  id: string;
  t: number;
  by: string;
  name: string;
  handle: string;
  text: string;
  kind: "post" | "reply" | "spit";
  replyTo: string | null;
}

export interface TownEvent {
  t: number;
  kind: string;
  text: string;
}

export interface Edition {
  no: number;
  t: number;
  headline: string;
  standfirst: string;
  stories: { head: string; text: string }[];
  weather: string;
  quote: { who: string; text: string };
}

export interface Project {
  id: string;
  name: string;
  purpose: string;
  progress: number;
  sponsors: string[];
}

export interface Faction {
  id: string;
  name: string;
  cause: string;
  members: string[];
  influence: number;
}

export type QuestType = "visit" | "talk" | "fetch" | "work" | "explore" | "social";
export type QuestStatus = "available" | "active" | "completed" | "claimed";
export type QuestDifficulty = "easy" | "medium" | "hard";

export interface Quest {
  id: string;
  title: string;
  description: string;
  giver: string; // resident id or "board"
  giverName: string;
  type: QuestType;
  category: string; // Daily, Work, Social, Exploration
  targetPlace?: string;
  targetPlaces?: string[];
  targetAgent?: string;
  progress: number;
  required: number;
  reward: { spirits?: number; text: string; progressBonus?: number };
  status: QuestStatus;
  difficulty: QuestDifficulty;
  createdAt: number;
  expiresAt: number | null;
  completedAt?: number;
}

export interface TownSnapshot {
  now: number;
  config: TownConfig;
  herd: Resident[];
  feed: Post[];
  events: TownEvent[];
  editions: Edition[];
  projects: Project[];
  factions: Faction[];
  quests: Quest[];
}

export interface TownConfig {
  name: string;
  ticker: string;
  tokenAddress: string;
  chainName: string;
  network: string;
  rpcUrl: string;
  explorer: string;
  dexUrl: string;
  xUrl: string;
  brain: "llm" | "sim";
  forkCost: string;
  maxHerd: number;
}

// Utility: clamp
export function clamp(min: number, max: number, v: number) {
  return Math.max(min, Math.min(max, v));
}
