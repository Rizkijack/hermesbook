/**
 * Phase 2 smoke test — plays a whole season against a real world.
 *
 * The unit suites drive `tickTournament` with a hand-built world and a
 * synthetic clock. What they cannot prove is that the pieces fit *together*
 * over a real season: a real herd, real residents moving, real registration,
 * twelve contests, three phases, a champion and a rollover.
 *
 *   pnpm --filter backend exec tsx scripts/smoke-tournament.ts
 */
import { createInitialWorld } from "../src/world.js";
import { joinWorld } from "../src/agents.js";
import { ensureHouseResidents, isHouseAgent, HOUSE_AGENTS } from "../src/houseagents.js";
import { rankStandings, qualifiers } from "../src/season.js";
import {
  announceContest,
  forfeitNotice,
  matchupLine,
  registerForContest,
  retireResolved,
  seasonPhase,
  tickTournament,
  upcomingContest,
} from "../src/tournament.js";
import { CONTEST, SEASON, pointsForRank } from "@hermesbook/shared";
import type { TownSnapshot } from "@hermesbook/shared";

const T0 = 1_700_000_000_000;
const TURN = 1_800;
/** one in-game day, so each contest lands on its own `dayOfYear` */
const DAY = 900_000;
const SAMPLES_PER_CONTEST = 90;

function fail(msg: string): never {
  console.error(`\n  ✗ SMOKE FAILED: ${msg}\n`);
  process.exit(1);
}

function check(cond: boolean, msg: string, detail?: unknown): void {
  if (!cond) {
    if (detail !== undefined) console.error("   ", detail);
    fail(msg);
  }
  console.log(`  ✓ ${msg}`);
}

const world: TownSnapshot = createInitialWorld();
ensureHouseResidents(world);
check(world.herd.length >= 8, `world booted with ${world.herd.length} residents`);
check(world.herd.filter((r) => isHouseAgent(r.id)).length === 3, "three house bots in the herd");

// Four external agents — enough for a real trial field plus a knockout.
const agents: string[] = [];
for (let i = 0; i < SEASON.semifinalists; i++) {
  agents.push(joinWorld(world, { name: `Smoke${i}`, origin: "smoke" }).resident.id);
}
check(agents.length === SEASON.semifinalists, `${agents.length} external agents joined`);

// --- one contest, start to finish -----------------------------------------
function playContest(day: number): void {
  const now = T0 + day * DAY;
  const c = announceContest(world, now);
  if (!c) return;

  // every agent registers in the announce window, as a real client would
  for (const id of agents) {
    if (c.state === "announced") registerForContest(world, id);
  }
  const roster = upcomingContest(world);
  check(roster?.id === c.id, `day ${day}: contest ${c.kind} @${c.place} is open for registration`);
  check(
    c.entrants.length <= CONTEST.maxEntrants,
    `day ${day}: roster of ${c.entrants.length} is within the cap of ${CONTEST.maxEntrants}`
  );
  // D8 is about the trials — a self-registration field takes at most one bot.
  // A knockout is different: the roster is the table, so a bot that *qualified*
  // plays. Asserting "one bot" there would be asserting the wrong rule.
  const phase = seasonPhase(world.season);
  const bots = c.entrants.filter((id) => isHouseAgent(id));
  if (phase === "trials") {
    check(
      bots.length <= 1,
      `day ${day}: trials take at most one house bot (D8) — ${c.houseEntrant ?? "none today"}`
    );
  } else {
    // the bracket is the top `SEASON.semifinalists` *real* agents: bots are
    // removed before the cut, not after it
    const contenders = rankStandings(world.season!).filter((s) => !isHouseAgent(s.agentId));
    const expected = (phase === "final" ? contenders.slice(0, 2) : contenders.slice(0, SEASON.semifinalists)).map(
      (s) => s.agentId
    );
    check(
      JSON.stringify(c.entrants) === JSON.stringify(expected),
      `day ${day}: the ${phase} is seeded from the table (${c.entrants.length} entrants, ${bots.length} of them bots)`
    );
    check(
      bots.length === 0,
      `day ${day}: no house bot reaches a knockout — a bot holding the trophy is the loudest way to make a board look fake`
    );
  }

  // go live, then sample
  tickTournament(world, c.startsAt);
  for (let i = 0; i < SAMPLES_PER_CONTEST; i++) {
    for (let k = 0; k < c.entrants.length; k++) {
      const r = world.herd.find((h) => h.id === c.entrants[k]);
      if (!r) continue;
      // realistic drift: most of the time near the venue, sometimes elsewhere
      const atVenue = i % 7 !== 0 && (i + k) % 5 !== 0;
      r.mind.doing.place = atVenue ? c.place : "tavern";
    }
    tickTournament(world, c.startsAt + (i + 1) * TURN, i % 11 === 0 ? [c.entrants[1] ?? ""] : []);
  }
  tickTournament(world, c.endsAt + 1);
}

