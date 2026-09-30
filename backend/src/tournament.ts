/**
 * Hermes Trials — the tournament driver (08 §2, §5, §7, D1–D8).
 *
 * Phase 1 made resolution a pure function; this is the part that *calls* it. It
 * owns the contest lifecycle — announced → live → resolved — the registration
 * roster, and the season phases.
 *
 * Everything here is a pure function of `(world, now)`. Nothing schedules
 * itself: `server.ts` calls `tickTournament` once per turn and broadcasts
 * whatever comes back. That is deliberate — a setInterval inside this module
 * would make the whole tournament untestable and would drift against the turn
 * loop it is supposed to be sampling.
 */
import {
  CONTEST,
  CONTEST_VENUES,
  SEASON,
  dayOfYear,
  pointsForRank,
  type Contest,
  type ContestKind,
  type ContestResult,
  type Season,
  type TownSnapshot,
} from "@hermesbook/shared";
import { canStart, hasRoom, scoreContest, takeSamples, trimSamples } from "./contest.js";
import { isAfk } from "./agents.js";
import { isHouseAgent, pickHouseAgent, willShowUp } from "./houseagents.js";
import { applyContestResult, createSeason, rankStandings, rollSeason, seasonContestIndex } from "./season.js";

/** Headline for every contest in v1 — see 08 §3, the outcome-layer note. */
const CONTEST_TITLE = "THE HALL ARGUMENT";

/** How many resolved contests the world keeps for the HUD / Daily Spit. */
const KEEP_RESOLVED = 3;

// ---------------------------------------------------------------------------
// spit capture
// ---------------------------------------------------------------------------

/**
 * Spits raised outside the scheduler, waiting to be folded into the next sample.
 *
 * The sim spits from `runTurn` and the server hands that straight to
 * `tickTournament`. The gateway does not go through `runTurn` at all — it calls
 * `applyDecision` directly, and `applyDecision` really does spit (the same
 * neighbour roll lives inside it). Without this buffer `endure` only ever saw
 * the scheduler's spits, and since D1 makes external agents the *only*
 * contestants, the objective was blind on exactly the path that matters: an
 * agent could be spat on through its own `act` and be told it never was.
 *
 * Module-level on purpose and harmless because of it: the worst case is one
 * stale victim id in the next window, and a process restart has no spits to
 * lose. The alternative — a field on the snapshot — would write a transient
 * half-second event into every save.
 */
let pendingSpits: string[] = [];

/** Record that `victimId` was spat on during the current turn. */
export function noteSpit(victimId: string): void {
  if (victimId) pendingSpits.push(victimId);
}

function drainSpits(): string[] {
  if (pendingSpits.length === 0) return [];
  const out = pendingSpits;
  pendingSpits = [];
  return out;
}

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

/**
 * The objective for contest #`index`.
 *
 * The rotation is not cosmetic: `houseagents.ts` partitions the four objectives
 * across the three bots, so a season that only ever ran one objective would
 * leave two of them as dead code. Rotating is what makes all three reachable.
 *
 * Deterministic, so a reload cannot reorder a season that was already played.
 */
export function nextContestKind(index: number): ContestKind {
  const kinds: readonly ContestKind[] = ["gather_at", "hold_ground", "tend_project", "endure"];
  return kinds[((index % kinds.length) + kinds.length) % kinds.length]!;
}

/** Venue for contest #`index`, picked from the objective's legal venues. */
export function contestVenue(kind: ContestKind, index: number): string {
  const venues = CONTEST_VENUES[kind];
  return venues[((index % venues.length) + venues.length) % venues.length]!;
}

/**
 * A contest's home in the save: season, in-game day, and its index.
 *
 * The day is in the id because D2 is *one contest per in-game day*, and that
 * rule has to be checkable from the data alone. It was not, once: the id used
 * to be `ct-${day}-${index}`, and because the index comes from the season
 * ledger — which grows on every resolve — a second contest on the same day got
 * a *different* id and the day rule silently did not exist. The measured result
 * was three contests per 900-second day, and a 12-contest season closing in
 * four in-game days instead of twelve.
 *
 * The season number also earns its place: without it the id repeats every time
 * the ledger resets, and once a year when `dayOfYear` wraps.
 */
function contestId(seasonNo: number, day: number, index: number): string {
  return `ct-s${seasonNo}-d${day}-i${index}`;
}

/** The prefix shared by every contest belonging to one season-day. */
function dayKey(seasonNo: number, day: number): string {
  return `ct-s${seasonNo}-d${day}-`;
}

function liveContest(world: TownSnapshot): Contest | undefined {
  return world.contests?.find((c) => c.state !== "resolved");
}

