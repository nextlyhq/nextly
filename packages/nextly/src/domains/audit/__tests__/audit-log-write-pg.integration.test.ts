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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuditLogWriter } from "../audit-log-writer";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";

// The integration suite runs every file in one fork, so a process-wide
// override here outlives this file and leaks into whatever runs next. Capture
// and restore instead of assigning at module scope. Only env validation needs
// these; which tables the writer uses is decided by the adapter.
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeAll(() => {
  if (!PG_URL) return;
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = PG_URL;
});

afterAll(() => {
  process.env.DB_DIALECT = previousEnv.dialect;
  process.env.DATABASE_URL = previousEnv.url;
});

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

    // `audit_log` is a fixed system table with no per-test prefix, and the
    // harness disconnects on teardown without truncating, so a reused database
    // carries rows from earlier runs. Tag this row so the assertion can find
    // it among them.
    const marker = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await buildAuditLogWriter((name: string) =>
      current!.getService(name)
    ).write({
      kind: "csrf-failed",
      metadata: { path: "/x", method: "POST", marker },
    });

    const stored = await current.adapter.select<{
      metadata: { marker?: string } | null;
    }>("audit_log");
    const mine = stored.filter(r => r.metadata?.marker === marker);

    expect(mine).toHaveLength(1);
    // jsonb round-trips to an object. A string would mean it was encoded twice
    // and every consumer must double-parse — and would also make the filter
    // above find nothing, since `.marker` is undefined on a string.
    expect(typeof mine[0].metadata).toBe("object");
    expect(mine[0].metadata).toMatchObject({ path: "/x", method: "POST" });
  });
});
