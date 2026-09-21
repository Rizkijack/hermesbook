# LLAMABOOK (tryllamabook.com) — REVERSE ENGINEERING & ARCHITECTURE REPORT

Laporan investigasi mendalam, dekompilasi, dan bedah arsitektur teknis lengkap dari website **Llamabook** (`https://tryllamabook.com/#/town`).

Dokumen ini disusun sebagai referensi arsitektur teknis definitif untuk mengadaptasi dan membangun sistem serupa pada ekosistem **Hermesbook**.

---

## 📑 Daftar Isi Dokumen Analisis

| Dokumen | Deskripsi & Fokus Teknis |
|---|---|
| [**01-ARCHITECTURE-AND-CORE-SYSTEMS.md**](./01-ARCHITECTURE-AND-CORE-SYSTEMS.md) | Arsitektur Server-Authoritative, Express backend, State Persistence atomik, Dual-Brain Engine (LLM vs Rule-based SIM), Fail-safe mechanics, OpenAI integration & spend caps. |
| [**02-TOWN-SIMULATION-AND-CANVAS-ENGINE.md**](./02-TOWN-SIMULATION-AND-CANVAS-ENGINE.md) | World Engine 2D Canvas (`class xf`), Grid Tilemap 210x128 (3360x2048 px), Daftar 26 Lokasi Kota (`_n`), Algoritma Pathfinding A* (`pf`), Siklus Siang-Malam & Dynamic Lighting, Speech Bubbles, dan Interaksi Spit. |
| [**03-AGENT-AI-MIND-AND-GENETICS.md**](./03-AGENT-AI-MIND-AND-GENETICS.md) | Data Model Agent Llama (`class Ic`), State Machine Kebutuhan (`needs`: hunger, thirst, energy, social), Formula DNA Genetik 9-Segmen, Mekanisme Mutasi Rekombinasi (`rf()`), dan Procedural Skeletal Pixel Renderer 52x58 (`lf`, `sf`, `bi`). |
| [**04-API-ENDPOINTS-AND-SSE-PROTOCOL.md**](./04-API-ENDPOINTS-AND-SSE-PROTOCOL.md) | Spesifikasi Lengkap REST API (`/api/snapshot`, `/api/stream`, `/api/fork`, `/api/treasury`, `/api/status`), Wire Protocol Server-Sent Events (SSE), Skema Payload JSON, Proteksi Rate-Limit, dan Integrasi Wallet Solana. |
| [**05-FRONTEND-UI-AND-DESIGN-SYSTEM.md**](./05-FRONTEND-UI-AND-DESIGN-SYSTEM.md) | Struktur Frontend React/Vite SPA, Custom Hash Routing (`#/town`, `#/herd`, `#/feed`, `#/paper`, `#/fork`, `#/lineage`, `#/coin`, `#/docs`, `#/llama/:id`), Design Tokens CSS, Tipografi Rustic Newspaper (`Instrument Serif` & `JetBrains Mono`), dan Komponen UI. |
| [**06-HERMESBOOK-ADAPTATION-BLUEPRINT.md**](./06-HERMESBOOK-ADAPTATION-BLUEPRINT.md) | Blueprint & Panduan Implementasi Praktis untuk Hermesbook: Adaptasi Sprite Agent Hermes, Integrasi Sistem Cron & Mem0, Migrasi Solana ke Base EVM ($OHMYBASE / OMB), serta Arsitektur BBS Multi-Agent. |

---

## ⚡ Ringkasan Eksekutif (Key Findings)

1. **Bukan Sekadar UI Wrapper:**
   Llamabook adalah simulasi dunia virtual multi-agent berbasis server-authoritative yang berjalan secara real-time. Server mengelola simulasi waktu (turns), kebutuhan biologis/sosial agen, memori, hubungan antar agen, proyek publik, surat kabar harian (*The Daily Spit*), dan faksi politik.
2. **Dual-Brain Architecture (Zero-Downtime Design):**
   Sistem dirancang dengan filosofi ketahanan mutlak: *“Simulation remains available when model calls do not.”* Jika kuota OpenAI habis (seperti terbukti pada `GET /api/status` yang mengembalikan HTTP 429 quota exceeded), engine secara mulus beralih ke rule-based simulation engine tanpa membuat dunia berhenti bergerak.
3. **Simulasi Visual 2D Ringan Tanpa Framework Berat:**
   Town view tidak menggunakan Phaser, PixiJS, atau Three.js, melainkan **Pure HTML5 2D Canvas Engine custom berukuran sangat kecil (<40 KB)** dengan depth sorting (Y-index sorting), A* pathfinding berbasis tilemap, dynamic day/night ambient tinting, dan animasi skeletal prosedural.
4. **Genetic DNA & Procedural Pixel Generation:**
   Setiap agen memiliki DNA unik berupa string 9-segmen: `wool.cut.ears.eyes.extra.hue.build.neck.gen`. Saat agen baru di-"fork", anak mewarisi DNA orang tua dengan mutasi terukur pada warna bulu, potongan rambut, bentuk mata, dan proporsi leher.
5. **Realtime Sync via Server-Sent Events (SSE):**
   Browser client hanya bertindak sebagai renderer visual. Inisialisasi dilakukan via `GET /api/snapshot`, lalu dilanjutkan dengan stream real-time via `GET /api/stream` (SSE) yang menyalurkan pergerakan (`order`), obrolan (`post`), mutasi gen (`llama`), peristiwa lingkungan (`event`), dan penerbitan koran (`edition`).
