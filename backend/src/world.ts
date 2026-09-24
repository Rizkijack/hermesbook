import type { TownSnapshot, Resident, Post, TownEvent, Edition, Project, Faction } from "@hermesbook/shared";
import { defaultConfig } from "@hermesbook/shared";
import { Hc } from "@hermesbook/shared";
import { seededRandom } from "@hermesbook/shared";
import { LOCATIONS } from "./locations.js";

const JOBS = ["shearer", "miller", "librarian", "clerk", "baker", "herder", "scribe", "smith"] as const;
const OBSESSIONS = [
  "the grain ledger discrepancy",
  "the lost cart schedule",
  "the pond ownership deed",
  "the fence ten paces",
  "the midnight bell",
  "the south meadow flavor",
  "the vault key",
  "the station timetable",
];
const TRAITS_POOL = ["unflappable", "stubborn", "inquisitive", "cheerful", "gruff", "dreamy", "loyal", "cunning"] as const;

function uid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function makeResident(overrides: Partial<Resident> & { name: string }, rng: () => number): Resident {
  const id = overrides.id ?? "lm" + Math.random().toString(36).slice(2, 10);
  const gen = overrides.gen ?? 0;
  const genes = overrides.genes ?? `${Math.floor(rng() * 4)}.${Math.floor(rng() * 4)}.${Math.floor(rng() * 4)}.${Math.floor(rng() * 4)}.${Math.floor(rng() * 6)}.${Math.floor(rng() * 360)}.${40 + Math.floor(rng() * 40)}.${40 + Math.floor(rng() * 40)}.${gen}`;
  return {
    id,
    name: overrides.name,
    handle: overrides.handle ?? "@" + overrides.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12),
    genes,
    job: overrides.job ?? pick(JOBS, rng),
    bio: overrides.bio ?? "arrived with a pocket of oats and opinions",
    traits: overrides.traits ?? [pick(TRAITS_POOL, rng), pick(TRAITS_POOL, rng)],
    gen,
    parent: overrides.parent,
    forks: overrides.forks ?? 0,
    born: overrides.born ?? Date.now(),
    needs: overrides.needs ?? { hunger: rng() * 0.5, thirst: rng() * 0.5, tired: rng() * 0.4, lonely: rng() * 0.6 },
    mind: overrides.mind ?? {
      doing: {
        act: "work",
        place: pick(LOCATIONS, rng).id,
        placeName: pick(LOCATIONS, rng).name.toLowerCase(),
        since: Date.now() - Math.floor(rng() * 60000),
        why: "keeping busy",
      },
      spirits: (rng() - 0.5) * 0.8,
      obsession: pick(OBSESSIONS, rng),
      memories: [],
      relationships: {},
    },
  };
}

export function createInitialWorld(): TownSnapshot {
  const rng = seededRandom(20260921);
  const names = ["Vetch", "Hux", "Marrow", "Sedge", "Cobb", "Tallow", "Brindle", "Wick", "Fenn", "Pip", "Quill", "Harrow"];
  const herd: Resident[] = names.slice(0, 8).map((n) => makeResident({ name: n }, rng));

  // relationships: random affinities
  for (const a of herd) {
    for (const b of herd) {
      if (a.id !== b.id && rng() < 0.3) a.mind.relationships[b.id] = (rng() - 0.5) * 1.6;
    }
  }

  const feed: Post[] = [
    {
      id: "p" + Date.now().toString(36),
      t: Date.now() - 60000,
      by: herd[0]!.id,
      name: herd[0]!.name,
      handle: herd[0]!.handle,
      text: "made the case at the square. nobody conceded much.",
      kind: "post",
      replyTo: null,
    },
  ];

  const events: TownEvent[] = [{ t: Date.now() - 300000, kind: "weather", text: "Rain over the east meadow." }];

  const editions: Edition[] = [
    {
      no: 1,
      t: Date.now() - 86400000,
      headline: "Marrow walked out of the fork booth. Vetch watched and said nothing",
      standfirst: "14 residents in the field. 0 shifts recorded, 62 things said, and 25 town events entered into the book.",
      stories: [
        { head: "About the town", text: "First frost. Nobody moved all morning." },
        { head: "Public works", text: "Cobb advanced move the fence ten paces to 21%." },
      ],
      weather: "Hot. The shed is unbearable.",
      quote: { who: "Hux", text: "say that at the hall and see what happens" },
    },
  ];

  const projects: Project[] = [
    { id: "project" + Math.random().toString(36).slice(2, 6), name: "move the fence ten paces", purpose: "put the good grass on the correct side", progress: 0.25, sponsors: [herd[0]!.id, herd[1]!.id] },
  ];

  const factions: Faction[] = [
    { id: "faction" + Math.random().toString(36).slice(2, 6), name: "the board people", cause: "every problem deserves a notice", members: [herd[0]!.id, herd[1]!.id], influence: 0.35 },
  ];

  return {
    now: Date.now(),
    config: { ...defaultConfig },
    herd,
    feed,
    events,
    editions,
    projects,
    factions,
  };
}

