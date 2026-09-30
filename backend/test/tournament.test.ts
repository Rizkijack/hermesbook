/**
 * The tournament driver (08 §5, §7, D1–D8).
 *
 * `tickTournament` takes `now` as an argument precisely so this suite can drive
 * a whole season — twelve contests, three phases, a rollover — in milliseconds
 * without a real clock and without a running sim.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CONTEST, CONTEST_VENUES, SEASON } from "@hermesbook/shared";
import type { TownSnapshot } from "@hermesbook/shared";
import { createInitialWorld } from "../src/world.js";
import { joinWorld, AGENT_AFK_MS } from "../src/agents.js";
import { ensureHouseResidents, HOUSE_AGENT_IDS, isHouseAgent } from "../src/houseagents.js";
import { createSeason, seasonContestIndex } from "../src/season.js";
import {
  announceContest,
  contestVenue,
  forfeitNotice,
  forfeitingEntrants,
  matchupLine,
  nextContestKind,
  registerForContest,
  retireResolved,
  seasonPhase,
  tickTournament,
  upcomingContest,
  withdrawFromContest,
} from "../src/tournament.js";

const T0 = 1_700_000_000_000;
/** one in-game day, so each contest lands on a fresh `dayOfYear` */
const DAY = 900_000;

let world: TownSnapshot;

/** External agents, which is what a season actually needs to play out. */
let agentSeq = 0;
function addAgents(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const joined = joinWorld(world, { name: `Contender${agentSeq++}`, origin: "vitest" });
    ids.push(joined.resident.id);
  }
  return ids;
}

beforeEach(() => {
  world = createInitialWorld();
  ensureHouseResidents(world);
});

describe("schedule (08 D3, §4.2)", () => {
  it("rotates the objective so every house bot stays reachable", () => {
    // `houseagents.ts` partitions the four objectives across the three bots. A
    // fixed objective would leave two bots as dead code, so the rotation is a
    // correctness property, not a flavour choice.
    const seen = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(nextContestKind));
    expect(seen).toEqual(new Set(["gather_at", "hold_ground", "tend_project", "endure"]));
  });

  it("picks a venue legal for the objective", () => {
    for (let i = 0; i < 12; i++) {
      const kind = nextContestKind(i);
      const place = contestVenue(kind, i);
      // asserted against the config for *that* objective: a flat list of every
      // venue would pass even if the function returned "pond" for `tend_project`
      expect(CONTEST_VENUES[kind]).toContain(place);
    }
  });
});

describe("announce", () => {
  it("opens a contest in the announced state with the v1 headline", () => {
    const c = announceContest(world, T0)!;
    expect(c).not.toBeNull();
    expect(c.state).toBe("announced");
    expect(c.title).toBe("THE HALL ARGUMENT");
    expect(c.startsAt).toBe(T0 + CONTEST.announceMs);
    expect(c.endsAt).toBe(T0 + CONTEST.announceMs + CONTEST.durationMs);
    expect(c.samples).toEqual([]);
  });

  it("does not open a second contest for the same day", () => {
    expect(announceContest(world, T0)).not.toBeNull();
    expect(announceContest(world, T0 + 1000)).toBeNull();
  });

  it("puts at most one house bot in the roster (D8)", () => {
    for (let i = 0; i < 12; i++) {
      world.season = { ...createSeason(1, T0), appliedContests: new Array(i).fill("x") };
      world.contests = [];
      const c = announceContest(world, T0 + i * DAY)!;
      const house = c.entrants.filter((id) => isHouseAgent(id));
      expect(house.length).toBeLessThanOrEqual(1);
      if (house.length === 1) expect(c.houseEntrant).toBe(house[0]);
    }
  });
});

