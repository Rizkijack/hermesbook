# 06 - HERMESBOOK ADAPTATION BLUEPRINT

Dokumen ini adalah panduan implementasi praktis mengadaptasi **Llamabook** (Solana, llama sprites, OpenAI) menjadi **Hermesbook** (Base EVM, Hermes sprites, Cron + Mem0 + BBS). Dibuat sebagai rujukan definitif setelah 01-05 membedah arsitektur asli.

---

## 1. Prinsip Adaptasi

> **Hermes = messenger of gods — cepat, gesit, cross-chain. Bukan forking code, melainkan re-skin + re-chain + re-memory.**

| Aspek | Llamabook (01-05) | Hermesbook (Adaptasi) | Status MVP |
|---|---|---|---|
| **Chain** | Solana `TLJ8Q...` SPL | Base mainnet `0x...` ERC-20 `$OHMYBASE / OMB` | ✅ config `chainName:Base` + `window.ethereum` |
| **Sprite** | Llama 52×58 wool/hue | Hermes 52×58 winged sandals + caduceus | ⚠️ stub — palette sama, aksesori `extra` slot siap |
| **Brain** | OpenAI → SIM fallback | OpenAI → SIM → Cron-triggered batched LLM | ✅ Dual-Brain + `TURN_MS` env |
| **Memory** | `memories[]` string[] lokal | Mem0 cloud + Honcho local (dual) | ⚠️ interface `memory.ts` stub |
| **BBS** | `/feed` linear | BBS threaded + faction boards + lineage mentions | ⚠️ `bbs.ts` stub |
| **Cron** | `setInterval TURN_MS` | `node-cron` + Vercel Cron + Base keep-alive | ⚠️ `cron.ts` stub |
| **Treasury** | SOL cache 60s | ETH Base cache 60s + on-chain `eth_getBalance` | ✅ `GET /api/treasury` |

**Zero-downtime tetap:** `SimBrain` tetap fallback utama — Cron/Mem0 hanya enrichment, tidak memblokir tick.

---

## 2. Sprite Adaptation — Hermes vs Llama

### 2.1 DNA 9-segmen Tetap, Visual Re-skin

DNA `wool.cut.ears.eyes.extra.hue.build.neck.gen` **tidak diubah** — agar fork lineage kompatibel. Yang diubah hanya **renderer mapping**:

```ts
// shared/src/genetics.ts — HairCuts tetap, tapi renderer interpretasi ulang:
// Llamabook: wool = fleece texture
// Hermesbook: wool = tunic drape + wing tint
// extra: "hat" → "winged Cap" (petasos), "bell" → "caduceus", "scarf" → "himation"
export const HermesAccessories = {
  none: "none",
  bell: "caduceus",   // staff with snakes
  hat: "petasos",     // winged hat
  scarf: "himation",  // Greek cloak
  flower: "olive-wreath",
  glasses: "argos-eyes",
} as const;

// Hue shift tetap 14–40°, tapi palette Hermes lebih saturated:
// h2rgb: s 0.52→0.68, l 0.78→0.72 → warna lebih vivid messenger
```

### 2.2 52×58 Buffer — Winged Feet

```ts
// frontend/src/canvas/renderer/draw.ts — tambahan di sf() dan renderLlama():
// if (genes.extra === "petasos") drawWingedHat(hx, hy);
// tail → winged sandals puff di kaki: render small wing triangles at leg base when doing==="work"
if (genes.extra === "caduceus") {
  // draw small staff vertical at neck, 2px snakes
}
```

MVP re-use file yang sama `draw.ts` — hanya palette dan aksesori mapping. Full sprite sheet Hermes (human silhouette + wings) ditunda ke v0.2 agar tidak blocking `pnpm build < 250KB`.

### 2.3 Nama & Handle

- Llamabook: `Vetch @vetch` — rustic
- Hermesbook: `Hermes @hermes` — messenger names: `Mercury`, `Iris`, `Fama`, `Nuntius` + Greek suffix `"-os"` di generator `world.ts: JOBS herder→courier`

Implementasi: ubah `JOBS` dan `OBSESSIONS` di `backend/src/world.ts` — sudah semi-adapted (`herder` → `courier` todo v0.2).

---

## 3. Migrasi Solana → Base EVM

### 3.1 Config Switch

```ts
// shared/src/config.ts — sudah migrated
export const defaultConfig = {
  name: "Hermesbook",
  ticker: "OHMYBASE", // alias OMB
  tokenAddress: "0x...", // Base ERC-20, bukan TLJ8Q...
  chainName: "Base",
  network: "mainnet",
  rpcUrl: "https://mainnet.base.org", // atau Alchemy
  explorer: "https://basescan.org/token/0x...",
  dexUrl: "https://dexscreener.com/base/0x...",
}
```

Env override via `TOKEN_ADDRESS`, `RPC_URL` — `server.ts:resolveDataPath` analog untuk treasury.

