import { describe, it, expect } from "vitest";
import { Hc } from "@hermesbook/shared";
import { renderLlama } from "../src/canvas/renderer/draw.js";
import { sf } from "../src/canvas/renderer/skeleton.js";
import { BUF_W } from "../src/canvas/renderer/pixelBuffer.js";
import { LOCATIONS } from "../src/canvas/locationsData.js";
import { V } from "../src/canvas/constants.js";
import { NPC_H, NPC_SCALE } from "../src/canvas/engine.js";

/**
 * The spec this guards: a resident is 1/10 of a building and 1/3 of a car.
 * drawVehicle in canvas/scenery.ts paints the body from -14 to 14.
 */
const CAR_BODY = 28;

/** Short- and long-neck stock, so the measurement is not one pose. */
const DNA = ["2.1.0.3.1.42.55.62.1", "2.1.0.3.1.200.55.62.1"];

function inkBox(dna: string): { top: number; bottom: number } {
  const buf = renderLlama(Hc(dna), sf({ t: 0, walkPhase: 0, doing: "work", facing: 1 }));
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) continue;
    const y = Math.floor(i / BUF_W);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { top, bottom };
}

describe("resident proportions — NPC = 1/10 building = 1/3 car", () => {
  it("the blit really makes an NPC_H-tall figure", () => {
    for (const dna of DNA) {
      const { top, bottom } = inkBox(dna);
      const worldH = (bottom - top + 1) * NPC_SCALE;
      expect(worldH, `${dna} ink ${top}..${bottom} → ${worldH}px`).toBeGreaterThan(9);
      expect(worldH, `${dna} ink ${top}..${bottom} → ${worldH}px`).toBeLessThan(12);
    }
  });

  it("keeps every inked row on the ground band the blit anchors", () => {
    // engine draws buffer row 45 (the hooves) exactly on the agent's x/y:
    // hooves at 45, contact shadow at 46-47, nothing below that
    for (const dna of DNA) {
      const { bottom } = inkBox(dna);
      expect(bottom, `${dna} bottom row ${bottom}`).toBeGreaterThanOrEqual(45);
      expect(bottom, `${dna} bottom row ${bottom}`).toBeLessThanOrEqual(47);
    }
  });

  it("measures 1/10 of a building", () => {
    // school = 7×4 tiles → 112×64 world px; a resident has to sit between
    // a tenth of its height and a tenth of its width
    const school = LOCATIONS.find((l) => l.id === "school");
    expect(school).toBeDefined();
    const w = school!.w * V;
    const h = school!.h * V;
    expect(NPC_H, `${NPC_H} vs building height ${h}`).toBeGreaterThanOrEqual(h / 10);
    expect(NPC_H, `${NPC_H} vs building width ${w}`).toBeLessThanOrEqual(w / 10);
  });

  it("measures 1/3 of a car", () => {
    expect(Math.abs(NPC_H - CAR_BODY / 3), `${NPC_H} vs car ${CAR_BODY} / 3`).toBeLessThanOrEqual(1);
  });

  it("the building and car readings agree with each other", () => {
    const school = LOCATIONS.find((l) => l.id === "school")!;
    const buildingTenth = (school.w * V) / 10;
    const carThird = CAR_BODY / 3;
    expect(buildingTenth - carThird, `${buildingTenth} vs ${carThird}`).toBeLessThan(3);
  });
});
