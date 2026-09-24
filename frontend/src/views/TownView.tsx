import type { TownSnapshot } from "@hermesbook/shared";
import { WorldCanvas } from "../canvas/WorldCanvas.js";

export function TownView({ snapshot, onPick }: { snapshot: TownSnapshot; onPick?: (id: string) => void }) {
  // top spots: most agents per place
  const counts = new Map<string, number>();
  for (const h of snapshot.herd) counts.set(h.mind.doing.place, (counts.get(h.mind.doing.place) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <div className="stagger">
      <WorldCanvas snapshot={snapshot} onPick={onPick} />
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="mono" style={{ fontSize: 11, letterSpacing: 0.06 + "em", color: "var(--muted)" }}>HERD · {snapshot.herd.length}/{snapshot.config.maxHerd}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{snapshot.herd.length} residents in the field</div>
          <div className="mono muted" style={{ fontSize: 12, marginTop: 6 }}>Day {(Math.floor((Date.now() / 1000 / 900) % 365)) + 1} · {new Date().toLocaleTimeString()}</div>
        </div>
        <div className="card">
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>TOP SPOTS</div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {top.map(([place, n]) => (
              <div key={place} style={{ display: "flex", justifyContent: "space-between", fontFamily: "JetBrains Mono", fontSize: 12 }}>
                <span>{place}</span><span>{n}</span>
              </div>
            ))}
            {top.length === 0 && <span className="muted mono" style={{ fontSize: 12 }}>no activity</span>}
          </div>
        </div>
        <div className="card">
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>RECENT OCCURRENCES</div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {snapshot.events.slice(-4).map((e, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>{e.text}</div>
            ))}
            {snapshot.feed.slice(0, 2).map((p) => (
              <div key={p.id} style={{ fontSize: 12, borderLeft: "2px solid var(--hair)", paddingLeft: 8 }}>{p.text} <span className="mono muted" style={{ fontSize: 10 }}>— {p.name}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