describe("registration (08 §7, D1, D4, D6)", () => {
  it("refuses a resident — only external agents compete (D1)", () => {
    announceContest(world, T0);
    const local = world.herd.find((h) => h.mind.control !== "external" && !isHouseAgent(h.id))!;
    const out = registerForContest(world, local.id);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
  });

  it("accepts an external agent, and registering twice changes nothing", () => {
    const [a] = addAgents(1);
    announceContest(world, T0);
    expect(registerForContest(world, a!).ok).toBe(true);
    const roster = upcomingContest(world)!.entrants.length;
    expect(registerForContest(world, a!).ok).toBe(true);
    expect(upcomingContest(world)!.entrants.length).toBe(roster);
  });

  it("turns the latecomer away when the roster is full, without cancelling the contest", () => {
    const ids = addAgents(CONTEST.maxEntrants);
    announceContest(world, T0);
    for (const id of ids.slice(0, CONTEST.maxEntrants)) registerForContest(world, id);
    const extra = addAgents(1)[0]!;
    const out = registerForContest(world, extra);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    // the contest itself is untouched — over-subscription must never veto it
    expect(upcomingContest(world)!.entrants.length).toBe(CONTEST.maxEntrants);
  });

  it("withdraws during the announce window", () => {
    const [a] = addAgents(1);
    announceContest(world, T0);
    registerForContest(world, a!);
    expect(withdrawFromContest(world, a!).ok).toBe(true);
    expect(upcomingContest(world)!.entrants).not.toContain(a);
  });

  it("refuses a withdrawal once the contest is under way (D5)", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    expect(c.state).toBe("live");
    const out = withdrawFromContest(world, ids[0]!);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    // D5: the contest continues with whoever is left — nobody is kicked
    expect(c.entrants).toContain(ids[0]);
  });

  it("reports 'not registered' rather than pretending to withdraw", () => {
    const [a] = addAgents(1);
    announceContest(world, T0);
    expect(withdrawFromContest(world, a!).status).toBe(404);
  });
});

