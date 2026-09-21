import { V, WorldWidth, WorldHeight } from "./constants.js";
import { LOCATIONS } from "./locationsData.js";
import { pf } from "./pf.js";
import { Hc } from "@hermesbook/shared";
import { renderLlama } from "./renderer/draw.js";
import { sf } from "./renderer/skeleton.js";
import { BUF_W, BUF_H } from "./renderer/pixelBuffer.js";

export interface AgentSprite {
  id: string;
  name: string;
  handle: string;
  genes: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  path: Array<{ x: number; y: number }>;
  facing: 1 | -1;
  doing: string;
  place: string;
  mood: number;
  born: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: "spit" | "dust";
}

interface SpeechBubble {
  text: string;
  until: number;
  by: string;
}

export class Xf {
  cam = { x: 1600, y: 900, tx: 1600, ty: 900, zoom: 1, tz: 1 };
  clock = 0; // 0..1
  dayLength = 900;
  byId = new Map<string, AgentSprite>();
  puffs: Puff[] = [];
  bubbles: SpeechBubble[] = [];
  followId: string | null = null;
  private t = 0;

  worldW = WorldWidth;
  worldH = WorldHeight;

  constructor(snapshot?: { herd: Array<{ id: string; name: string; handle: string; genes: string; mind: { doing: { place: string; act: string } }; born: number; }>; }) {
    if (snapshot) {
      for (const h of snapshot.herd) {
        const loc = LOCATIONS.find((l) => l.id === h.mind.doing.place) ?? LOCATIONS[0]!;
        const sx = loc.spot[0] * V + (Math.random() * 24 - 12);
        const sy = loc.spot[1] * V + (Math.random() * 24 - 12);
        this.byId.set(h.id, {
          id: h.id,
          name: h.name,
          handle: h.handle,
          genes: h.genes,
          x: sx,
          y: sy,
          tx: sx,
          ty: sy,
          path: [],
          facing: Math.random() < 0.5 ? 1 : -1,
          doing: h.mind.doing.act,
          place: h.mind.doing.place,
          mood: 0,
          born: h.born,
        });
      }
    }
  }

  setFollow(id: string | null) {
    this.followId = id;
  }

  tick(dt: number): void {
    this.t += dt;
    this.clock = (this.clock + dt / this.dayLength) % 1;
    this.cam.x += (this.cam.tx - this.cam.x) * 0.08;
    this.cam.y += (this.cam.ty - this.cam.y) * 0.08;
    this.cam.zoom += (this.cam.tz - this.cam.zoom) * 0.08;

    // move agents along path
    for (const a of this.byId.values()) {
      if (a.path.length > 0) {
        const next = a.path[0]!;
        const tx = next.x * V + V / 2;
        const ty = next.y * V + V / 2;
        const dx = tx - a.x;
        const dy = ty - a.y;
        const dist = Math.hypot(dx, dy);
        const speed = 38 * dt; // px per sec
        if (dist < speed) {
          a.x = tx;
          a.y = ty;
          a.path.shift();
        } else {
          a.x += (dx / dist) * speed;
          a.y += (dy / dist) * speed;
          a.facing = dx > 0 ? 1 : -1;
        }
        a.doing = "work";
      }
      // random idle drift tiny
      if (a.path.length === 0 && Math.random() < 0.004) {
        a.x += (Math.random() - 0.5) * 6;
        a.y += (Math.random() - 0.5) * 6;
      }
    }

    // puffs life
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt; // gravity
      p.life -= dt;
      if (p.life <= 0) this.puffs.splice(i, 1);
    }

    // bubbles expire
    const now = Date.now();
    this.bubbles = this.bubbles.filter((b) => b.until > now);

