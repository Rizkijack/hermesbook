import { describe, it, expect } from "vitest";
import { Xf } from "../src/canvas/engine.js";
import { navmap } from "../src/canvas/navmap.js";
import { LOCATIONS } from "../src/canvas/locationsData.js";
import { ROADS } from "../src/canvas/scenery.js";
import { Pe, vt } from "../src/canvas/constants.js";

// 09 movement realism — the regression suite for the "10.08 px per 5 seconds"
// crawl. Before the physics rework, `tick()` added position kicks per frame and
// the walk branch never integrated a real velocity, so an agent given a waypoint
// 100 px away covered a tenth of it. These tests pin the four properties the
// fix promised: real distance, bounded steps (no teleports), no drift at rest,
// and a gait that follows the ground actually covered — plus the navmap the
// pathfinder now walks on.

function sprite(id: string, x: number, y: number) {
  return {
    id, name: id, handle: id, genes: "", x, y, tx: x, ty: y, path: [],
    facing: 1 as const, doing: "wander", place: "square", mood: 0, born: 0,
    vx: 0, vy: 0, baseSpeed: 1, wanderTimer: 99, walkPhase: 0, idlePhase: 0,
    targetPlace: "square",
  };
}

/** Waypoint 100 px due east: tile (37, 31) centre = 37*16+8 = 600. */
const WAYPOINT = [{ x: 37, y: 31 }];

describe("movement — distance & physics", () => {
  it("covers the distance in 5 s (regression: 10.08 px/5 s → ≥60 px)", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    a.path = [...WAYPOINT];
    xf.byId.set("a", a as never);
    const x0 = a.x;
    for (let i = 0; i < 300; i++) xf.tick(1 / 60); // 5 s
    const travelled = a.x - x0;
    // waypoint is 100 px away; arrival radius stops them just short of it
    expect(travelled).toBeGreaterThanOrEqual(60);
    expect(travelled).toBeLessThanOrEqual(110);
    expect(a.path.length).toBe(0); // waypoint consumed along the way
  });

  it("never moves more than one frame of velocity — no teleports", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    a.path = [...WAYPOINT];
    xf.byId.set("a", a as never);
    let maxStep = 0;
    let px = a.x;
    let py = a.y;
    for (let i = 0; i < 300; i++) {
      xf.tick(1 / 60);
      const step = Math.hypot(a.x - px, a.y - py);
      maxStep = Math.max(maxStep, step);
      px = a.x;
      py = a.y;
    }
    // walk speed 34 px/s · 1.12 jitter + 2 sway ≈ 40 px/s ≈ 0.7 px/frame;
    // 5 px is a teleport guard, not a speed limit
    expect(maxStep).toBeLessThan(5);
  });

  it("walkPhase follows the ground actually covered (0.04 cycle per px)", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    a.path = [...WAYPOINT];
    xf.byId.set("a", a as never);
    let px = a.x;
    let py = a.y;
    let movedTotal = 0;
    for (let i = 0; i < 300; i++) {
      xf.tick(1 / 60);
      movedTotal += Math.hypot(a.x - px, a.y - py);
      px = a.x;
      py = a.y;
    }
    expect(movedTotal).toBeGreaterThan(60);
    expect(a.walkPhase).toBeCloseTo((movedTotal * 0.04) % 1, 4);
  });
});

describe("movement — rest & sleep stay still", () => {
  it("an idle resident with no path does not drift", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    xf.byId.set("a", a as never);
    for (let i = 0; i < 300; i++) xf.tick(1 / 60);
    expect(a.x).toBe(500);
    expect(a.y).toBe(500);
    expect(a.walkPhase).toBe(0);
  });

  it("a sleeping resident holds their pose even with a stale waypoint", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    a.doing = "sleep";
    a.path = [...WAYPOINT]; // a bedtime order can leave a path behind
    xf.byId.set("a", a as never);
    for (let i = 0; i < 300; i++) xf.tick(1 / 60);
    // no sway jiggle (zero-speed act), no gait animation while asleep
    expect(a.x).toBe(500);
    expect(a.y).toBe(500);
    expect(a.walkPhase).toBe(0);
  });
});

describe("movement — crowd spacing (formation)", () => {
  it("separates two residents sharing personal space, gradually and bounded", () => {
    const xf = new Xf();
    const a = sprite("a", 500, 500);
    const b = sprite("b", 508, 500); // 8 px apart, SEP_R is 14
    xf.byId.set("a", a as never);
    xf.byId.set("b", b as never);
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    let maxStep = 0;
    let pa = { x: a.x, y: a.y };
    let pb = { x: b.x, y: b.y };
    for (let i = 0; i < 60; i++) {
      xf.tick(1 / 60);
      maxStep = Math.max(
        maxStep,
        Math.hypot(a.x - pa.x, a.y - pa.y),
        Math.hypot(b.x - pb.x, b.y - pb.y),
      );
      pa = { x: a.x, y: a.y };
      pb = { x: b.x, y: b.y };
    }
    const d1 = Math.hypot(a.x - b.x, a.y - b.y);
    // pushed out of each other's 14 px bubble — as a speed, never a shove
    expect(d1).toBeGreaterThan(d0);
    expect(d1).toBeGreaterThan(14);
    expect(maxStep).toBeLessThan(5);
  });
});

describe("navmap — the collision/navigation map pf() walks on", () => {
  it("treats building footprints as solid but keeps the square open", () => {
    const nav = navmap();
    const buildings = LOCATIONS.filter((l) => l.id !== "square");
    expect(buildings.length).toBeGreaterThan(0);
    for (const loc of buildings) {
      expect(nav.solid(loc.x, loc.y), `${loc.id} footprint`).toBe(true);
    }
    const square = LOCATIONS.find((l) => l.id === "square");
    expect(square).toBeDefined();
    expect(nav.solid(square!.spot[0], square!.spot[1])).toBe(false);
  });

  it("makes every arrival spot walkable and reachable from open ground", () => {
    const nav = navmap();
    for (const loc of LOCATIONS) {
      const [sx, sy] = loc.spot;
      expect(nav.walkable(sx, sy), `${loc.id} spot walkable`).toBe(true);
      expect(nav.reachable(sx, sy), `${loc.id} spot reachable`).toBe(true);
    }
  });

  it("prices road tiles cheap for A* and treats the world edge as a wall", () => {
    const nav = navmap();
    expect(ROADS.length).toBeGreaterThan(0);
    const r = ROADS[0]!;
    expect(nav.at((r.x1 + r.x2) >> 1, (r.y1 + r.y2) >> 1)).toBe(2);
    expect(nav.solid(-1, -1)).toBe(true);
    expect(nav.solid(Pe, vt)).toBe(true);
    expect(nav.solid(0, 0)).toBe(false); // open ground at the origin
  });
});