describe("lifecycle", () => {
  /** Drive one contest from announce to resolution. */
  function playContest(now: number, entrants: readonly string[]): void {
    const c = announceContest(world, now)!;
    for (const id of entrants) registerForContest(world, id);
    tickTournament(world, c.startsAt); // -> live
    // a handful of sampling turns, each moving both agents somewhere real
    for (let i = 0; i < 6; i++) {
      for (const id of c.entrants) {
        const r = world.herd.find((h) => h.id === id);
        if (r) r.mind.doing.place = i % 2 === 0 ? c.place : "tavern";
      }
      tickTournament(world, c.startsAt + 1000 + i * 1000);
    }
    tickTournament(world, c.endsAt + 1); // -> resolved
  }

  it("walks announced → live → resolved", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    expect(c.state).toBe("announced");
    for (const id of ids) registerForContest(world, id);
    expect(tickTournament(world, c.startsAt)?.reason).toBe("live");
    expect(tickTournament(world, c.startsAt + 2000)).toBeNull(); // sampling is silent
    expect(c.samples.length).toBeGreaterThan(0);
    const done = tickTournament(world, c.endsAt + 1)!;
    expect(done.reason).toBe("resolved");
    expect(c.state).toBe("resolved");
    expect(c.result).toBeDefined();
    expect(c.result!.standings.length).toBeGreaterThanOrEqual(2);
  });

  it("samples once per entrant per turn, whatever happens in the world", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    const before = c.samples.length;
    tickTournament(world, c.startsAt + 500);
    expect(c.samples.length - before).toBe(c.entrants.length);
  });

  it("never starts below two entrants (D6) and says why", () => {
    const c = announceContest(world, T0)!; // house bot only, no agents joined
    const event = tickTournament(world, c.startsAt)!;
    expect(event.reason).toBe("skipped");
    expect(event.skippedBecause).toContain(String(CONTEST.minEntrants));
    expect(c.result).toBeUndefined();
    expect(c.state).toBe("resolved");
  });

  it("does not re-announce a skipped contest for the rest of the day", () => {
    // Regression: deleting the skipped contest made every subsequent turn
    // re-announce and re-skip the same id, spinning for the whole day.
    const c = announceContest(world, T0)!;
    tickTournament(world, c.startsAt);
    expect(tickTournament(world, c.startsAt + 1000)).toBeNull();
    expect(tickTournament(world, c.startsAt + 2000)).toBeNull();
    expect(world.contests!.filter((x) => x.id === c.id)).toHaveLength(1);
  });

  it("resolves a contest down to one as void rather than inventing a winner (D7)", () => {
    // The contest has to *start* with two — D6 would otherwise refuse it — and
    // then one of them produces no evidence at all. That is the only way a
    // voidResult can arise, and it is the case D7 exists for.
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    c.entrants = [ids[0]!, ids[1]!];
    tickTournament(world, c.startsAt);
    // let both contestants actually be sampled for a while…
    for (let i = 0; i < 5; i++) tickTournament(world, c.startsAt + 1000 + i * 1000);
    // …then the second one goes silent, the way an AFK agent would: no rows
    c.samples = c.samples.filter((s) => s.agentId !== ids[1]);
    tickTournament(world, c.endsAt + 1);
    expect(c.state).toBe("resolved");
    expect(c.result!.voidResult).toBe(true);
    expect(c.result!.standings.length).toBe(1);
    expect(c.result!.standings.every((s) => s.score === 0)).toBe(true);
    // the rank is kept for narration even though the points are gone
    expect(c.result!.standings[0]!.rank).toBe(1);
  });

  it("scores the whole window, not the tail the save will keep (08 §11)", () => {
    // The cap is a *persist* budget. Trimming while the contest is live would
    // hand the resolver only the newest rows, and here that flips the winner:
    // `early` owns the first ten ticks and `late` the last ten — an exact tie on
    // metric, broken by earliest arrival in favour of `early`. Keep only the
    // newest 200 of 240 rows and `early` has no venue rows at all, so `late`
    // would take it.
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    c.entrants = [ids[0]!, ids[1]!];
    tickTournament(world, c.startsAt);

    const TICKS = 120;
    for (let i = 0; i < TICKS; i++) {
      const [early, late] = ids;
      world.herd.find((h) => h.id === early!)!.mind.doing.place = i < 10 ? c.place : "tavern";
      world.herd.find((h) => h.id === late!)!.mind.doing.place = i >= TICKS - 10 ? c.place : "tavern";
      tickTournament(world, c.startsAt + (i + 1) * 1000);
    }
    expect(c.samples.length).toBeGreaterThan(CONTEST.persistSamples);

    tickTournament(world, c.endsAt + 1);
    expect(c.result!.standings[0]!.agentId).toBe(ids[0]);
    expect(c.result!.standings[0]!.metric).toBe(10);
    // the save is trimmed only after the verdict
    expect(c.samples.length).toBeLessThanOrEqual(CONTEST.persistSamples);
  });

  it("caps the evidence trail on the save, not on the verdict (08 §11)", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    for (let i = 0; i < 200; i++) {
      tickTournament(world, c.startsAt + 1000 + i * 10);
    }
    tickTournament(world, c.endsAt + 1);
    expect(c.samples.length).toBeLessThanOrEqual(CONTEST.persistSamples);
  });
});

