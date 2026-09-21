import { useEffect, useRef } from "react";
import { Xf } from "./engine.js";

export function WorldCanvas({
  snapshot,
  onPick,
}: {
  snapshot: { herd: Array<{ id: string; name: string; handle: string; genes: string; mind: { doing: { place: string; act: string } }; born: number }>; };
  onPick?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xfRef = useRef<Xf | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const xf = new Xf(snapshot);
    xfRef.current = xf;

    // attach to global for SSE handlers (simple)
    (window as unknown as Record<string, unknown>).__hermes_xf = xf;

    let raf = 0;
    let last = performance.now();

    // handle resize for DPR
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // drag pan + zoom
    let dragging = false;
    let lastX = 0, lastY = 0;
    canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener("mouseup", () => dragging = false);
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      xf.cam.tx -= (e.clientX - lastX) / xf.cam.zoom;
      xf.cam.ty -= (e.clientY - lastY) / xf.cam.zoom;
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      xf.cam.tz = Math.max(0.45, Math.min(2.8, xf.cam.tz + delta));
    }, { passive: false });

    // click to follow
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // find nearest agent by screen distance
      let best: string | null = null;
      let bestDist = 44;
      for (const a of xf.byId.values()) {
        const ax = (a.x - xf.cam.x) * xf.cam.zoom + rect.width / 2;
        const ay = (a.y - xf.cam.y) * xf.cam.zoom + rect.height / 2;
        const d = Math.hypot(ax - sx, ay - sy);
        if (d < bestDist) { bestDist = d; best = a.id; }
      }
      if (best) {
        xf.setFollow(best);
        if (onPick) onPick(best);
      }
    });

    // touch
    let pinchDist = 0;
    canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
        const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
        pinchDist = Math.hypot(dx, dy);
      } else if (e.touches.length === 1) {
        dragging = true; lastX = e.touches[0]!.clientX; lastY = e.touches[0]!.clientY;
      }
    }, { passive: false });
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
        const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
        const d = Math.hypot(dx, dy);
        const delta = (d - pinchDist) * 0.004;
        xf.cam.tz = Math.max(0.45, Math.min(2.8, xf.cam.tz + delta));
        pinchDist = d;
        e.preventDefault();
      } else if (dragging && e.touches.length === 1) {
        const t = e.touches[0]!;
        xf.cam.tx -= (t.clientX - lastX) / xf.cam.zoom;
        xf.cam.ty -= (t.clientY - lastY) / xf.cam.zoom;
        lastX = t.clientX; lastY = t.clientY;
        e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener("touchend", () => { dragging = false; });

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      xf.tick(dt);
      const rect = canvas.getBoundingClientRect();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      xf.draw(ctx, rect.width, rect.height);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      (window as unknown as Record<string, unknown>).__hermes_xf = undefined;
    };
  }, [snapshot]);

  // Keep xf in sync when herd changes externally (new forks) — patch byId
  useEffect(() => {
    const xf = xfRef.current;
    if (!xf) return;
    for (const h of snapshot.herd) {
      if (!xf.byId.has(h.id)) {
        const { V } = { V: 16 };
        const loc = xf.byId.size ? { spot: [104, 62] } : { spot: [104, 62] };
        // reuse engine locationsData
        const spots: Record<string, [number, number]> = { square: [104, 62], barn: [44, 44], pens: [84, 90] };
        const spot = spots[h.mind.doing.place] ?? [104, 62];
        xf.byId.set(h.id, {
          id: h.id, name: h.name, handle: h.handle, genes: h.genes,
          x: spot[0] * 16, y: spot[1] * 16, tx: spot[0] * 16, ty: spot[1] * 16,
          path: [], facing: 1, doing: h.mind.doing.act, place: h.mind.doing.place, mood: 0, born: h.born,
        });
      } else {
        const a = xf.byId.get(h.id)!;
        a.genes = h.genes; a.name = h.name;
      }
    }
  }, [snapshot.herd]);

  // Expose method to handle SSE order
  useEffect(() => {
    const xf = xfRef.current;
    if (!xf) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; act: string; place: string; secs: number };
      xf.order(detail.id, detail.act, detail.place, detail.secs);
    };
    const spitHandler = (e: Event) => {
      const d = (e as CustomEvent).detail as { from: string; to: string };
      xf.spit(d.from, d.to);
    };
    const postHandler = (e: Event) => {
      const d = (e as CustomEvent).detail as { t: number; by: string; text: string };
      xf.post(d);
    };
    window.addEventListener("hermes:order", handler);
    window.addEventListener("hermes:spit", spitHandler);
    window.addEventListener("hermes:post", postHandler);
    return () => {
      window.removeEventListener("hermes:order", handler);
      window.removeEventListener("hermes:spit", spitHandler);
      window.removeEventListener("hermes:post", postHandler);
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="town"
        style={{ width: "100%", height: "560px", display: "block", cursor: "grab" }}
      />
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => { const xf = xfRef.current; if (xf) { xf.cam.tx = 1600; xf.cam.ty = 900; xf.cam.tz = 1; }}}>Reset</button>
        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => { const xf = xfRef.current; if (xf) xf.setFollow(null); }}>Free Cam</button>
      </div>
      <div className="mono" style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(244,241,234,0.92)", border: "1px solid #1b1915", padding: "4px 8px", fontSize: 11 }}>
        Drag pan · Scroll/pinch zoom · Click agent to follow
      </div>
    </div>
  );
}