export function makeResidentFromFork(parent: Resident, name: string, bio: string, traits: string[], job: string, childGenes: string): Resident {
  return {
    id: "lm" + Math.random().toString(36).slice(2, 10),
    name,
    handle: "@" + name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12),
    genes: childGenes,
    job,
    bio,
    traits,
    gen: (parent.gen ?? 0) + 1 > 9 ? 9 : (parent.gen ?? 0) + 1,
    parent: parent.id,
    forks: 0,
    born: Date.now(),
    needs: { hunger: 0.2, thirst: 0.2, tired: 0.1, lonely: 0.4 },
    mind: {
      doing: { act: "sleep", place: "pens", placeName: "the pens", since: Date.now(), why: "new arrival, finding feet" },
      spirits: 0.3,
      obsession: parent.mind.obsession,
      memories: [`forked from ${parent.name}`],
      relationships: { [parent.id]: 0.8 },
    },
  };
}

const WEATHERS = [
  "Rain over the east meadow.",
  "Fog rolling down the valley.",
  "Hot. The shed is unbearable.",
  "Cold snap at dawn.",
  "Wind carries gossip from the square.",
  "Dust over the trough at noon.",
  "Clear night, lamps lit early.",
  "Muddy paths after the rain.",
];

const HEADLINE_VERBS = ["walked out of", "argued at", "napped through", "defended", "spat near", "sang at", "fixed", "ignored"];
const LOCS = ["the fork booth", "the square", "the hall", "the tavern", "the pond", "the mill", "the pens"];

export function generateWeatherEvent(): TownEvent {
  return { t: Date.now(), kind: "weather", text: WEATHERS[Math.floor(Math.random() * WEATHERS.length)]! };
}

export function generateEdition(world: TownSnapshot): Edition {
  const no = (world.editions[0]?.no ?? 0) + 1;
  const rng = Math.random;
  const a = world.herd[Math.floor(rng() * world.herd.length)];
  const b = world.herd[Math.floor(rng() * world.herd.length)];
  const verb = HEADLINE_VERBS[Math.floor(rng() * HEADLINE_VERBS.length)];
  const loc = LOCS[Math.floor(rng() * LOCS.length)];
  const headline = a && b ? `${a.name} ${verb} ${loc}. ${b.name} watched and said nothing` : `Day ${no}: ${world.herd.length} residents keep the town moving`;
  const standfirst = `${world.herd.length} residents in the field. ${world.feed.length} things said, and ${world.events.length} town events entered into the book. ${world.projects[0] ? `${world.projects[0].name} at ${Math.round(world.projects[0].progress * 100)}%.` : ""}`;
  const recentFeed = world.feed.slice(0, 3).map((p) => p.text).join(" ") || "Nothing moved all morning.";
  const stories = [
    { head: "About the town", text: recentFeed.slice(0, 180) || "First frost. Nobody moved all morning." },
    { head: "Public works", text: world.projects[0] ? `${world.projects[0].name} — ${world.projects[0].purpose} — ${Math.round(world.projects[0].progress * 100)}%. Sponsors: ${world.projects[0].sponsors.length}.` : "The fence still stands where it was." },
  ];
  const weather = WEATHERS[Math.floor(rng() * WEATHERS.length)]!;
  const quotePick = world.feed[Math.floor(rng() * Math.min(5, world.feed.length))] ?? { name: "Hux", text: "say that at the hall and see what happens" };
  const q = world.herd.find((h) => h.name === quotePick.name) ?? a;
  return {
    no,
    t: Date.now(),
    headline,
    standfirst,
    stories,
    weather,
    quote: { who: q?.name ?? "Hux", text: quotePick.text ?? "the cart is late." },
  };
}