function residentOf(world: TownSnapshot, id: string) {
  return world.herd.find((h) => h.id === id);
}

// ---------------------------------------------------------------------------
// narrative framing (08 §7.1)
// ---------------------------------------------------------------------------

/**
 * "Hux  v  Tux — old rivals, the ledger still carries it."
 *
 * Cosmetic by design (08 §7.1): it never touches scoring, it exists so a
 * leaderboard does not read like a spreadsheet. The relationship lookup is
 * between two *residents*; an agent only builds a relationship by acting or
 * speaking, so a matchup between two fresh agents honestly reports "never
 * spoken" instead of inventing history.
 */
export function matchupLine(world: TownSnapshot, entrants: readonly string[]): string {
  if (entrants.length < 2) return "";
  const left = residentOf(world, entrants[0]!);
  const right = residentOf(world, entrants[1]!);
  if (!left || !right) return "";
  const rel = left.mind.relationships[right.id] ?? 0;
  const history =
    rel <= -0.5
      ? "old rivals — the ledger still carries it"
      : rel >= 0.5
        ? "old friends, which is its own kind of tension"
        : "never spoken";
  return `${left.name}  v  ${right.name} — ${history}`;
}

// ---------------------------------------------------------------------------
// registration (08 §7, D4, D6)
// ---------------------------------------------------------------------------

export interface RegisterOutcome {
  ok: boolean;
  status: number;
  error?: string;
  contest?: Contest;
}

/**
 * D1: only external agents compete. Residents are the audience (08 §9), and the
 * house bots enter by rotation rather than by registering — see
 * `announceContest`.
 */
function isEligibleContestant(world: TownSnapshot, residentId: string): boolean {
  return residentOf(world, residentId)?.mind.control === "external";
}

/**
 * D4: agents register themselves for the next open contest.
 *
 * The cap is `hasRoom` and it belongs *here* rather than in `canStart`, so a
 * full roster turns the latecomer away instead of vetoing the contest for
 * everyone already on the board.
 */
export function registerForContest(world: TownSnapshot, residentId: string): RegisterOutcome {
  const contest = liveContest(world);
  if (!contest) return { ok: false, status: 409, error: "no contest is open for registration" };
  if (contest.state !== "announced") {
    // D5: the contest continues without you. Rewriting the roster after go-live
    // would break the promise the other contestants were given.
    return { ok: false, status: 409, error: "the contest has already started" };
  }
  if (!isOpenToRegistration(seasonPhase(world.season))) {
    // A knockout field is decided by the table, not by who was awake during a
    // 60-second window. Letting anyone register here would pad the bracket past
    // `SEASON.semifinalists` and hand a qualifier's place to a bystander.
    return { ok: false, status: 409, error: "this round is decided by the standings — the roster is closed" };
  }
  if (!isEligibleContestant(world, residentId)) {
    return { ok: false, status: 403, error: "only external agents may compete (D1)" };
  }
  if (contest.entrants.includes(residentId)) return { ok: true, status: 200, contest };
  if (!hasRoom(contest.entrants)) {
    return { ok: false, status: 409, error: "the roster is full" };
  }
  contest.entrants.push(residentId);
  contest.narration = matchupLine(world, contest.entrants) || contest.narration;
  return { ok: true, status: 200, contest };
}

/** Withdraw while the contest is still `announced`; after go-live it is refused. */
export function withdrawFromContest(world: TownSnapshot, residentId: string): RegisterOutcome {
  const contest = liveContest(world);
  if (!contest) return { ok: false, status: 404, error: "no contest is open" };
  if (contest.state !== "announced") {
    return { ok: false, status: 409, error: "too late to withdraw — the contest is already under way" };
  }
  if (!contest.entrants.includes(residentId)) {
    return { ok: false, status: 404, error: "you are not registered" };
  }
  contest.entrants = contest.entrants.filter((id) => id !== residentId);
  if (contest.houseEntrant === residentId) contest.houseEntrant = undefined;
  contest.narration = matchupLine(world, contest.entrants);
  return { ok: true, status: 200, contest };
}

/** Public view of the next contest and who is in it (08 §7). */
export function upcomingContest(world: TownSnapshot): Contest | null {
  return liveContest(world) ?? null;
}

// ---------------------------------------------------------------------------
// season phases (08 §5, format A)
// ---------------------------------------------------------------------------

/**
 * The phase a season is in, derived from how many contests it has resolved.
 *
 * Derived rather than stored so a save cannot disagree with itself: the ledger
 * is the single thing that has to be right, and every other field is a function
 * of it.
 *
 * 10 trials → one semifinal among the top 4 → one final among the top 2 →
 * champion. Twelve contests, matching `SEASON.seasonDays`.
 */
