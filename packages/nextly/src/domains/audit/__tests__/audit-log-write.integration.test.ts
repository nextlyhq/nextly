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
import { getDialectTables } from "../../../database/index";
import { projectAuditMetadata } from "../audit-log-writer";
import { getNextlyLogger } from "../../../observability/logger";
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

describe("dialect resolution", () => {
  it("skips the write and says so, rather than guessing a dialect", async () => {
    // The writer swallows its own failures, so an empty table alone proves
    // nothing: a broken adapter lookup or a failed insert looks identical.
    // Assert the specific skip warning so this pins the intended branch.
    current = await createTestNextly({});
    const real = current.getService("adapter") as Record<string, unknown>;
    const withoutDialect = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "dialect") return undefined;
        if (prop === "getCapabilities") return () => ({});
        return Reflect.get(target, prop, receiver);
      },
    });

    const warnings: { kind?: string; reason?: string }[] = [];
    const logger = getNextlyLogger();
    const originalWarn = logger.warn.bind(logger);
    logger.warn = (payload: unknown) => {
      warnings.push(payload as { kind?: string; reason?: string });
      return originalWarn(payload as never);
    };

    try {
      await buildAuditLogWriter((name: string) =>
        name === "adapter" ? withoutDialect : current!.getService(name)
      ).write({ kind: "csrf-failed", metadata: { path: "/x" } });
    } finally {
      logger.warn = originalWarn;
    }

    expect(warnings.some(w => w.kind === "audit-log-write-skipped")).toBe(true);
    // And nothing was written under a guessed shape.
    expect(await rows(current)).toHaveLength(0);
  });

  it("picks tables from the adapter's dialect, not the cached environment", async () => {
    // The environment cache cannot be repointed mid-process, so proving the
    // adapter wins is done at the seam instead: hand the writer an adapter
    // that reports postgres and capture which table object it inserts into.
    // Reading env would yield the sqlite table, since that is what this
    // process validated first.
    current = await createTestNextly({});
    let usedTable: unknown;
    const fakeAdapter = {
      dialect: "postgresql",
      getDrizzle: () => ({
        insert: (table: unknown) => {
          usedTable = table;
          return { values: async () => undefined };
        },
      }),
    };

    await buildAuditLogWriter((name: string) =>
      name === "adapter" ? fakeAdapter : current!.getService(name)
    ).write({ kind: "csrf-failed", metadata: { path: "/x" } });

    expect(usedTable).toBe(getDialectTables("postgresql").auditLog);
    expect(usedTable).not.toBe(getDialectTables("sqlite").auditLog);
  });
});

/**
 * A NextlyError's `logContext` is written for operator triage and the auth
 * failures put an attempted email and a user id in it. A failure event is
 * recorded with NO actor, precisely so it cannot reveal which account was
 * reached — which also means nothing links the row to a person and the deletion
 * that erases their other rows can never find it. So the identifier must not be
 * stored at all rather than erased later.
 */
describe("projectAuditMetadata", () => {
  it("drops identifiers the error context carried", () => {
    const projected = projectAuditMetadata({
      email: "victim@example.com",
      userId: "u-123",
      reason: "password-mismatch",
    });

    expect(projected).toEqual({ reason: "password-mismatch" });
    expect(JSON.stringify(projected)).not.toContain("victim@example.com");
    expect(JSON.stringify(projected)).not.toContain("u-123");
  });

  it("drops a reason a plugin chose rather than one we produce", () => {
    // An AuthStrategy is application code and its failure result carries a
    // free-text reason, which the login handler copies into the error context.
    // Allowlisting the KEY would let that text through under an approved name —
    // onto a row with no actor, which no later deletion can find.
    expect(
      projectAuditMetadata({ reason: "no account for ada@example.com" })
    ).toEqual({});
    // What this package produces is still kept, so the diagnostic value the
    // allowlist exists for survives.
    expect(projectAuditMetadata({ reason: "password-mismatch" })).toEqual({
      reason: "password-mismatch",
    });
  });

  it("keeps nothing when the context is only identifiers", () => {
    // Default-deny: a key nobody listed is dropped, so a field added for
    // logging cannot silently become a new column of the audit trail.
    expect(projectAuditMetadata({ email: "a@b.c", ipHint: "1.2.3.4" })).toEqual(
      {}
    );
  });
});
