/**
 * Audit-log metadata on a JSON column.
 *
 * Separate file from the SQLite legs on purpose: env.ts validates and CACHES
 * DB_DIALECT on first read, so a process that has already resolved SQLite
 * tables keeps them, and the writer would insert SQLite-shaped rows into a
 * PostgreSQL database.
 *
 * Covers the opposite error from the SQLite case: handing a jsonb column a
 * pre-encoded string stores a JSON string rather than an object, so every
 * consumer would have to parse twice.
 */
import { describe, expect, it, afterEach } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuditLogWriter } from "../audit-log-writer";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
// Set before the first env read so the cached dialect matches the database.
if (PG_URL) {
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = PG_URL;
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

// Dialect gate: skipped when the dialect's URL is unset.
const describePg = describe.skipIf(!PG_URL);

describePg("audit log writes (postgres jsonb)", () => {
  it("stores metadata as an object, not a JSON string", async () => {
    const adapter = await createAdapter({
      type: "postgresql",
      url: PG_URL,
    } as Parameters<typeof createAdapter>[0]);
    current = await createTestNextly({ adapter });

    await buildAuditLogWriter((name: string) =>
      current!.getService(name)
    ).write({ kind: "csrf-failed", metadata: { path: "/x", method: "POST" } });

    const stored = await current.adapter.select<{
      metadata: unknown;
    }>("audit_log");
    expect(stored).toHaveLength(1);
    // jsonb round-trips to an object. A string would mean it was encoded
    // twice and every consumer must double-parse.
    expect(typeof stored[0].metadata).toBe("object");
    expect(stored[0].metadata).toMatchObject({ path: "/x", method: "POST" });
  });
});
