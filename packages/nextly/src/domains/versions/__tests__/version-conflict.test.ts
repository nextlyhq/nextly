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
import type { VersionsDbApi } from "../db-api";
import { VersionCaptureService } from "../version-capture-service";
import {
  VersionConflictError,
  hasVersionConflict,
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
});
