/**
 * Audit-log writes that carry metadata.
 *
 * The column is `jsonb`/`json` on PostgreSQL and MySQL but plain `text` on
 * SQLite, so an object binds on two dialects and fails on the third. The
 * writer swallows its own failures by design, so the loss was silent: events
 * without metadata were stored and events with it were dropped, leaving a log
 * that looks populated while missing exactly the entries that carry context.
 *
 * The dropped events are the security-relevant ones — `csrf-failed` and
 * `login-failed` both attach metadata, while `password-changed` does not.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuditLogWriter } from "../audit-log-writer";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface AuditRow {
  kind: string;
  metadata: string | Record<string, unknown> | null;
}

async function rows(handle: TestNextly): Promise<AuditRow[]> {
  return handle.adapter.select<AuditRow>("audit_log");
}

function writerFor(handle: TestNextly): ReturnType<typeof buildAuditLogWriter> {
  return buildAuditLogWriter((name: string) => handle.getService(name));
}

describe("audit log writes (integration)", () => {
  it("stores an event that carries metadata", async () => {
    current = await createTestNextly({});
    await writerFor(current).write({
      kind: "csrf-failed",
      metadata: { path: "/admin/api/auth/login", method: "POST" },
    });

    const stored = await rows(current);
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe("csrf-failed");

    const decoded =
      typeof stored[0].metadata === "string"
        ? (JSON.parse(stored[0].metadata) as Record<string, unknown>)
        : stored[0].metadata;
    expect(decoded).toMatchObject({
      path: "/admin/api/auth/login",
      method: "POST",
    });
  });

  it("still stores an event with no metadata", async () => {
    current = await createTestNextly({});
    await writerFor(current).write({ kind: "password-changed" });

    const stored = await rows(current);
    expect(stored).toHaveLength(1);
    expect(stored[0].metadata).toBeNull();
  });

  it("keeps both kinds in the same log rather than silently dropping one", async () => {
    // The shape of the bug: a partial log is worse than an empty one, because
    // it looks trustworthy while the interesting entries are missing.
    current = await createTestNextly({});
    const writer = writerFor(current);
    await writer.write({ kind: "password-changed" });
    await writer.write({
      kind: "login-failed",
      metadata: { code: "BAD_PASS" },
    });

    const stored = await rows(current);
    expect(stored.map(r => r.kind).sort()).toEqual([
      "login-failed",
      "password-changed",
    ]);
  });
});
