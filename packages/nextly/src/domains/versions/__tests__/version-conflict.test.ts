/**
 * Unit tests for version_no conflict detection and the retry wrapper.
 *
 * Concurrency itself can only be exercised on Postgres/MySQL (SQLite serializes
 * transactions), so these tests pin the pure logic: capture raises a distinct
 * VersionConflictError on a unique violation, the retry re-runs only on that
 * error, and the cause-chain walk finds a wrapped conflict.
 */
import { describe, expect, it, vi } from "vitest";

import { DbError } from "../../../database/errors";
import { NextlyError } from "../../../errors/nextly-error";
import type { VersionsDbApi } from "../db-api";
import { VersionCaptureService } from "../version-capture-service";
import {
  VersionConflictError,
  hasVersionConflict,
  isUniqueViolation,
  withVersionConflictRetry,
} from "../version-conflict";

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function uniqueViolation(): DbError {
  return new DbError({
    message: "duplicate key",
    kind: "unique-violation",
    dialect: "postgresql",
  });
}

describe("withVersionConflictRetry", () => {
  it("returns the result without retrying on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withVersionConflictRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a version conflict and succeeds on a later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new VersionConflictError())
      .mockResolvedValue("ok");
    await expect(withVersionConflictRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget and throws the last conflict", async () => {
    const fn = vi.fn().mockRejectedValue(new VersionConflictError());
    await expect(
      withVersionConflictRetry(fn, { attempts: 3 })
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-conflict error immediately without retrying", async () => {
    const boom = new Error("boom");
    const fn = vi.fn().mockRejectedValue(boom);
    await expect(withVersionConflictRetry(fn)).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("hasVersionConflict", () => {
  it("detects a direct conflict", () => {
    expect(hasVersionConflict(new VersionConflictError())).toBe(true);
  });

  it("detects a conflict nested in the cause chain", () => {
    const wrapped = new Error("tx rolled back");
    (wrapped as { cause?: unknown }).cause = new VersionConflictError();
    expect(hasVersionConflict(wrapped)).toBe(true);
  });

  it("is false for an unrelated error", () => {
    expect(hasVersionConflict(new Error("nope"))).toBe(false);
  });
});

describe("VersionCaptureService.capture — conflict mapping", () => {
  it("raises VersionConflictError on a unique violation", async () => {
    const db: VersionsDbApi = {
      select: async () => [],
      insert: async () => {
        throw uniqueViolation();
      },
    };
    const service = new VersionCaptureService();
    await expect(
      service.capture(db, { ref, status: "published", snapshot: {} })
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("raises VersionConflictError when the violation is wrapped in cause", async () => {
    const wrapped = new Error("insert failed");
    (wrapped as { cause?: unknown }).cause = uniqueViolation();
    const db: VersionsDbApi = {
      select: async () => [],
      insert: async () => {
        throw wrapped;
      },
    };
    const service = new VersionCaptureService();
    await expect(
      service.capture(db, { ref, status: "published", snapshot: {} })
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("propagates a non-unique database error unchanged", async () => {
    const other = new DbError({
      message: "connection lost",
      kind: "connection-lost",
      dialect: "postgresql",
    });
    const db: VersionsDbApi = {
      select: async () => [],
      insert: async () => {
        throw other;
      },
    };
    const service = new VersionCaptureService();
    await expect(
      service.capture(db, { ref, status: "published", snapshot: {} })
    ).rejects.toBe(other);
  });

  // The transaction-context insert throws the RAW driver error (it is not
  // normalized to a DbError until it escapes the transaction), so capture must
  // recognize the raw per-dialect unique codes and the adapter's own
  // DatabaseError. Without this the retry is dead on Postgres/MySQL.
  it.each([
    ["raw pg 23505", { code: "23505", message: "duplicate key" }],
    [
      "raw sqlite constraint",
      { code: "SQLITE_CONSTRAINT_UNIQUE", message: "UNIQUE constraint failed" },
    ],
    ["raw mysql errno", { errno: 1062, code: "ER_DUP_ENTRY" }],
    [
      "adapter DatabaseError",
      { name: "DatabaseError", kind: "unique_violation" },
    ],
  ])(
    "raises VersionConflictError on a %s from the tx-context insert",
    async (_label, rawError) => {
      const db: VersionsDbApi = {
        select: async () => [],
        insert: async () => {
          throw rawError;
        },
      };
      const service = new VersionCaptureService();
      await expect(
        service.capture(db, { ref, status: "published", snapshot: {} })
      ).rejects.toBeInstanceOf(VersionConflictError);
    }
  );
});

describe("VersionConflictError — NextlyError contract", () => {
  it("is a NextlyError with a CONFLICT (409) code", () => {
    const err = new VersionConflictError();
    expect(NextlyError.is(err)).toBe(true);
    expect(err.code).toBe("CONFLICT");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("VersionConflictError");
  });

  it("survives the adapter wrapping so the retry still detects it", () => {
    // The dialect adapters re-wrap a callback error in a DatabaseError with the
    // original as `cause`; the retry walks that chain by name.
    const wrapped = new Error("transaction aborted");
    (wrapped as { cause?: unknown }).cause = new VersionConflictError();
    expect(hasVersionConflict(wrapped)).toBe(true);
  });
});

/**
 * `isUniqueViolation` had no coverage at all, which is how a one-level `cause`
 * walk survived: its only caller catches at the tx-insert site, where the
 * driver error is still near the surface. Anywhere else — the job queue was the
 * first — the driver error sits deeper and the answer came back `false` for a
 * real duplicate key.
 */
describe("isUniqueViolation across the wrapping the adapter actually does", () => {
  const driverError = () =>
    Object.assign(
      new Error("UNIQUE constraint failed: nextly_jobs.dedupe_key"),
      {
        code: "SQLITE_CONSTRAINT_UNIQUE",
      }
    );

  it("finds a raw driver error", () => {
    expect(isUniqueViolation(driverError())).toBe(true);
  });

  it("finds one wrapped a single level down", () => {
    expect(
      isUniqueViolation(new Error("wrapper", { cause: driverError() }))
    ).toBe(true);
  });

  it("finds one wrapped TWO levels down, which is what a real query error is", () => {
    // Measured shape, not invented: an adapter DatabaseError wraps a
    // DrizzleQueryError, which wraps the driver's error. Two levels is the
    // ordinary case for any query, not an edge case.
    const wrapped = new Error("DatabaseError", {
      cause: new Error("DrizzleQueryError", { cause: driverError() }),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("still says no when nothing in the chain is a duplicate key", () => {
    // The control. A walk that returned true for everything would satisfy every
    // assertion above while detecting nothing.
    const wrapped = new Error("outer", {
      cause: new Error("middle", {
        cause: Object.assign(new Error("disk full"), { code: "SQLITE_FULL" }),
      }),
    });
    expect(isUniqueViolation(wrapped)).toBe(false);
  });

  it("terminates on a cyclic cause chain instead of hanging", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });
});
