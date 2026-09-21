import type { Genes } from "@hermesbook/shared";
import { BUF_W, BUF_H, rgba } from "./pixelBuffer.js";
import type { Skeleton } from "./skeleton.js";

function h2rgb(h: number): [number, number, number] {
  const s = 0.52, l = 0.78;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function fillRect(buf: Uint32Array, x: number, y: number, w: number, h: number, col: number): void {
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= BUF_H) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= BUF_W) continue;
      buf[yy * BUF_W + xx] = col;
    }
  }
}

export function renderLlama(genes: Genes, sk: Skeleton): Uint32Array {
  const buf = new Uint32Array(BUF_W * BUF_H);
  const [r, g, b] = h2rgb(genes.hue % 360);
  const wool = rgba(r, g, b, 255);
  const woolShade = rgba(Math.max(0, r - 18), Math.max(0, g - 18), Math.max(0, b - 18), 255);
  const outline = rgba(27, 25, 21, 255);
  const eyeWhite = rgba(255, 255, 255, 255);
  const eyePupil = rgba(27, 25, 21, 255);
  const pink = rgba(240, 170, 170, 255);

  // body block with build/neck influence
  const bw = Math.round(18 + genes.build * 10); // 18..27
  const bh = Math.round(14 + genes.build * 6);
  const bx = Math.round(14 - bw / 2 + 7);
  const by = Math.round(22 + sk.bodyY);

  // shadow under feet
  fillRect(buf, bx - 2, 44, bw + 4, 2, rgba(0, 0, 0, 45));

  // body
  fillRect(buf, bx, by, bw, bh, wool);
  // outline bottom
  fillRect(buf, bx, by + bh, bw, 1, outline);

  // legs 4
  for (const [lx, ly] of sk.legs) {
    const lx2 = Math.round(lx + (bx - 15));
    fillRect(buf, lx2, ly - 8, 3, 9, woolShade);
    fillRect(buf, lx2, ly, 3, 1, outline);
  }

  // neck
  const neckH = Math.round(10 + genes.neck * 10);
  const nx = bx + Math.round(bw / 2) - 3 + Math.round(sk.neckLean * 8);
  const ny = by - neckH + Math.round(sk.neckCurve * 4);
  fillRect(buf, nx, ny, 6, neckH, wool);
  fillRect(buf, nx, ny, 6, 1, outline);

  // head
  const hx = nx - 2;
  const hy = ny - 8 + Math.round(sk.headTilt * 6);
  const hw = 12, hh = 10;
  fillRect(buf, hx, hy, hw, hh, wool);
  fillRect(buf, hx, hy, hw, 1, outline);
  fillRect(buf, hx, hy + hh, hw, 1, outline);

  // ears
  const earY = hy - 3;
  fillRect(buf, hx + 1 + Math.round(sk.earL * 4), earY, 3, 4, woolShade);
  fillRect(buf, hx + 8 + Math.round(sk.earR * 4), earY, 3, 4, woolShade);
  // ear style variations
  if (genes.ears === "droop") {
    fillRect(buf, hx + 1, earY + 2, 3, 2, woolShade);
    fillRect(buf, hx + 8, earY + 2, 3, 2, woolShade);
  }

  // eyes
  const eyeY = hy + 3;
  const eyeOpen = sk.lid < 0.5;
  if (eyeOpen) {
    // left eye
    fillRect(buf, hx + 2, eyeY, 3, 2, eyeWhite);
    fillRect(buf, hx + 3, eyeY + 1, 1, 1, eyePupil);
    // right eye
    fillRect(buf, hx + 7, eyeY, 3, 2, eyeWhite);
    fillRect(buf, hx + 8, eyeY + 1, 1, 1, eyePupil);

    if (genes.eyes === "squint") {
      fillRect(buf, hx + 2, eyeY, 3, 1, wool);
      fillRect(buf, hx + 7, eyeY, 3, 1, wool);
    } else if (genes.eyes === "wide") {
      fillRect(buf, hx + 2, eyeY + 2, 3, 1, eyeWhite);
      fillRect(buf, hx + 7, eyeY + 2, 3, 1, eyeWhite);
    } else if (genes.eyes === "dot") {
      fillRect(buf, hx + 3, eyeY, 1, 1, eyePupil);
      fillRect(buf, hx + 8, eyeY, 1, 1, eyePupil);
    }
  } else {
    // closed lid line
    fillRect(buf, hx + 2, eyeY + 1, 3, 1, outline);
    fillRect(buf, hx + 7, eyeY + 1, 3, 1, outline);
  }

  // jaw / mouth
  const mouthY = hy + 7 + Math.round(sk.jaw * 2);
  fillRect(buf, hx + 4, mouthY, 4, 1, genes.extra === "none" ? outline : pink);
  if (sk.jaw > 0.3) fillRect(buf, hx + 5, mouthY + 1, 2, 1, rgba(120, 60, 60, 255));

  // cut variation on top of head
  if (genes.cut === "mohawk") fillRect(buf, hx + 5, hy - 2, 2, 3, outline);
  else if (genes.cut === "bowl") fillRect(buf, hx, hy - 1, hw, 2, woolShade);
  else if (genes.cut === "curly") { fillRect(buf, hx + 2, hy - 2, 8, 2, woolShade); fillRect(buf, hx + 4, hy - 3, 4, 1, woolShade); }
  else if (genes.cut === "afro") fillRect(buf, hx - 1, hy - 3, hw + 2, 3, woolShade);

  // accessories
  if (genes.extra === "hat") {
    fillRect(buf, hx - 1, hy - 4, hw + 2, 2, rgba(200, 50, 50, 255));
    fillRect(buf, hx + 2, hy - 6, 8, 2, rgba(200, 50, 50, 255));
  } else if (genes.extra === "bell") {
    fillRect(buf, nx + 2, ny + neckH - 2, 2, 2, rgba(220, 190, 60, 255));
  } else if (genes.extra === "glasses") {
    fillRect(buf, hx + 1, eyeY - 1, 4, 3, rgba(30, 30, 30, 80));
    fillRect(buf, hx + 6, eyeY - 1, 4, 3, rgba(30, 30, 30, 80));
  } else if (genes.extra === "scarf") {
    fillRect(buf, nx - 1, ny + 4, 8, 3, rgba(220, 60, 60, 255));
  } else if (genes.extra === "flower") {
    fillRect(buf, hx + 9, hy - 2, 2, 2, pink);
    fillRect(buf, hx + 8, hy - 1, 4, 1, pink);
  }

  // tail wag
  const tailX = bx - 2 + Math.round(sk.tail * 2);
  fillRect(buf, tailX, by + 4, 3, 3, woolShade);

  return buf;
}