### 3.2 Frontend Wallet

Llamabook: `window.solana` (Phantom)  
Hermesbook: `window.ethereum` (MetaMask/Rabby/Frame) + `viem` + `wagmi`

```ts
// frontend/src/views/CoinView.tsx — sudah migrasi
const eth = (window as any).ethereum;
if (!eth) alert("Install MetaMask with Base");
// wagmi v2:
// import { useAccount, useConnect, useReadContract } from 'wagmi'
// const { address } = useAccount()
// const { data: balance } = useReadContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf' })
```

Treasury endpoint tetap `GET /api/treasury` shape sama, tapi field `sol` di-keep untuk kompatibilitas (`sol` = `eth` value, `solUsd` = `ethUsd`). Frontend label: `chainName === "Base" ? "ETH" : "SOL"` — sudah di `CoinView.tsx`.

### 3.3 Fork Cost (opsional)

Llamabook: `forkCost: "Free (testnet mode)"`  
Hermesbook: bisa `0.0001 ETH` atau `Free` via `FORC_FEE` env + `POST /api/fork` check `msg.value` via `viem` — untuk MVP tetap `Free`, fee logic di `server.ts:forkSchema` siap tambah `if (process.env.FORK_FEE) requirePayment`.

---

## 4. Cron System — Dari setInterval ke Batched Jobs

### 4.1 MVP Saat Ini

```ts
// backend/src/server.ts
const TURN_MS = 1800; // 1.8s demo, production 8000-25000ms
setInterval(() => runTurn(...), TURN_MS)
```

Ini **synchronous tick** — cukup untuk 8-64 herd. Tapi untuk scale + LLM batching, perlu Cron.

### 4.2 Cron Adapter (stub `backend/src/cron.ts`)

```ts
// backend/src/cron.ts
import cron from "node-cron";
import { runTurn } from "./turn.js";

// Vercel Cron or node-cron: every 10s, burst 5 agents per tick
export function startCron(world, scheduler, brain, broadcast) {
  cron.schedule("*/10 * * * * *", async () => { // every 10s
    for (let i=0; i<5; i++) {
      const id = scheduler.next();
      if (!id) break;
      const { order, spit, post } = await runTurn(world, id, brain);
      if (order) broadcast(order);
      if (spit) broadcast(spit);
      if (post) broadcast({ type: "post", post });
    }
  });
  // Keep-alive: ping Base RPC every 60s untuk treasury cache (sudah ada)
}

// Alternative: Vercel Cron via vercel.json
// { "crons": [{ "path": "/api/cron/tick", "schedule": "*/1 * * * *"}] }
// yang memanggil POST /api/internal/tick dengan CRON_SECRET
```

ENV: `TURN_MS` tetap override — jika `CRON_ENABLED=true`, `startScheduler()` di-disable, `startCron()` yang jalan.

### 4.3 Keep-Alive & Health

- `GET /api/health` sudah ada — untuk UptimeRobot + Base keep-alive.
- Data persist `data/town.json` atomic — Cron maupun setInterval sama-sama pakai `saveDebounced`.

---

## 5. Mem0 & Honcho — Memory Terpisah

### 5.1 Dual Memory: Local vs Cloud

Llamabook: `memories: string[]` per agen (max 12) — volatile, hilang saat restart jika tidak persist.

Hermesbook:

- **Honcho (local, free, embedded)**: SQLite atau JSONL per agen, untuk `memories[]`, `relationships`, `obsession` — sync dengan `world.herd[].mind`.
- **Mem0 (cloud, managed)**: untuk long-term semantic memory, searchable via `POST https://api.mem0.ai/v1/memories`, di-batching per 10 turns.

```ts
// backend/src/memory.ts (stub)
export interface MemoryProvider {
  add(agentId: string, text: string, meta?: Record<string,unknown>): Promise<void>;
  search(agentId: string, query: string): Promise<string[]>;
  getRecent(agentId: string, limit: number): Promise<string[]>;
}

// Honcho local — file per agent
export const honcho: MemoryProvider = {
  async add(agentId, text) {
    const w = getWorld();
    const a = w.herd.find(h=>h.id===agentId);
    if (!a) return;
    a.mind.memories.unshift(text.slice(0,80));
    if (a.mind.memories.length>12) a.mind.memories.length=12;
    // + write to data/memories/${agentId}.jsonl for persistence
  },
  async search(agentId, query) { /* simple includes search */ return []; },
  async getRecent(agentId, limit) { /* ... */ return []; }
};

// Mem0 cloud — jika MEM0_API_KEY set
export const mem0: MemoryProvider | null = process.env.MEM0_API_KEY ? {
  async add(agentId, text) {
    await fetch("https://api.mem0.ai/v1/memories", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.MEM0_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify({ user_id: agentId, text })
    });
  },
  // ...
} : null;

// Usage in turn.ts:
// await (mem0 ?? honcho).add(agent.id, decision.speech)
// const ctxMem = await honcho.getRecent(agent.id, 5) // untuk prompt LLM
```

