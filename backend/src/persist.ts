import { writeFile, rename, copyFile, mkdir } from "fs/promises";
import { open } from "fs/promises";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { neon } from "@neondatabase/serverless";
import { pgLoad, pgSave } from "./pgstore.js";

function pgSql(): Parameters<typeof pgSave>[0] {
  // Lazy + per-call: serverless instances must not hold idle connections.
  // @neondatabase/serverless is fetch-based, so this is cheap.
  return neon(process.env.DATABASE_URL!) as unknown as Parameters<typeof pgSave>[0];
}

export async function saveAtomically(path: string, data: unknown): Promise<void> {
  if (process.env.DATABASE_URL) {
    await pgSave(pgSql(), data);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = path.replace(/\.json$/, `.tmp.${process.pid}`);
  const backup = path.replace(/\.json$/, ".backup.json");
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    const fh = await open(tmp, "r");
    try { await fh.sync(); } catch {}
    await fh.close();
  } catch {}
  try {
    await copyFile(path, backup);
  } catch {
    // first write, no backup yet
  }
  await rename(tmp, path);
}

export async function loadWithRecovery(path: string): Promise<unknown> {
  if (process.env.DATABASE_URL) {
    const snap = await pgLoad(pgSql());
    if (snap) return snap;
    throw new Error(`no data at ${path} or backup`);
  }
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    const backup = path.replace(/\.json$/, ".backup.json");
    if (existsSync(backup)) {
      const raw = await readFile(backup, "utf8");
      return JSON.parse(raw);
    }
    throw new Error(`no data at ${path} or backup`);
  }
}

// Debounced batching for routine ticks, immediate flush for forks
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingData: unknown = null;
let pendingPath: string | null = null;

export function saveDebounced(path: string, data: unknown, delayMs = 800): void {
  pendingData = data;
  pendingPath = path;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (pendingPath && pendingData) {
      await saveAtomically(pendingPath, pendingData);
    }
    debounceTimer = null;
  }, delayMs);
}

export function flushDebounced(): Promise<void> | null {
  if (debounceTimer && pendingPath && pendingData) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    return saveAtomically(pendingPath, pendingData);
  }
  return null;
}