    // follow
    if (this.followId) {
      const f = this.byId.get(this.followId);
      if (f) {
        this.cam.tx = f.x;
        this.cam.ty = f.y;
      }
    }
  }

  order(id: string, act: string, place: string, _secs: number): void {
    const a = this.byId.get(id);
    if (!a) return;
    a.doing = act;
    a.place = place;
    const loc = LOCATIONS.find((l) => l.id === place);
    if (loc) {
      const tx = loc.spot[0];
      const ty = loc.spot[1];
      // pf expects tile coords
      const sx = Math.floor(a.x / V);
      const sy = Math.floor(a.y / V);
      // simple map for pf: provide at/solid
      const mapLike = {
        at(_x: number, _y: number) { return 0; },
        solid(x: number, y: number) { return x < 0 || y < 0 || x >= 210 || y >= 128; },
      };
      const path = pf(mapLike, sx, sy, tx, ty);
      a.path = path;
    }
  }

  spit(fromId: string, toId: string): void {
    const attacker = this.byId.get(fromId);
    const victim = this.byId.get(toId);
    if (!attacker || !victim) return;
    attacker.facing = victim.x > attacker.x ? 1 : -1;
    attacker.doing = "spit";
    setTimeout(() => {
      this.puffs.push({ x: attacker.x + attacker.facing * 22, y: attacker.y - 26, vx: attacker.facing * 140, vy: -30, life: 0.8, kind: "spit" });
      victim.doing = "shake";
      victim.mood -= 0.6;
      setTimeout(() => { if (victim.doing === "shake") victim.doing = "work"; }, 700);
    }, 120);
  }

  post(post: { t: number; by: string; text: string }): void {
    this.bubbles.push({ text: post.text, by: post.by, until: Date.now() + 6000 });
    // keep most recent 8
    if (this.bubbles.length > 8) this.bubbles.shift();
  }

  nightIntensity(): number {
    // night() >0.01 per doc: approximate night curve
    const c = this.clock;
    if (c < 0.72 || c > 0.95) return 0;
    if (c < 0.78) return (c - 0.72) / 0.06;
    if (c < 0.88) return 1;
    return Math.max(0, 1 - (c - 0.88) / 0.07);
  }

  draw(ctx: CanvasRenderingContext2D, viewportW: number, viewportH: number): void {
    const cam = this.cam;
    ctx.save();
    ctx.clearRect(0, 0, viewportW, viewportH);
    // camera transform
    ctx.translate(viewportW / 2, viewportH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // ground
    ctx.fillStyle = "#cfe8c0";
    ctx.fillRect(0, 0, this.worldW, this.worldH);

    // hills tint
    ctx.fillStyle = "#b8d8a8";
    for (let i = 0; i < 30; i++) {
      const x = (i * 137) % this.worldW;
      const y = (i * 241) % this.worldH;
      ctx.beginPath();
      ctx.ellipse(x, y, 80, 40, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // roads
    ctx.strokeStyle = "#d8c9a8";
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (const loc of LOCATIONS) {
      if (loc.category === "Social" || loc.category === "Civic") {
        ctx.rect(loc.x * V, loc.y * V, loc.w * V, loc.h * V);
      }
    }
    ctx.stroke();

    // buildings + agents depth queue
    type Q = { y: number; draw: () => void };
    const queue: Q[] = [];

    // buildings
    const viewLeft = cam.x - viewportW / 2 / cam.zoom - 120;
    const viewRight = cam.x + viewportW / 2 / cam.zoom + 120;
    const viewTop = cam.y - viewportH / 2 / cam.zoom - 120;
    const viewBottom = cam.y + viewportH / 2 / cam.zoom + 120;

    for (const b of LOCATIONS) {
      const bx = b.x * V, by = b.y * V, bw = b.w * V, bh = b.h * V;
      if (bx + bw < viewLeft || bx > viewRight || by + bh < viewTop || by > viewBottom) continue;
      queue.push({
        y: by + bh,
        draw: () => {
          // shadow
          ctx.fillStyle = "rgba(0,0,0,0.08)";
          ctx.fillRect(bx + 6, by + 6, bw, bh);
          // building
          const isDark = this.nightIntensity() > 0.5;
          ctx.fillStyle = isDark ? "#5a4a3a" : "#e8ddd0";
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = "#1b1915";
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, bw, bh);
          // roof
          ctx.fillStyle = "#8b5a3c";
          ctx.fillRect(bx - 2, by - 6, bw + 4, 6);
          // label
          ctx.fillStyle = "#1b1915";
          ctx.font = "8px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.fillText(b.name, bx + bw / 2, by + bh + 10);
          // window light at night
          if (this.nightIntensity() > 0.2) {
            ctx.fillStyle = `rgba(255, 220, 120, ${0.55 * this.nightIntensity()})`;
            ctx.fillRect(bx + bw / 2 - 6, by + bh / 2 - 4, 12, 8);
          }
        },
      });
    }

    // agents
    for (const a of this.byId.values()) {
      if (a.x < viewLeft || a.x > viewRight || a.y < viewTop || a.y > viewBottom) continue;
      queue.push({
        y: a.y,
        draw: () => {
          const genes = Hc(a.genes);
          const sk = sf({ t: this.t, walkPhase: (this.t * 1.6) % 1, doing: a.doing, facing: a.facing });
          // shake effect
          const shake = a.doing === "shake" ? Math.sin(this.t * 40) * 2 : 0;
          const buf = renderLlama(genes, sk);
          // blit buffer to temp canvas then drawImage scaled
          // quick path: draw rect placeholder + buffer detail via offscreen
          const scale = 1.4;
          const w = BUF_W * scale;
          const h = BUF_H * scale;
          // create offscreen canvas lazily
          const off = document.createElement("canvas");
          off.width = BUF_W;
          off.height = BUF_H;
          const octx = off.getContext("2d")!;
          const img = octx.createImageData(BUF_W, BUF_H);
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i]!;
            const a8 = v & 0xff;
            if (a8 === 0) continue;
            img.data[i * 4 + 0] = (v >>> 24) & 0xff;
            img.data[i * 4 + 1] = (v >>> 16) & 0xff;
            img.data[i * 4 + 2] = (v >>> 8) & 0xff;
            img.data[i * 4 + 3] = a8;
          }
          octx.putImageData(img, 0, 0);

          ctx.save();
          ctx.translate(a.x + shake, a.y);
          if (a.facing === -1) {
            ctx.scale(-1, 1);
            ctx.drawImage(off, -w / 2, -h + 12, w, h);
          } else {
            ctx.drawImage(off, -w / 2, -h + 12, w, h);
          }
          // name label
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          // need to re-apply camera? we are already in world transform; use manual screen projection for labels
          // compute screen pos
          const sx = (a.x - cam.x) * cam.zoom + viewportW / 2;
          const sy = (a.y - 56 * scale - cam.y) * cam.zoom + viewportH / 2;
          ctx.font = "10px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.fillStyle = a.id === this.followId ? "#c9a86a" : "#1b1915";
          const labelBgW = a.name.length * 6 + 8;
          ctx.fillStyle = "rgba(244,241,234,0.92)";
          ctx.fillRect(sx - labelBgW / 2, sy - 14, labelBgW, 14);
          ctx.strokeStyle = "#1b1915";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx - labelBgW / 2, sy - 14, labelBgW, 14);
          ctx.fillStyle = "#1b1915";
          ctx.fillText(a.name, sx, sy - 4);
          ctx.restore();
        },
      });
    }

    // props: fires etc as puffs already
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();

    // puffs (spit particles)
    for (const p of this.puffs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === "spit" ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = p.kind === "spit" ? "#cfe8f2" : "rgba(200,180,150,0.7)";
      ctx.fill();
      ctx.strokeStyle = "rgba(27,25,21,0.15)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // speech bubbles
    // sort bubbles: follow priority first
    const sortedBubbles = [...this.bubbles].sort((a, b) => {
      if (a.by === this.followId) return -1;
      if (b.by === this.followId) return 1;
      return b.until - a.until;
    });
    for (const bub of sortedBubbles.slice(0, 3)) {
      const ag = this.byId.get(bub.by);
      if (!ag) continue;
      const sx = ag.x;
      const sy = ag.y - 62;
      const pad = 6;
      ctx.font = "11px Instrument Serif";
      const metrics = ctx.measureText(bub.text);
      const bw = Math.min(220, metrics.width + pad * 2 + 10);
      const lines = wrapText(ctx, bub.text, bw - pad * 2);
      const bh = lines.length * 14 + pad * 2 + 6;
      // bubble rect
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#1b1915";
      ctx.lineWidth = 1.2;
      const bx = sx - bw / 2;
      const by = sy - bh;
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.stroke();
      // tail
      ctx.beginPath();
      ctx.moveTo(sx - 6, by + bh);
      ctx.lineTo(sx, by + bh + 8);
      ctx.lineTo(sx + 6, by + bh);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.stroke();
      // text
      ctx.fillStyle = "#1b1915";
      ctx.textAlign = "left";
      lines.forEach((line, i) => ctx.fillText(line, bx + pad, by + pad + 12 + i * 14));
    }

    ctx.restore();

    // day/night tint overlays (screen space)
    if (this.clock > 0.42 && this.clock < 0.72) {
      const alpha = (this.clock - 0.42) * 0.9;
      ctx.fillStyle = `rgba(255, 170, 90, ${Math.min(0.26, alpha)})`;
      ctx.fillRect(0, 0, viewportW, viewportH);
    }
    const night = this.nightIntensity();
    if (night > 0.01) {
      ctx.fillStyle = `rgba(22, 28, 60, ${night * 0.5})`;
      ctx.fillRect(0, 0, viewportW, viewportH);
      // halo lighter blending for lamps/fire
      ctx.globalCompositeOperation = "lighter";
      const spots: Array<[number, number]> = [
        [104, 62], [120, 66], [110, 84], [72, 50],
      ];
      for (const [tx, ty] of spots) {
        const sx = (tx * V - cam.x) * cam.zoom + viewportW / 2;
        const sy = (ty * V - cam.y) * cam.zoom + viewportH / 2;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 44 * cam.zoom);
        grad.addColorStop(0, `rgba(255, 220, 120, ${0.38 * night})`);
        grad.addColorStop(1, "rgba(255, 220, 120, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, 44 * cam.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