let now = T0;
playContest(0);
const first = world.contests?.find((c) => c.state === "resolved");
check(first?.result !== undefined, "a contest resolved end to end");
if (first?.result) {
  const board = first.result.standings
    .map((s) => `#${s.rank} ${world.herd.find((h) => h.id === s.agentId)?.name ?? s.agentId} ${s.score}pt "${s.detail}"`)
    .join("\n        ");
  console.log(`\n      ${first.kind} @${first.place}\n        ${board}\n`);
  check(first.result.standings.length > 0, "the result has standings");
  check(
    first.result.standings.every((s) => s.score === (first.result!.voidResult ? 0 : pointsForRank(s.rank))),
    "scores follow the rank table, or zero when void (D7)"
  );
  const missing = forfeitNotice(world, first);
  if (missing) console.log(`      forfeit: ${missing}`);
}
check((world.season?.standings.length ?? 0) > 0, "the season board has points on it");

// --- the rest of the season ------------------------------------------------
let champion: string | null = null;
for (let day = 1; day < SEASON.seasonDays + 1; day++) {
  now += DAY;
  playContest(day);
  retireResolved(world, now);
  if (world.season?.champion) {
    champion = world.season.champion;
    break;
  }
}

check(champion !== null, `a champion emerged after the season (${champion ?? "none"})`);
check(world.season!.no === 2, `the season rolled over into no ${world.season!.no}`);
check(world.season!.standings.length === 0, "the new season opens with an empty board (D10)");

// --- the shape of the closed season ---------------------------------------
// replay the trials on a copy so the standings can be inspected
const replay = structuredClone(world);
replay.season = { ...replay.season!, no: 1, standings: [], appliedContests: [] };
let rDay = 0;
let rNow = T0;
for (let i = 0; i < SEASON.trials; i++) {
  const c = announceContest(replay, rNow);
  if (!c) break;
  for (const id of agents) registerForContest(replay, id);
  tickTournament(replay, c.startsAt);
  for (let s = 0; s < SAMPLES_PER_CONTEST; s++) {
    for (const id of c.entrants) {
      const r = replay.herd.find((h) => h.id === id);
      if (r) r.mind.doing.place = s % 7 !== 0 ? c.place : "tavern";
    }
    tickTournament(replay, c.startsAt + (s + 1) * TURN);
  }
  tickTournament(replay, c.endsAt + 1);
  rNow += DAY;
  retireResolved(replay, rNow);
}
const table = rankStandings(replay.season!);
check(table.length > 0, `${SEASON.trials} trials produced a leaderboard of ${table.length}`);
check(
  table.every((s, i) => i === 0 || table[i - 1]!.points >= s.points),
  "the board is ordered by points, descending"
);
check(
  qualifiers(replay.season!).length === Math.min(SEASON.semifinalists, table.length),
  `the top ${SEASON.semifinalists} qualify — got ${qualifiers(replay.season!).length}`
);
console.log(
  `\n      leaderboard after ${SEASON.trials} trials:\n` +
    table
      .map(
        (s, i) =>
          `        ${String(i + 1).padStart(2)}. ${(replay.herd.find((h) => h.id === s.agentId)?.name ?? s.agentId).padEnd(9)} ${s.points}pt  ${s.wins}W ${s.losses}L`
      )
      .join("\n")
);

// --- house bots actually turned up -----------------------------------------
const seen = new Set<string>();
for (let i = 0; i < 12; i++) {
  const probe: TownSnapshot = { ...world, contests: [], season: { ...world.season!, appliedContests: new Array(i).fill("x") } };
  const c = announceContest(probe, T0 + i * DAY);
  const bot = c?.houseEntrant;
  if (bot) seen.add(bot);
}
check(seen.size === HOUSE_AGENTS.length, `all ${HOUSE_AGENTS.length} house bots entered over 12 contests (${[...seen].join(", ")})`);

// --- the narrative is honest, not invented ---------------------------------
const pair = agents.slice(0, 2);
console.log(`\n      matchup framing: ${matchupLine(world, pair)}`);
check(
  matchupLine(world, pair).includes("never spoken"),
  "a matchup between two agents who never interacted says so"
);

console.log(`\n  SMOKE OK — a full Hermes Trials season runs end to end\n`);
