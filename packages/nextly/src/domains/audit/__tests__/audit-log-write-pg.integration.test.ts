/**
 * Audit-log metadata on a JSON column.
 *
 * Covers the opposite error from the SQLite case: handing a jsonb column a
 * pre-encoded string stores a JSON string rather than an object, so every
 * consumer would have to parse twice.
 *
 * Order-independence comes from the writer resolving its tables from the
 * adapter it writes through, NOT from this file's position in the run. The
 * integration suite uses a single fork and env.ts caches DB_DIALECT on first
 * read, so whichever dialect file ran first would otherwise decide the table
 * shape for every file after it.
 *
 * Assertions filter to the row this test wrote: `audit_log` is a fixed system
 * table, so a shared database or a repeated local run leaves earlier rows
 * behind and a bare row count would fail for reasons unrelated to encoding.
 */
import { describe, expect, it, afterEach } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuditLogWriter } from "../audit-log-writer";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
// Set at module scope because env.ts validates on first read, which happens
// during the import chain below. This only satisfies validation; which tables
// the writer uses is decided by the adapter, not by this.
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
