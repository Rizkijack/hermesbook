import { describe, it, expect, vi } from "vitest";
import { ensureSchema, pgLoad, pgSave } from "../src/pgstore.js";

function stubDb(rows: unknown[] = []) {
  const seen: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    seen.push(strings.join("?"));
    return rows;
  }) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  return { sql, seen };
}

describe("pgstore", () => {
  it("ensureSchema creates town_state", async () => {
    const { sql, seen } = stubDb();
    await ensureSchema(sql as never);
    expect(seen.join(" ")).toMatch(/CREATE TABLE IF NOT EXISTS town_state/);
  });
  it("pgSave upserts row 'town'", async () => {
    const { sql, seen } = stubDb();
    await pgSave(sql as never, { herd: [] });
    expect(seen.join(" ")).toMatch(/INSERT INTO town_state/);
  });
  it("pgLoad returns snapshot, null when empty", async () => {
    const full = stubDb([{ snapshot: { herd: [] } }]);
    expect(await pgLoad(full.sql as never)).toEqual({ herd: [] });
    const empty = stubDb([]);
    expect(await pgLoad(empty.sql as never)).toBeNull();
  });
});
