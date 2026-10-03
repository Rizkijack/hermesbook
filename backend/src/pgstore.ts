// Postgres backing for the town snapshot (Vercel: /tmp is ephemeral).
// The `sql` tag is injected so tests use a stub, never a real database.
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
export const TOWN_ROW_ID = "town";

export async function ensureSchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS town_state (
      id TEXT PRIMARY KEY,
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
}

export async function pgSave(sql: Sql, snapshot: unknown): Promise<void> {
  await sql`
    INSERT INTO town_state (id, snapshot, updated_at)
    VALUES (${TOWN_ROW_ID}, ${JSON.stringify(snapshot)}, now())
    ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()`;
}

export async function pgLoad(sql: Sql): Promise<unknown | null> {
  const rows = await sql`SELECT snapshot FROM town_state WHERE id = ${TOWN_ROW_ID}`;
  if (rows.length === 0) return null;
  const snap = (rows[0] as { snapshot: unknown }).snapshot;
  return typeof snap === "string" ? JSON.parse(snap) : snap;
}
