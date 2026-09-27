import { useEffect, useRef } from "react";
import { Xf } from "./engine.js";

const DRAG_CLICK_SLOP = 5; // px of pointer travel still counted as a click

export function WorldCanvas({
  snapshot,
  onPick,
}: {
  snapshot: { herd: Array<{ id: string; name: string; handle: string; genes: string; mind: { doing: { place: string; act: string } }; born: number }>; };
  onPick?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xfRef = useRef<Xf | null>(null);
  // The world is built once on mount; later snapshots are patched in, so a
  // snapshot push can never rebuild (and re-centre) the camera.
  const initialRef = useRef(snapshot);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const xf = new Xf(initialRef.current);
    xfRef.current = xf;

    // attach to global for SSE handlers (simple)
    (window as unknown as Record<string, unknown>).__hermes_xf = xf;

    let raf = 0;
    let last = performance.now();

    // --- sizing (DPR-aware, also reacts to layout changes, not just window resize)
    function applySize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      xf.setViewport(rect.width, rect.height, dpr);
    }
    // The inline width:100% / height:560px pin the content box, so writing
    // canvas.width here cannot re-trigger this observer.
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(canvas);
    // a window moved to a display with a different devicePixelRatio does not
    // change the CSS box, so the observer alone would miss it
    window.addEventListener("resize", applySize);

    // --- camera interaction -------------------------------------------------
    // One pointer pipeline for mouse / touch / pen. Every gesture calls an Xf
    // camera method, and each of those drops follow mode, so the view always
    // ends up where the user put it.
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pinchDist = 0;
    let travel = 0; // pointer travel since press — separates a drag from a click

    const localXY = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const pickAgentAt = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      const sx = clientX - r.left;
      const sy = clientY - r.top;
      // find nearest agent by screen distance
      let best: string | null = null;
      let bestDist = 44;
      for (const a of xf.byId.values()) {
        const ax = (a.x - xf.cam.x) * xf.cam.zoom + r.width / 2;
        const ay = (a.y - xf.cam.y) * xf.cam.zoom + r.height / 2;
        const d = Math.hypot(ax - sx, ay - sy);
        if (d < bestDist) { bestDist = d; best = a.id; }
      }
      if (best) {
        xf.setFollow(best);
        onPickRef.current?.(best);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return; // right click = context menu, not a gesture
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        travel = 0;
      } else if (pointers.size === 2) {
        dragging = false;
        travel = Infinity; // a pinch is never a click
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, next);

      if (pointers.size === 1 && dragging) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        travel += Math.hypot(dx, dy);
        xf.panBy(dx, dy);
        canvas.style.cursor = "grabbing";
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) {
          const mid = localXY((a.x + b.x) / 2, (a.y + b.y) / 2);
          xf.zoomAt(mid.x, mid.y, d / pinchDist);
        }
        pinchDist = d;
        canvas.style.cursor = "grabbing";
      }
    };

    /** Shared end-of-gesture bookkeeping. `cancelled` never picks an agent. */
    const endPointer = (e: PointerEvent, cancelled: boolean) => {
      const liftsLast = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // always re-baseline: with a third finger the 2-finger span is stale, and
      // reusing it would fire one bogus zoom jump
      pinchDist = 0;
      if (pointers.size === 1) {
        // one finger is still down after a pinch: hand the pan over to it, and
        // make sure the tail of that pinch can never be read as a tap
        dragging = true;
        travel = Infinity;
      } else if (pointers.size === 0) {
        dragging = false;
        canvas.style.cursor = "grab";
        // only a genuine tap picks a resident — a drag pans and stops there
        if (!cancelled && liftsLast && travel <= DRAG_CLICK_SLOP) pickAgentAt(e.clientX, e.clientY);
        travel = 0;
      }
    };

    const onPointerUp = (e: PointerEvent) => endPointer(e, false);
    // the browser took the gesture away (palm rejection, OS gesture) — that is
    // not a tap, and acting on it would fly the camera to some resident
    const onPointerCancel = (e: PointerEvent) => endPointer(e, true);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = localXY(e.clientX, e.clientY);
      // deltaMode 1 = lines, 2 = pages; normalise to something usable
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
      xf.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
      // panBy takes a drag delta, so an arrow key is the negated view
      // direction: ArrowRight means "show more of the east".
      const step = e.shiftKey ? 220 : 70;
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": xf.panBy(step, 0); break;
        case "ArrowRight": case "d": case "D": xf.panBy(-step, 0); break;
        case "ArrowUp": case "w": case "W": xf.panBy(0, step); break;
        case "ArrowDown": case "s": case "S": xf.panBy(0, -step); break;
        case "+": case "=": { const c = xf.centerPoint(); xf.zoomAt(c.x, c.y, 1.15); break; }
        case "-": case "_": { const c = xf.centerPoint(); xf.zoomAt(c.x, c.y, 1 / 1.15); break; }
        case "0": xf.resetCam(); break;
        case "Escape": xf.setFollow(null); break;
        default: return;
      }
      e.preventDefault();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      xf.tick(dt);
      // keep the DPR transform here: draw() only offsets the camera on top of it
      ctx.setTransform(xf.dpr, 0, 0, xf.dpr, 0, 0);
      xf.draw(ctx, xf.viewW, xf.viewH);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", applySize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      (window as unknown as Record<string, unknown>).__hermes_xf = undefined;
    };
  }, []);

  // Keep xf in sync when the herd changes (new forks, residents leaving).
  // The engine is built once on mount, so this both adds and removes.
  useEffect(() => {
    const xf = xfRef.current;
    if (!xf) return;
    // drop residents the server no longer has, or they wander on as ghosts
    const live = new Set(snapshot.herd.map((h) => h.id));
    for (const id of [...xf.byId.keys()]) {
      if (!live.has(id)) xf.byId.delete(id);
    }
    for (const h of snapshot.herd) {
      if (!xf.byId.has(h.id)) {
        const { V } = { V: 16 };
        const loc = xf.byId.size ? { spot: [104, 62] } : { spot: [104, 62] };
        // reuse engine locationsData
        const spots: Record<string, [number, number]> = { square: [104, 62], barn: [44, 44], pens: [84, 90] };
        const spot = spots[h.mind.doing.place] ?? [104, 62];
        const hid2 = h.id.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
        xf.byId.set(h.id, {
          id: h.id, name: h.name, handle: h.handle, genes: h.genes,
          x: spot[0] * 16, y: spot[1] * 16, tx: spot[0] * 16, ty: spot[1] * 16,
          path: [], facing: 1, doing: h.mind.doing.act, place: h.mind.doing.place, mood: 0, born: h.born,
          vx: 0, vy: 0, baseSpeed: 0.88 + (hid2 % 100) / 250, wanderTimer: 1 + Math.random() * 2.5, walkPhase: Math.random(), idlePhase: Math.random() * Math.PI * 2, targetPlace: h.mind.doing.place,
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
        tabIndex={0}
        aria-label="Town map. Drag or use arrow keys to pan, scroll or pinch to zoom, click a resident to follow."
        style={{ width: "100%", height: "560px", display: "block", cursor: "grab" }}
      />
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => xfRef.current?.resetCam()}>Reset</button>
        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => xfRef.current?.setFollow(null)}>Free Cam</button>
      </div>
      <div className="mono" style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(244,241,234,0.92)", border: "1px solid #1b1915", padding: "4px 8px", fontSize: 11 }}>
        Drag to pan · scroll/pinch to zoom at cursor · click a resident to follow · arrows to pan · 0 to reset
      </div>
    </div>
  );
}
