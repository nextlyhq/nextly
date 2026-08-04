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
import {
  auditFailureMetadata,
  projectAuditMetadata,
} from "../audit-log-writer";
import { AUDIT_REASONS } from "../audit-reasons";
import { NextlyError } from "../../../errors/nextly-error";
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

  it("drops a strategy's own text while keeping that it failed", () => {
    // A strategy failing is a fact this package states; the words the strategy
    // chose are its own, and travel under a key the trail does not retain.
    expect(
      projectAuditMetadata({
        reason: "strategy-fail",
        strategyReason: "no SAML assertion for ada@example.com",
      })
    ).toEqual({ reason: "strategy-fail" });
  });

  it("keeps nothing when the context is only identifiers", () => {
    // Default-deny: a key nobody listed is dropped, so a field added for
    // logging cannot silently become a new column of the audit trail.
    expect(projectAuditMetadata({ email: "a@b.c", ipHint: "1.2.3.4" })).toEqual(
      {}
    );
  });

  it("drops a diagnostic code outside the canonical table", () => {
    // `originalCode` and `legacyCode` are copied from an error's own `code`,
    // and that code is `NextlyErrorCodeLike` — any string. An application hook
    // can therefore name a person in it, and the row it lands on has no actor.
    expect(projectAuditMetadata({ originalCode: "ada@example.com" })).toEqual(
      {}
    );
    expect(projectAuditMetadata({ legacyCode: "acct-8891-ada" })).toEqual({});
  });

  it("keeps a diagnostic code the canonical table defines", () => {
    expect(
      projectAuditMetadata({
        originalCode: "TOKEN_EXPIRED",
        legacyCode: "NOT_FOUND",
      })
    ).toEqual({ originalCode: "TOKEN_EXPIRED", legacyCode: "NOT_FOUND" });
  });

  it("keeps every reason the audited handlers can reach", () => {
    // Stated here independently of the vocabulary the projection consults: a
    // list checked against itself stays true when an entry is deleted from
    // both. Each of these is emitted on a path whose failure is recorded, so
    // dropping one leaves the operator the same INVALID_CREDENTIALS for
    // materially different failures.
    const reachable = [
      // auth/credentials/verify-credentials.ts
      "user-not-found",
      "password-mismatch",
      "unverified",
      "inactive",
      "locked",
      // domains/auth/services/auth-service.ts
      "no-password-hash",
      "current-password-mismatch",
      // auth/handlers/login.ts
      "strategy-fail",
      "no-strategy-matched",
      // auth/handlers/challenge-resolve.ts
      "pending-token-invalid",
      "challenge-attempts-exhausted",
      "challenge-failed-final",
      "challenge-user-missing",
      // auth/handlers/set-initial-password.ts
      "pending-token-wrong-challenge",
      "not-in-must-change-state",
      "user-missing",
    ];

    for (const reason of reachable) {
      expect(projectAuditMetadata({ reason })).toEqual({ reason });
    }
    // Nothing is admitted to the trail that no audited handler emits.
    expect([...AUDIT_REASONS].sort()).toEqual([...reachable].sort());
  });
});

/**
 * Everything a failure row stores is decided here, so the three handlers that
 * record one cannot drift apart — and so no value reaches the row without
 * having been checked against a vocabulary this package controls.
 */
