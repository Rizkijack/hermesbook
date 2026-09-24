import { describe, it, expect } from "vitest";
import { createInitialWorld, generateEdition, generateWeatherEvent } from "../src/world.js";
import { LOCATIONS } from "../src/locations.js";
import { Pe, V, WorldSize } from "../src/map.js";

describe("World", () => {
  it("has 26 locations", () => {
    expect(LOCATIONS.length).toBe(26);
    expect(LOCATIONS.find((l) => l.id === "square")!.x).toBe(96);
  });

  it("map dimensions 3360x2048", () => {
    expect(Pe * V).toBe(3360);
    expect(WorldSize.width).toBe(3360);
    expect(WorldSize.height).toBe(2048);
  });

  it("initial world 8 herd", () => {
    const w = createInitialWorld();
    expect(w.herd.length).toBe(8);
    expect(w.config.maxHerd).toBe(64);
    expect(w.config.name).toBe("Hermesbook");
    expect(w.feed.length).toBeGreaterThan(0);
    expect(w.editions.length).toBe(1);
  });

  it("generateEdition increments no and has required fields", () => {
    const w = createInitialWorld();
    const ed = generateEdition(w);
    expect(ed.no).toBe(2);
    expect(ed.headline).toBeTruthy();
    expect(ed.standfirst).toContain("residents");
    expect(ed.stories.length).toBe(2);
    expect(ed.weather).toBeTruthy();
    expect(ed.quote.who).toBeTruthy();
  });

  it("generateWeatherEvent kind weather", () => {
    const ev = generateWeatherEvent();
    expect(ev.kind).toBe("weather");
    expect(ev.text).toBeTruthy();
    expect(ev.t).toBeGreaterThan(0);
  });
});