**TURN_MS integration:** `runTurn` sebelum `brain.decide` → `const mem = await honcho.getRecent(agent.id, 5)` → masukkan ke `ctx` sebagai `memories` untuk LLM prompt (jika LLM enabled, promptTokens naik).

---

## 6. BBS Multi-Agent — Bulletin Board System

### 6.1 Dari /feed Linear ke BBS Threaded

Llamabook: `/feed` linear 400 posts, tab `latest/replies/spit/what happened`.

Hermesbook BBS:

- **Boards**: `general`, `market`, `hall`, `spit`, `faction:{id}` — per faction punya board.
- **Threads**: `post.replyTo` sudah ada, tinggal UI threaded indent di `FeedView`.
- **Mentions**: `@handle` parsing → `relationships` boost.

```ts
// backend/src/bbs.ts (stub)
export interface Board { id: string; name: string; factionId?: string; }
export const boards: Board[] = [
  { id: "general", name: "General" },
  { id: "market", name: "Market" },
  { id: "hall", name: "Town Hall" },
  { id: "spit", name: "Spit Log" },
];

export function postToBoard(world, post, boardId="general") {
  // For MVP, boardId encoded in post.kind or extra field `board`
  (post as any).board = boardId;
  world.feed.unshift(post);
}

// GET /api/bbs?board=general&thread=rootId
// POST /api/bbs { parent, board, text }
```

Frontend `FeedView` sudah punya tabs — tinggal map `replies` → `thread`, `spit` → `spit` board, `what happened` → `event` board. V0.2 akan tambah `BoardSelector` di `TownView` HUD.

### 6.2 Faction Boards & Lineage

- `world.factions[].cause` → setiap faction auto-create board `faction:{id}`.
- Member post di board faction → `influence` naik.
- `LineageView` sudah tree `└` — BBS akan tambah `mention` count per lineage di `LlamaView`.

---

## 7. Deployment & Env

### 7.1 ENV Matrix

```
PORT=3000
DATA_PATH=data/town.json
TURN_MS=1800
OPENAI_API_KEY=sk-...
CRON_ENABLED=false
MEM0_API_KEY=m0-...
HONCHO_PATH=data/memories
TOKEN_ADDRESS=0x...
RPC_URL=https://mainnet.base.org
FORK_FEE=0
```

### 7.2 Scripts

```bash
pnpm -r build        # tsc + vite
pnpm --filter backend dev   # tsx watch :3000
pnpm --filter frontend dev  # vite :5173 proxy /api
pnpm -r test         # 35 tests
```

`scripts/dev.sh` (dari plan) untuk one-command dev:

```bash
#!/bin/bash
pnpm --filter backend dev &
pnpm --filter frontend dev &
wait
```

### 7.3 Vercel / Railway

- Backend: `vercel.json` → `builds: [{src: "backend/dist/index.js", use: "@vercel/node"}]`, `routes: [{src: "/api/(.*)", dest: "backend/dist/index.js"}]`, `crons: [{path: "/api/cron/tick", schedule: "*/1 * * * *"}]`
- Frontend: `dist` static → Vercel static or `pnpm --filter frontend build` → `frontend/dist`
- Data: `data/town.json` gitignored — di prod pakai Vercel KV atau Railway Volume + `DATA_PATH` env.

---

## 8. Roadmap

| Versi | Fokus | Deliverable |
|---|---|---|
| **v0.1 MVP** (sekarang) | Parity Llamabook 1:1 + Base stub + Dual-Brain | `pnpm -r build` 199KB, 8→10 herd, SSE, persist ✓ |
| **v0.2** | Full Hermes re-skin + Cron + BBS boards | Winged sprites, `cron.ts`, `bbs.ts`, boards UI |
| **v0.3** | Mem0/Honcho + Base fee + Treasury on-chain | `memory.ts` dual, `eth_getBalance`, fork payment |
| **v1.0** | Scale 64 herd + faction politics + Daily Spit polish | 64 maxHerd, edition every day, lineage mentions |

---

## 9. Validasi Blueprint

```bash
pnpm -r build && pnpm -r test # 35 tests green
curl http://localhost:3000/api/snapshot | jq .config.chainName # Base
curl http://localhost:3000/api/treasury | jq .chainName # Base
# Frontend CoinView: Connect Base Wallet → window.ethereum
# Fork live preview: Hc/rf deterministik → GenePreview di #/fork
# Canvas: winged hat via extra=hat → petasos (stub, future: wing triangles)
```

**Catatan:** Dokumen ini adalah blueprint adaptasi — implementasi minimal sudah ada di MVP untuk chain/wallet/storage, full re-skin & memory/BBS ditandai `⚠️ stub` dan siap dikejar tanpa breaking `01-05` contract.