describe("forfeits (D5, D7)", () => {
  it("continues without an agent that went AFK, and lists who did not show", () => {
    // The important part: the AFK agent's *resident keeps being simulated* — the
    // sim takes over for absent agents — so it still has rows at the venue and
    // still would have scored. D7 says those points are not theirs to take.
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    // exactly two, so a forfeit leaves one and the result really is a walkover
    c.entrants = [ids[0]!, ids[1]!];
    c.houseEntrant = undefined;
    for (const id of ids) registerForContest(world, id);

    // the agent walks away partway through
    const record = (world.agents ?? []).find((a) => a.residentId === ids[1])!;
    record.lastActAt = T0 - AGENT_AFK_MS - 1000;
    record.lastActAt = T0 - AGENT_AFK_MS - 1000;

    tickTournament(world, c.startsAt);
    for (let i = 0; i < 5; i++) tickTournament(world, c.startsAt + 1000 + i * 1000);

    // the stand-in llama is still walking around and still being sampled
    expect(c.samples.some((s) => s.agentId === ids[1])).toBe(true);

    tickTournament(world, c.endsAt + 1);

    expect(c.state).toBe("resolved");
    // D5: nobody was kicked, the contest still produced a result
    expect(c.entrants).toContain(ids[1]);
    expect(c.result!.standings.map((s) => s.agentId)).not.toContain(ids[1]);
    expect(forfeitingEntrants(world, c, c.endsAt + 1)).toEqual([ids[1]]);
    expect(c.result!.voidResult).toBe(true);
    // D7: the walkover is worth nothing
    expect(c.result!.standings.every((s) => s.score === 0)).toBe(true);
    // and the season board is untouched by it
    expect(world.season!.standings).toEqual([]);
    // the notice names them, because a forfeit that is only a gap in the
    // standings reads as a bug
    const name = world.herd.find((h) => h.id === ids[1])!.name;
    expect(forfeitNotice(world, c, c.endsAt + 1)).toBe(`${name} did not show`);
  });

  it("does not call a bot a forfeiter — it has no agent record to go AFK", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    for (let i = 0; i < 5; i++) tickTournament(world, c.startsAt + 1000 + i * 1000);
    tickTournament(world, c.endsAt + 1);
    expect(forfeitingEntrants(world, c, c.endsAt + 1)).toEqual([]);
  });
});