describe("auditFailureMetadata", () => {
  it("replaces an error code the canonical table does not define", () => {
    // A plugin builds its own NextlyError, and `code` accepts any string.
    // Storing it verbatim would put whatever it says on an unattributed row.
    expect(
      auditFailureMetadata(
        new NextlyError({
          code: "ada@example.com",
          publicMessage: "Invalid email or password.",
        })
      )
    ).toEqual({ code: "INTERNAL_ERROR" });
  });

  it("keeps a canonical error code and its projected context", () => {
    expect(
      auditFailureMetadata(
        NextlyError.invalidCredentials({
          logContext: { reason: "password-mismatch", userId: "u-1" },
        })
      )
    ).toEqual({
      code: "AUTH_INVALID_CREDENTIALS",
      reason: "password-mismatch",
    });
  });

  it("replaces a code that only the prototype chain would supply", () => {
    // `in` accepts these; they are not entries in the canonical table, and the
    // value is chosen by whoever threw the error.
    for (const code of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(
        auditFailureMetadata(
          new NextlyError({ code, publicMessage: "Invalid email or password." })
        )
      ).toEqual({ code: "INTERNAL_ERROR" });
    }
    expect(projectAuditMetadata({ originalCode: "constructor" })).toEqual({});
  });

  it("reports the withheld detail wherever it is called from", () => {
    // Every handler that records a failure gets the operator report by calling
    // this, rather than by remembering to log alongside it. That was the defect
    // the first time: one of the three handlers logged and the other two
    // discarded the only actionable detail their failures carried.
    const logged: Record<string, unknown>[] = [];
    const logger = getNextlyLogger();
    const originalWarn = logger.warn.bind(logger);
    logger.warn = (payload: unknown) => {
      logged.push(payload as Record<string, unknown>);
      return undefined as never;
    };

    try {
      const metadata = auditFailureMetadata(
        NextlyError.invalidCredentials({
          logContext: {
            reason: "strategy-fail",
            strategyReason: "no SAML assertion for ada@example.com",
            email: "ada@example.com",
          },
        }),
        "req-42"
      );
      // Withheld from the row...
      expect(metadata).toEqual({
        code: "AUTH_INVALID_CREDENTIALS",
        reason: "strategy-fail",
      });
    } finally {
      logger.warn = originalWarn;
    }

    // ...and reported to the operator, which is the other half of the contract.
    const entry = logged.find(e => e.kind === "auth-failed");
    expect(entry?.requestId).toBe("req-42");
    expect(entry?.context).toMatchObject({
      strategyReason: "no SAML assertion for ada@example.com",
    });
  });

  it("keeps its own classification when a hook supplies those keys", () => {
    // `logContext` is written by application code. Spread, it could overwrite
    // the fields this adds — making a failure unsearchable as an auth failure,
    // or attributing it to a request that never happened.
    const logged: Record<string, unknown>[] = [];
    const logger = getNextlyLogger();
    const originalWarn = logger.warn.bind(logger);
    logger.warn = (payload: unknown) => {
      logged.push(payload as Record<string, unknown>);
      return undefined as never;
    };

    try {
      auditFailureMetadata(
        NextlyError.invalidCredentials({
          logContext: {
            kind: "not-auth",
            requestId: "forged",
            code: "FORGED",
          },
        }),
        "req-real"
      );
    } finally {
      logger.warn = originalWarn;
    }

    expect(logged).toHaveLength(1);
    expect(logged[0].kind).toBe("auth-failed");
    expect(logged[0].requestId).toBe("req-real");
    expect(logged[0].code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("still returns metadata when the context cannot be serialised", () => {
    // This runs inside the auth handlers' catch blocks, and the default logger
    // serialises with JSON.stringify. A second exception there would escape the
    // handler, so the caller would get neither the typed response nor the row.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const logger = getNextlyLogger();
    const originalWarn = logger.warn.bind(logger);
    logger.warn = (payload: unknown) => {
      JSON.stringify(payload);
      return undefined as never;
    };

    try {
      expect(
        auditFailureMetadata(
          NextlyError.invalidCredentials({
            logContext: { reason: "password-mismatch", cyclic, big: 1n },
          })
        )
      ).toEqual({
        code: "AUTH_INVALID_CREDENTIALS",
        reason: "password-mismatch",
      });
    } finally {
      logger.warn = originalWarn;
    }
  });

  it("reports a non-NextlyError as an internal failure", () => {
    expect(auditFailureMetadata(new TypeError("boom"))).toEqual({
      code: "INTERNAL_ERROR",
    });
  });
});
