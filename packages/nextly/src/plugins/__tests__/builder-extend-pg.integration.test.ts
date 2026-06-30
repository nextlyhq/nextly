/**
 * Postgres dialect gate for plugin-access materialization.
 *
 * Dialect bugs (varchar sizing, RETURNING, type mapping) hide on SQLite, so the
 * boot-safe column apply that materializes a plugin field onto a UI-Builder
 * table must be exercised on real Postgres too. Follows the repo convention:
 * connect via `TEST_POSTGRES_URL` (default `…:5433/nextly_test`) and SKIP when
 * Postgres isn't reachable — CI provides the URL so the assertions run there.
 *
 * The materializer here (`addMissingColumnsForFields`) is the same util dev-push
 * already runs against Postgres in production; this pins it for the plugin path.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../collections/fields/types";
import { createAdapter } from "../../database/factory";
import { addMissingColumnsForFields } from "../../domains/schema/utils/missing-columns";
import type { Logger } from "../../services/shared";

const PG_URL =
  process.env.TEST_POSTGRES_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/nextly_test";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const TABLE = "dc_pg_builder_extend";

// Probe Postgres at load time so we can statically skip when it's unavailable.
async function connectIfAvailable(): Promise<Awaited<
  ReturnType<typeof createAdapter>
> | null> {
  process.env.DB_DIALECT = "postgresql";
  try {
    const adapter = await createAdapter({
      type: "postgresql",
      url: PG_URL,
    } as Parameters<typeof createAdapter>[0]);
    await adapter.executeQuery("SELECT 1");
    return adapter;
  } catch {
    return null;
  }
}

const adapter = await connectIfAvailable();
const describePg = adapter ? describe : describe.skip;

afterAll(async () => {
  if (adapter) {
    try {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch {
      // best-effort cleanup
    }
    await adapter.disconnect();
  }
});

describePg("boot-safe column apply on Postgres (P8 dialect gate)", () => {
  it("adds a plugin field column to a dynamic table on Postgres", async () => {
    // Non-null asserted: this describe is skipped when adapter is null.
    const a = adapter!;
    await a.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await a.executeQuery(
      `CREATE TABLE ${TABLE} (id text primary key, body text, created_at timestamptz, updated_at timestamptz)`
    );

    const added = await addMissingColumnsForFields(
      a,
      silentLogger,
      TABLE,
      [
        { name: "body", type: "text" },
        { name: "meta_title", type: "text" },
      ] as unknown as FieldConfig[],
      { timestamps: true }
    );
    expect(added).toContain("meta_title");

    const cols = await a.executeQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${TABLE}'`
    );
    expect(cols.map(c => c.column_name)).toContain("meta_title");
  });
});