describe("season phases (08 §5, format A)", () => {
  it("goes trials → semifinals → final → champion, then resets", () => {
    const ids = addAgents(SEASON.semifinalists + 2);
    let now = T0;
    const phases: string[] = [];
    // `CHAMPION` and `ROLLED` are milestones, not phases — keeping them in the
    // same array meant the exact-shape assertion below was really asserting
    // that a marker it had just pushed was not there.
    const milestones: string[] = [];
    // snapshot taken at the instant of the rollover, because the loop keeps
    // playing into the *new* season afterwards and that is the correct shape
    let standingsAtRollover: unknown = null;
    let ledgerAtRollover: string[] | undefined;

    // one contest per in-game day, for a whole season plus a changeover
    for (let day = 0; day < SEASON.seasonDays + 1; day++) {
      const before = world.season?.no ?? 1;
      const c = announceContest(world, now);
      if (c) {
        // recorded at announce time, because that is the phase the contest
        // actually played in: the resolve that finishes the tenth trial is what
        // *advances* the phase, so reading it afterwards reports one day late
        const playedIn = seasonPhase(world.season);
        for (const id of ids) {
          if (c.state === "announced") registerForContest(world, id);
        }
        tickTournament(world, c.startsAt);
        // give the entrants somewhere to be so the result is not a walkover
        for (let i = 0; i < 8; i++) {
          for (const id of c.entrants) {
            const r = world.herd.find((h) => h.id === id);
            if (r) r.mind.doing.place = i % 3 === 0 ? c.place : "tavern";
          }
          tickTournament(world, c.startsAt + 1000 + i * 1000);
        }
        const done = tickTournament(world, c.endsAt + 1);
        // the phase is derived from the ledger, not read off `season.state` —
        // reading the stored field would pass while the phase machine was broken
        if (done?.reason === "resolved") phases.push(playedIn);
        if (done?.champion !== undefined) {
          expect(done.champion).not.toBeNull();
          milestones.push("CHAMPION");
        }
      }
      if ((world.season?.no ?? 1) !== before) {
        milestones.push("ROLLED");
        standingsAtRollover = JSON.parse(JSON.stringify(world.season!.standings));
        ledgerAtRollover = world.season!.appliedContests;
      }
      now += DAY;
      retireResolved(world, now);
    }

    expect(phases).toContain("semifinals");
    expect(phases).toContain("final");
    expect(milestones).toContain("CHAMPION");
    expect(milestones).toContain("ROLLED");
    // and the sequence is exactly the §5 shape, not merely "contains". The loop
    // runs a day past the season, so anything after the final belongs to the
    // next season's trials.
    expect(phases.slice(0, SEASON.trials + 2)).toEqual([
      ...new Array(SEASON.trials).fill("trials"),
      "semifinals",
      "final",
    ]);
    expect(phases.slice(SEASON.trials + 2).every((p) => p === "trials")).toBe(true);
    // the reset is the return hook (D10) — a fresh, empty leaderboard, and the
    // ledger that drives it starts over too or the new season would open
    // already finished
    expect(standingsAtRollover).toEqual([]);
    expect(ledgerAtRollover ?? []).toHaveLength(0);
  });

  it("derives the phase from the ledger, so a save cannot disagree with itself", () => {
    const s = createSeason(1, T0);
    expect(seasonPhase(s)).toBe("trials");
    expect(seasonPhase({ ...s, appliedContests: new Array(SEASON.trials).fill("x") })).toBe("semifinals");
    expect(
      seasonPhase({ ...s, appliedContests: new Array(SEASON.trials + 1).fill("x") })
    ).toBe("final");
    expect(seasonPhase({ ...s, appliedContests: new Array(SEASON.trials + 2).fill("x") })).toBe("closed");
  });

  it("refuses a registration once a knockout has fixed its field", async () => {
    // Regression: the bracket is decided by the table, so letting anyone
    // register during a semifinal padded it past SEASON.semifinalists and
    // handed a qualifier's place to whoever registered first.
    world.season = {
      ...createSeason(1, T0),
      appliedContests: new Array(SEASON.trials).fill("x"),
      standings: [
        { agentId: "q1", points: 30, wins: 3, losses: 0 },
        { agentId: "q2", points: 20, wins: 2, losses: 1 },
        { agentId: "q3", points: 15, wins: 1, losses: 2 },
        { agentId: "q4", points: 10, wins: 1, losses: 2 },
        { agentId: "outsider", points: 0, wins: 0, losses: 3 },
      ],
    };
    const outsider = addAgents(1)[0]!;
    const c = announceContest(world, T0)!;
    expect(c.entrants).toEqual(["q1", "q2", "q3", "q4"]);

    const out = registerForContest(world, outsider);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    // the bracket is exactly the qualifiers, un-padded
    expect(c.entrants).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("takes the bracket from the top *real* agents, not the top four minus bots", () => {
    // Regression: filtering the bots out of `qualifiers()` *after* it had
    // already truncated to four shrank the field, and a top four containing
    // three bots left a single contender — which tripped D6 and collapsed the
    // season instead of running a semifinal.
    world.season = {
      ...createSeason(1, T0),
      appliedContests: new Array(SEASON.trials).fill("x"),
      standings: [
        { agentId: "house-ledger", points: 90, wins: 9, losses: 0 },
        { agentId: "house-wren", points: 80, wins: 8, losses: 1 },
        { agentId: "house-hearth", points: 70, wins: 7, losses: 2 },
        { agentId: "a1", points: 30, wins: 3, losses: 6 },
        { agentId: "a2", points: 25, wins: 2, losses: 7 },
        { agentId: "a3", points: 20, wins: 2, losses: 7 },
        { agentId: "a4", points: 15, wins: 1, losses: 8 },
      ],
    };
    const c = announceContest(world, T0)!;
    expect(c.entrants).toEqual(["a1", "a2", "a3", "a4"]);
    // a field of one would have been dropped by D6 and closed the season
    expect(c.entrants.length).toBeGreaterThanOrEqual(CONTEST.minEntrants);
  });

  it("keeps a bot's trial points on the board while closing the bracket to it", () => {
    const s = createSeason(1, T0);
    const filled = {
      ...s,
      appliedContests: new Array(SEASON.trials).fill("x"),
      standings: [
        { agentId: "a", points: 30, wins: 3, losses: 0 },
        { agentId: "b", points: 20, wins: 2, losses: 1 },
        { agentId: "c", points: 15, wins: 1, losses: 2 },
        { agentId: "d", points: 10, wins: 1, losses: 2 },
        { agentId: "e", points: 5, wins: 0, losses: 3 },
      ],
    };
    world.season = filled;
    const c = announceContest(world, T0)!;
    expect(c.entrants).toEqual(["a", "b", "c", "d"]);
    expect(c.houseEntrant).toBeUndefined(); // a bot cannot qualify for a final
  });

  it("closes a season that can never be fielded instead of deadlocking", () => {
    // nobody ever contested, so the table is empty and the semifinal cannot
    // reach two entrants — the tournament must not stall there forever
    world.season = { ...createSeason(1, T0), appliedContests: new Array(SEASON.trials).fill("x") };
    announceContest(world, T0); // seeds an empty semifinal
    const event = tickTournament(world, T0 + CONTEST.announceMs)!;
    expect(event.reason).toBe("skipped");
    expect(world.season!.no).toBe(2);
    expect(world.season!.state).toBe("trials");
  });
});

describe("retirement (08 §10.1)", () => {
  it("keeps the last few cards and drops the rest once their moment has passed", () => {
    const ids = addAgents(2);
    let now = T0;
    let resolvedCount = 0;
    for (let i = 0; i < 5; i++) {
      const c = announceContest(world, now)!;
      for (const id of ids) registerForContest(world, id);
      tickTournament(world, c.startsAt);
      tickTournament(world, c.endsAt + 1);
      resolvedCount++;
      now += DAY;
      retireResolved(world, now);
    }
    const resolved = world.contests!.filter((c) => c.state === "resolved");
    // never more than the retention window, and at least one was actually
    // dropped rather than merely capped
    expect(resolved.length).toBeLessThanOrEqual(3);
    expect(resolved.length).toBeLessThan(resolvedCount);
    expect(resolved.every((c) => c.result !== undefined)).toBe(true);
  });

  it("keeps a card up for resultCardMs even when there is room to drop it", () => {
    // 08 §10.1 — the card is the moment, and it has to last long enough to be seen
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    tickTournament(world, c.endsAt + 1);
    expect(c.state).toBe("resolved");

    expect(retireResolved(world, c.endsAt)).toEqual([]);
    expect(world.contests).toContain(c);
    expect(retireResolved(world, c.endsAt + CONTEST.resultCardMs)).toEqual([]);
    // past the window and not among the most recent few, so it goes
    const later = c.endsAt + CONTEST.resultCardMs + 1;
    for (let i = 0; i < 4; i++) {
      world.contests!.push({ ...c, id: `filler-${i}`, state: "resolved", result: c.result });
    }
    expect(retireResolved(world, later)).toContain(c.id);
  });
});

describe("narration (08 §7.1)", () => {
  it("frames a matchup from the relationship record", () => {
    const [a, b] = addAgents(2);
    const line = matchupLine(world, [a!, b!]);
    expect(line).toContain("v");
    expect(line).toContain("never spoken");
    world.herd.find((h) => h.id === a)!.mind.relationships[b!] = -0.9;
    expect(matchupLine(world, [a!, b!])).toContain("old rivals");
    world.herd.find((h) => h.id === a)!.mind.relationships[b!] = 0.8;
    expect(matchupLine(world, [a!, b!])).toContain("old friends");
  });

  it("says nothing rather than inventing a pairing for one entrant", () => {
    const [a] = addAgents(1);
    expect(matchupLine(world, [a!])).toBe("");
  });
});

describe("bookkeeping", () => {
  it("counts the season by its ledger, which survives a JSON round trip", () => {
    const ids = addAgents(2);
    const c = announceContest(world, T0)!;
    for (const id of ids) registerForContest(world, id);
    tickTournament(world, c.startsAt);
    tickTournament(world, c.endsAt + 1);
    const reloaded = JSON.parse(JSON.stringify(world)) as TownSnapshot;
    expect(seasonContestIndex(reloaded.season)).toBe(1);
  });

  it("keeps the house roster to exactly three bodies", () => {
    const before = world.herd.filter((r) => isHouseAgent(r.id)).length;
    ensureHouseResidents(world);
    expect(before).toBe(3);
    expect(world.herd.filter((r) => isHouseAgent(r.id)).length).toBe(3);
    expect(HOUSE_AGENT_IDS).toHaveLength(3);
  });
});
