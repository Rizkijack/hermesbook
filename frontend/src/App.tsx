import { useEffect, useState } from "react";
import "./styles/global.css";
import { useHashRoute, Link } from "./router/hash.js";
import { useTown } from "./store/useTown.js";
import { TownView } from "./views/TownView.js";
import { HerdView } from "./views/HerdView.js";
import { FeedView } from "./views/FeedView.js";
import { PaperView } from "./views/PaperView.js";
import { ForkView } from "./views/ForkView.js";
import { LineageView } from "./views/LineageView.js";
import { CoinView } from "./views/CoinView.js";
import { DocsView } from "./views/DocsView.js";
import { LlamaView } from "./views/LlamaView.js";

export default function App() {
  const [route] = useHashRoute();
  const { state, connected } = useTown();
  const [isTurning, setIsTurning] = useState(false);
  const [followPick, setFollowPick] = useState<string | null>(null);

  // page turn animation
  useEffect(() => {
    setIsTurning(true);
    const id = setTimeout(() => setIsTurning(false), 320);
    return () => clearTimeout(id);
  }, [route.page, route.arg]);

  // Bridge SSE store -> canvas CustomEvents: intercept broadcast via polling state diff?
  // Simpler: attach global listener in useTown to dispatch CustomEvents
  // We enhance useTown externally by wrapping fetch: here we watch state.feed/order changes
  // For MVP we rely on WorldCanvas reading snapshot herd but orders need path update
  // So we add a lightweight SSE listener here duplication that dispatches events
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "order") window.dispatchEvent(new CustomEvent("hermes:order", { detail: msg }));
        else if (msg.type === "post") window.dispatchEvent(new CustomEvent("hermes:post", { detail: msg.post }));
        else if (msg.type === "spit") window.dispatchEvent(new CustomEvent("hermes:spit", { detail: msg }));
        else if (msg.type === "llama" || msg.type === "herd") {
          // herd update will be handled by state refetch; for now trigger reload
          // state will catch via useTown pending queue; nothing extra needed
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  if (!state) {
    return (
      <div className="page" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontFamily: "Instrument Serif", fontSize: 28 }}>Hermesbook</div>
        <div className="mono muted" style={{ marginTop: 8 }}>Loading snapshot from /api/snapshot…</div>
        <div className="mono faint" style={{ marginTop: 8, fontSize: 11 }}>If this hangs, start backend: <code>pnpm --filter backend dev</code> on :3000</div>
      </div>
    );
  }

  const { page, arg } = route;

  return (
    <>
      <header className="masthead">
        <h1 style={{ fontFamily: "Instrument Serif" }}>Hermesbook</h1>
        <span className="mono" style={{ fontSize: 10, background: connected ? "#efe" : "#fee", border: "1px solid #d8d2c6", padding: "2px 6px", borderRadius: 10 }}>{connected ? "● live" : "○ offline"}</span>
        <nav style={{ marginLeft: 12 }}>
          <Link to="town" className={page === "town" ? "active" : ""}>Town</Link>
          <Link to="herd" className={page === "herd" ? "active" : ""}>Herd</Link>
          <Link to="feed" className={page === "feed" ? "active" : ""}>Feed</Link>
          <Link to="paper" className={page === "paper" ? "active" : ""}>Paper</Link>
          <Link to="fork" className={page === "fork" ? "active" : ""}>Fork</Link>
          <Link to="lineage" className={page === "lineage" ? "active" : ""}>Lineage</Link>
          <Link to="coin" className={page === "coin" ? "active" : ""}>Coin</Link>
          <Link to="docs" className={page === "docs" ? "active" : ""}>Docs</Link>
        </nav>
        <div className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "#6e675d" }}>{state.herd.length}/{state.config.maxHerd} · {state.feed.length} posts · {state.config.ticker}</div>
      </header>

      <main className={"page" + (isTurning ? " turning" : "")}>
        {page === "town" && <TownView snapshot={state} onPick={(id) => setFollowPick(id)} />}
        {page === "herd" && <HerdView snapshot={state} />}
        {page === "feed" && <FeedView snapshot={state} />}
        {page === "paper" && <PaperView snapshot={state} />}
        {page === "fork" && <ForkView snapshot={state} preset={arg} onForked={() => { /* state will refresh via SSE herd */ }} />}
        {page === "lineage" && <LineageView snapshot={state} />}
        {page === "coin" && <CoinView snapshot={state} />}
        {page === "docs" && <DocsView snapshot={state} />}
        {page === "llama" && arg && <LlamaView snapshot={state} id={arg} />}
        {page === "llama" && !arg && <div className="card">No llama id. <Link to="herd">Go to herd</Link></div>}
        {!["town", "herd", "feed", "paper", "fork", "lineage", "coin", "docs", "llama"].includes(page) && (
          <div className="card">Unknown page "{page}". <Link to="town">Go to town</Link></div>
        )}
      </main>

      <footer className="mono" style={{ textAlign: "center", padding: "18px 24px", fontSize: 11, color: "#a49c90", borderTop: "1px solid #d8d2c6", marginTop: 24 }}>
        Hermesbook · Base · 210×128 tiles · Dual-Brain Sim fallback · Built from Llamabook reverse engineering
        {followPick && <span style={{ marginLeft: 12 }}>Following <strong>{state.herd.find((h) => h.id === followPick)?.name ?? followPick.slice(0, 8)}</strong> · <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => setFollowPick(null)}>clear</button></span>}
      </footer>
    </>
  );
}
