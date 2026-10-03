import { describe, it, expect } from "vitest";
import { LOCATIONS } from "../src/canvas/locationsData.js";
import {
  ROADS, TREES, PROPS, LIGHTS, VEHICLES, FORESTS,
  tickScenery, lightState, drawTerrainDecor, pushScenery, type QueueItem,
} from "../src/canvas/scenery.js";

function mockCtx(): [CanvasRenderingContext2D, Record<string, number>] {
  const calls: Record<string, number> = {};
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      const key = String(prop);
      calls[key] = (calls[key] ?? 0) + 1;
      if (key === "createRadialGradient" || key === "createLinearGradient") {
        return () => ({ addColorStop() {} });
      }
      if (key === "measureText") return () => ({ width: 10 });
      return typeof prop === "string" ? () => undefined : undefined;
    },
    set() { return true; },
  });
  return [ctx, calls];
}

function rectHit(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  m = 0,
): boolean {
  return a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;
}

describe("scenery", () => {
  it("roads never overlap a building footprint", () => {
    for (const r of ROADS) {
      const road = { x: r.x1, y: r.y1, w: r.x2 - r.x1 + 1, h: r.y2 - r.y1 + 1 };
      for (const l of LOCATIONS) {
        expect(
          rectHit(road, { x: l.x, y: l.y, w: l.w, h: l.h }),
          `road ${r.x1},${r.y1} overlaps ${l.id}`,
        ).toBe(false);
      }
    }
  });

  it("generates forest, props and traffic lights", () => {
    expect(TREES.length).toBeGreaterThan(60);
    expect(TREES.length).toBeGreaterThanOrEqual(1023); // ≥2.5x baseline (409)
    expect(FORESTS.length).toBeGreaterThanOrEqual(9);
    expect(TREES.some((t) => t.kind === "birch"), "birch trees should exist").toBe(true);
    // pine/bush only became reachable after the h2 rescale — keep all kinds alive
    for (const kind of ["oak", "pine", "bush", "birch"] as const) {
      expect(TREES.some((t) => t.kind === kind), `no ${kind} tree`).toBe(true);
    }

    // forest zones must not overlap each other
    for (let i = 0; i < FORESTS.length; i++) {
      for (let j = i + 1; j < FORESTS.length; j++) {
        const a = FORESTS[i]!, b = FORESTS[j]!;
        expect(
          rectHit(a, b),
          `${a.name} overlaps ${b.name}`,
        ).toBe(false);
      }
    }

    // forest zones must not cover a building footprint or a road
    // (road check covers the new zones only: Southwest Forest crossed West Loop
    //  by design — its floor paints under the asphalt)
    const NEW_ZONES = new Set([
      "Willowbank Grove", "North Central Grove", "South Central Grove",
      "Pondside Woods", "East Ridge Woods",
    ]);
    for (const f of FORESTS) {
      for (const l of LOCATIONS) {
        expect(
          rectHit(f, { x: l.x, y: l.y, w: l.w, h: l.h }),
          `${f.name} overlaps building ${l.id}`,
        ).toBe(false);
      }
      if (!NEW_ZONES.has(f.name)) continue;
      for (const r of ROADS) {
        expect(
          rectHit(f, { x: r.x1, y: r.y1, w: r.x2 - r.x1 + 1, h: r.y2 - r.y1 + 1 }),
          `${f.name} overlaps a road`,
        ).toBe(false);
      }
    }
    expect(PROPS.length).toBeGreaterThan(30);
    expect(LIGHTS.length).toBe(10);
  });

  it("the 8 new buildings never overlap another footprint", () => {
    // pairwise-old overlaps are pre-existing by design (square/board, pond/dock),
    // so only the appended buildings are checked against the whole catalog.
    const NEW_IDS = ["stables", "granary", "warehouse", "chapel", "inn", "smithy", "farmhouse", "theatre"];
    for (const id of NEW_IDS) {
      const b = LOCATIONS.find((l) => l.id === id);
      expect(b, `missing building ${id}`).toBeDefined();
      for (const l of LOCATIONS) {
        if (l.id === id) continue;
        expect(
          rectHit({ x: b!.x, y: b!.y, w: b!.w, h: b!.h }, { x: l.x, y: l.y, w: l.w, h: l.h }),
          `${id} overlaps ${l.id}`,
        ).toBe(false);
      }
      // arrival spot sits on the row right below the footprint
      expect(b!.spot[1], `${id} spot not below footprint`).toBe(b!.y + b!.h + 1);
      expect(["Food", "Water"], `${id} must not be Food/Water (renders as field)`).not.toContain(b!.category);
    }
  });

  it("no tree sits on a road or building", () => {
    for (const t of TREES) {
      const tileX = Math.floor(t.x / 16);
      const tileY = Math.floor((t.y - 14) / 16);
      for (const l of LOCATIONS) {
        const inside =
          tileX >= l.x - 1 && tileX < l.x + l.w + 1 && tileY >= l.y - 1 && tileY < l.y + l.h + 1;
        expect(inside, `tree at ${tileX},${tileY} inside ${l.id}`).toBe(false);
      }
      for (const r of ROADS) {
        const onRd =
          tileX >= r.x1 - 1 && tileX <= r.x2 + 1 && tileY >= r.y1 - 1 && tileY <= r.y2 + 1;
        expect(onRd, `tree at ${tileX},${tileY} on road`).toBe(false);
      }
    }
  });

  it("traffic light cycles green/yellow/red per axis", () => {
    expect(lightState(0, "h")).toBe("green");
    expect(lightState(0, "v")).toBe("red");
    expect(lightState(5.5, "h")).toBe("yellow");
    expect(lightState(7, "v")).toBe("green");
    expect(lightState(11.5, "v")).toBe("yellow");
    // never green on both axes at once
    for (let t = 0; t < 12; t += 0.1) {
      expect(lightState(t, "h") === "green" && lightState(t, "v") === "green").toBe(false);
    }
  });

  it("vehicles stay in the world and keep moving", () => {
    const before = VEHICLES.map((v) => ({ x: v.x, y: v.y }));
    for (let i = 0; i < 600; i++) tickScenery(1 / 30, i / 30);
    VEHICLES.forEach((v, i) => {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(3360);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeLessThanOrEqual(2048);
      const moved = Math.hypot(v.x - before[i]!.x, v.y - before[i]!.y);
      expect(moved, `vehicle ${i} never moved`).toBeGreaterThan(0);
    });
  });

  it("vehicles drive on road tiles (lane check)", () => {
    for (const v of VEHICLES) {
      const onSomeRoad = ROADS.some((r) => {
        const left = r.x1 * 16 + 5, right = (r.x2 + 1) * 16 - 5;
        const top = r.y1 * 16 + 5, bottom = (r.y2 + 1) * 16 - 5;
        return v.x >= left && v.x <= right && v.y >= top && v.y <= bottom;
      });
      expect(onSomeRoad, `vehicle at ${Math.round(v.x)},${Math.round(v.y)} off road`).toBe(true);
    }
  });

  it("draws terrain decor without a DOM canvas (smoke via mock ctx)", () => {
    const [ctx, calls] = mockCtx();
    const view = { l: 0, r: 3360, t: 0, b: 2048 };
    expect(() => drawTerrainDecor(ctx, view, { isDark: false, night: 0, time: 0 })).not.toThrow();
    const total = Object.values(calls).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(100);
  });

  it("pushes traffic lights into the draw queue and renders 3 bulbs + pole", () => {
    const target = LIGHTS[0]!;
    const view = { l: target.x - 60, r: target.x + 60, t: target.y - 80, b: target.y + 60 };
    const [ctx, calls] = mockCtx();
    const queue: QueueItem[] = [];
    pushScenery(queue, ctx, view, { isDark: false, night: 0, time: 0 });
    expect(queue.length).toBeGreaterThan(0);

    // execute ONLY the item anchored at the traffic light's base y
    const lightItems = queue.filter((q) => Math.abs(q.y - target.y) < 0.01);
    expect(lightItems.length, "traffic light not pushed to queue").toBeGreaterThanOrEqual(1);
    const before = { ...(calls as Record<string, number>) };
    for (const item of lightItems) item.draw();
    const arcs = (calls["arc"] ?? 0) - (before["arc"] ?? 0);
    const rects = (calls["fillRect"] ?? 0) - (before["fillRect"] ?? 0);
    expect(arcs, "signal head should draw 3 bulbs (+glow rings)").toBeGreaterThanOrEqual(3);
    expect(rects, "signal head + v-indicator rects").toBeGreaterThanOrEqual(2);
  });

  it("pushes vehicles and trees near an intersection view", () => {
    const target = LIGHTS[0]!;
    const view = { l: target.x - 200, r: target.x + 200, t: target.y - 200, b: target.y + 200 };
    const [ctx] = mockCtx();
    const queue: QueueItem[] = [];
    pushScenery(queue, ctx, view, { isDark: true, night: 0.8, time: 5 });
    expect(queue.length).toBeGreaterThanOrEqual(1);
    expect(() => { for (const item of queue) item.draw(); }).not.toThrow();
  });
});