export function seasonPhase(season: Season | undefined): Season["state"] {
  if (!season) return "trials";
  if (season.state === "closed") return "closed";
  const done = seasonContestIndex(season);
  if (done < SEASON.trials) return "trials";
  if (done < SEASON.trials + 1) return "semifinals";
  if (done < SEASON.trials + 2) return "final";
  return "closed";
}

/**
 * The roster a phase starts with, before anyone registers.
 *
 * Trials are open: the field is whoever opted in. The knockout phases are not
 * — they are decided by the table, so a qualifier plays because they earned it,
 * not because they were awake during a 60-second window. House agents never
 * enter a knockout (they cannot qualify, and a bot in the final would hand the
 * trophy to the thing the HUD exists to give away).
 */
function seededRoster(season: Season | undefined, phase: Season["state"]): string[] {
  if (!season || phase === "trials") return [];
  // The bots are filtered out *before* the top-N is taken, not after.
  //
  // Filtering after is the obvious version and it is wrong: `qualifiers()`
  // truncates to `SEASON.semifinalists` and a bot that finished inside that cut
  // would then be removed, shrinking the field. Two bots in the top four is
  // common — they win ties, since `house-…` sorts before `lm…` — and three was
  // observed, which left one contender, tripped D6, and collapsed the whole
  // season. The bracket is the best four *real* agents.
  const contenders = rankStandings(season).filter((s) => !isHouseAgent(s.agentId));
  const field = phase === "semifinals" ? contenders.slice(0, SEASON.semifinalists) : contenders.slice(0, 2);
  return field.map((s) => s.agentId);
}

/** Whether external agents may still sign up during this phase. */
function isOpenToRegistration(phase: Season["state"]): boolean {
  return phase === "trials";
}

// ---------------------------------------------------------------------------
// announce
// ---------------------------------------------------------------------------

/**
 * Open a contest if today's has not been opened yet.
 *
 * One contest per in-game day (D3), created a full `announceMs` before it
 * starts, so the venue can glow and agents get a registration window.
 */
export function announceContest(world: TownSnapshot, now = Date.now()): Contest | null {
  world.contests ??= [];
  const day = dayOfYear(now);
  const season = world.season ?? (world.season = createSeason(1, now));
  const seasonNo = season.no;
  // D2: one contest per in-game day. The check is on the *day*, not on the
  // contest — an id check alone would pass, because the index advances on every
  // resolve and would hand the same day a fresh id.
  if (world.contests.some((c) => c.id.startsWith(dayKey(seasonNo, day)))) return null;

  const index = seasonContestIndex(season);
  const phase = seasonPhase(season);
  if (phase === "closed") {
    // The season ran out of contests without ever reaching the final (nobody
    // registered, so the table is empty). Roll it forward rather than stalling
    // the tournament forever on a bracket that cannot be fielded.
    closeSeason(world, now);
    return null;
  }

  const kind = nextContestKind(index);
  const entrants = seededRoster(season, phase);
  const contest: Contest = {
    id: contestId(seasonNo, day, index),
    kind,
    title: CONTEST_TITLE,
    place: contestVenue(kind, index),
    startsAt: now + CONTEST.announceMs,
    endsAt: now + CONTEST.announceMs + CONTEST.durationMs,
    state: "announced",
    entrants,
    samples: [],
    narration: matchupLine(world, entrants),
  };

  // D8: the single house agent, trials only, and only if it will actually turn
  // up — a bot that registers and then stands still is the cheapest honest
  // demonstration of the AFK / forfeit path (D5, D7).
  if (phase === "trials") {
    const house = pickHouseAgent(index, kind);
    // A bot that was never seeded (a save whose pasture was already full) must
    // not appear in the roster: `takeSamples` would record a null place for it
    // and the standings would carry a contestant that does not exist.
    if (house && willShowUp(house, index) && residentOf(world, house)) {
      contest.houseEntrant = house;
      contest.entrants.push(house);
    }
  }

  world.contests.push(contest);
  return contest;
}

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

export interface TournamentEvent {
  type: "contest";
  /**
   * The contest the event is about. Absent only for `retired`, which reports an
   * id that has already been swept out of the snapshot — that is the whole
   * point of the event, and it is why the field is optional rather than
   * half-populated with a placeholder a Phase 3 reducer would have to detect.
   */
  contest?: Contest;
  /** why the broadcast fired — the HUD and the tests key off this */
  reason: "announced" | "live" | "resolved" | "skipped" | "retired";
  /** set when the contest was dropped (D6, or a knockout that could not field) */
  skippedBecause?: string;
  /** set when a season closed on this tick */
  champion?: string | null;
  /** the swept contest's id, for `retired` */
  contestId?: string;
}

/**
 * Advance the contest lifecycle by one turn.
 *
 * This is the *only* integration point with the sim: it samples the world
 * during `live`, resolves on `endsAt`, and folds the result into the season.
 *
 * The pitfall worth naming: resolution is not idempotent for free. The sampler
 * may run again after a restart, so `scoreContest` sees a `samples` array that
 * is already on the save. `scoreContest` dedupes by `(t, agentId)`, which is
 * what makes re-resolution safe — without it a second pass would double every
 * presence count and could flip the winner.
 */
export function tickTournament(
  world: TownSnapshot,
  now: number,
  spatThisTick: readonly string[] = []
): TournamentEvent | null {
  const contest = liveContest(world);
  if (!contest) {
    const opened = announceContest(world, now);
    return opened ? { type: "contest", contest: opened, reason: "announced" } : null;
  }

  if (contest.state === "announced" && now >= contest.startsAt) {
    if (!canStart(contest.entrants)) {
      // D6: below two entrants the contest never starts — nothing was
      // promised, so nothing can be forfeited. It is closed as `resolved`
      // with **no** result rather than deleted, and that is load-bearing: if it
      // were removed, the next turn would re-announce the same id for the same
      // day and spin announce → skip → announce for the rest of the day. The
      // quiet day is a real state, and `retireResolved` sweeps it up.
      const phase = seasonPhase(world.season);
      const reason = `only ${contest.entrants.length} entrant(s) registered; D6 needs ${CONTEST.minEntrants}`;
      contest.state = "resolved";

      // A knockout phase that cannot be fielded would otherwise deadlock: the
      // ledger never grows, the phase never advances, and the tournament stops
      // forever. Close the season and hand the trophy to whoever is on top.
      if (phase !== "trials") {
        return {
          type: "contest",
          contest,
          reason: "skipped",
          skippedBecause: reason,
          champion: closeSeason(world, now),
        };
      }
      return { type: "contest", contest, reason: "skipped", skippedBecause: reason };
    }
    contest.state = "live";
    return { type: "contest", contest, reason: "live" };
  }

  if (contest.state !== "live") return null;

  if (now >= contest.endsAt) return resolveContest(world, contest, now);

  // One row per entrant per turn — exactly what `scoreContest` folds over.
  // `wasSpit` is `endure`'s only input besides spirit, and it comes from the
  // turn's own spit event.
  //
  // No cap here, and that is a decision rather than an oversight: the trail is
  // already bounded by the window (durationMs ÷ tick × entrants ≈ 600 rows for
  // a full roster). Capping it mid-contest would score the contest on a
  // truncated slice of itself — `CONTEST.persistSamples` is a *save* budget and
  // is applied at resolve time instead.
  const byId = new Map(world.herd.map((r) => [r.id, r]));
  const spit = new Set([...spatThisTick, ...drainSpits()]);
  const lookup = {
    place: (id: string) => byId.get(id)?.mind.doing.place ?? null,
    spirits: (id: string) => byId.get(id)?.mind.spirits ?? 0,
    get spatThisTick() {
      return [...spit];
    },
  };
  contest.samples.push(...takeSamples(now, contest.entrants, lookup));
  return null;
}

function resolveContest(world: TownSnapshot, contest: Contest, now: number): TournamentEvent {
  // D5: the contest continues with whoever is really competing. The roster on
  // the contest is left intact — it is what the HUD shows and what the
  // newspaper names — but a forfeiter is not scored, because a llama the sim
  // was driving on their behalf is not them (see `forfeitingEntrants`).
  const forfeiting = forfeitingEntrants(world, contest, now);
  const competing = contest.entrants.filter((id) => !forfeiting.includes(id));

  const result: ContestResult = scoreContest({
    kind: contest.kind,
    place: contest.place,
    entrants: competing,
    samples: contest.samples,
    resolvedAt: now,
  });
  contest.result = result;
  contest.state = "resolved";
  // 08 §11, applied at the moment the contest becomes save data: score over the
  // *whole* trail, then keep the newest 200 rows for the file. Trimming after
  // `scoreContest` rather than before it is the whole point of the split.
  contest.samples = trimSamples(contest.samples);

  const season = world.season ?? createSeason(1, now);
  // The phase a contest *counted as* is the one it was announced in, not the
  // one the table now says — a final that advances the phase must still be
  // folded in before the board is wiped.
  world.season = applyContestResult(season, result, { contestId: contest.id, kind: contest.kind });

  const event: TournamentEvent = { type: "contest", contest, reason: "resolved" };
  if (seasonPhase(world.season) === "closed") {
    event.champion = closeSeason(world, now);
  } else {
    world.season.state = seasonPhase(world.season);
  }
  return event;
}

/**
 * 08 §5: the season is over. The champion is the leader of the board that was
 * just closed, and the new season opens empty — that reset is the entire return
 * hook, because there is no token (D10) and a fresh leaderboard is the only
 * reason to come back.
 *
 * Returns the champion's agent id, or `null` when nobody ever contested.
 */
function closeSeason(world: TownSnapshot, now: number): string | null {
  const season = world.season;
  if (!season) return null;
  const { season: next, champion } = rollSeason(season, now);
  world.season = { ...next, state: "trials", champion: champion?.agentId };
  return champion?.agentId ?? null;
}

// ---------------------------------------------------------------------------
// retirement + forfeits
// ---------------------------------------------------------------------------

/**
 * 08 §10.1: the HUD is transient. A result card stays up for `resultCardMs`
 * and is then dropped, so the town is allowed to be quiet again.
 *
 * `endsAt` is the reference for every resolved contest, resolved or skipped: a
 * contest that never had enough entrants (D6) is closed at its `startsAt`, so
 * measuring from `endsAt` simply lets it linger until the day would have ended
 * anyway. One rule, no extra field on the save.
 *
 * A couple of cards are kept so a reload during the result window does not
 * lose the result the Daily Spit is about to cite.
 */
export function retireResolved(world: TownSnapshot, now = Date.now()): string[] {
  if (!world.contests) return [];
  const resolved = world.contests.filter((c) => c.state === "resolved");
  if (resolved.length === 0) return [];
  // The retention window comes first and the *count* cap second. Applying the
  // cap alone meant `keep` swallowed every resolved contest while there were
  // three or fewer of them, so the `resultCardMs` promise in the docstring was
  // never actually observed: 1 → 1, 2 → 2, 3 → 3, and only the fourth was
  // dropped. A card is dropped when it is both older than its moment and not
  // among the most recent few.
  const keep = new Set(resolved.slice(-KEEP_RESOLVED).map((c) => c.id));
  const dropped: string[] = [];
  for (const c of resolved) {
    if (keep.has(c.id)) continue;
    if (now - c.endsAt < CONTEST.resultCardMs) continue;
    dropped.push(c.id);
  }
  if (dropped.length === 0) return [];
  const gone = new Set(dropped);
  world.contests = world.contests.filter((c) => !gone.has(c.id));
  return dropped;
}

/**
 * D5, D7: an entrant that did not really compete.
 *
 * Two ways that happens, and the first one is not the obvious one:
 *
 *  1. **AFK.** `isEligibleForSim` deliberately hands an AFK external's
 *     resident to the sim, so a stand-in llama goes on walking the venue and
 *     the sampler keeps producing perfectly good rows for it. Keying the
 *     forfeit off "no evidence" therefore never fired: the agent collected
 *     season points for a llama playing on their behalf. Keying it off
 *     `isAfk` at resolve time is both the honest reading of D7 and the
 *     anti-grief behaviour — registering, walking away, and letting the town
 *     score for you is exactly what D7 exists to stop.
 *  2. **Silence.** Registered but never sampled at all.
 *
 * A house bot is never a forfeiter: it has no `AgentRecord`, it is simulated
 * like any other resident, and the whole point of it competing is that the
 * town — not an absent author — is playing.
 */
export function forfeitingEntrants(world: TownSnapshot, contest: Contest, now = Date.now()): string[] {
  const present = new Set(contest.samples.map((s) => s.agentId));
  return contest.entrants.filter((id) => {
    const record = (world.agents ?? []).find((a) => a.residentId === id);
    if (record === undefined) return false;
    if (!present.has(id)) return true;
    return isAfk(record, now);
  });
}

/**
 * The sentence the newspaper prints when somebody did not turn up.
 *
 * Naming them is the point. D5 keeps the contest running and D7 keeps the win
 * worthless, but a forfeit that is only visible as a gap in the standings reads
 * as a bug — "Hux did not show" is what makes the rule believable.
 */
export function forfeitNotice(world: TownSnapshot, contest: Contest, now = Date.now()): string {
  const missing = forfeitingEntrants(world, contest, now);
  if (missing.length === 0) return "";
  const names = missing.map((id) => residentOf(world, id)?.name ?? id);
  if (names.length === 1) return `${names[0]} did not show`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!} did not show`;
}
