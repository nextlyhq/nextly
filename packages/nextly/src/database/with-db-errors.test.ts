import { describe, it, expect } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import { DbError } from "./errors";
import { withDbErrors } from "./with-db-errors";

describe("withDbErrors", () => {
  it("passes through successful results", async () => {
    const result = await withDbErrors(async () => 42);
    expect(result).toBe(42);
  });

  it("converts a DbError thrown inside to a NextlyError", async () => {
    const dbErr = new DbError({
      message: "duplicate key",
      kind: "unique-violation",
      dialect: "postgresql",
      cause: new Error("driver"),
    });

    await expect(
      withDbErrors(async () => {
        throw dbErr;
      })
    ).rejects.toMatchObject({
      name: "NextlyError",
      code: "DUPLICATE",
      statusCode: 409,
      publicMessage: "Resource already exists.",
    });
  });

  it("preserves the DbError as cause on the converted NextlyError", async () => {
    const dbErr = new DbError({
      message: "deadlock",
      kind: "deadlock",
      dialect: "postgresql",
      cause: new Error("driver"),
    });

    await expect(
      withDbErrors(async () => {
        throw dbErr;
      })
    ).rejects.toSatisfy((err: unknown) => {
      return NextlyError.is(err) && err.cause === dbErr;
    });
  });

  it("re-throws non-DbError errors unchanged", async () => {
    const otherErr = new Error("not a DbError");
    await expect(
      withDbErrors(async () => {
        throw otherErr;
      })
    ).rejects.toBe(otherErr);
  });

  it("re-throws NextlyError instances unchanged (no double-wrap)", async () => {
    const nextlyErr = NextlyError.notFound({ logContext: { id: "p_99" } });
    await expect(
      withDbErrors(async () => {
        throw nextlyErr;
      })
    ).rejects.toBe(nextlyErr);
  });

  it("supports synchronous returns from the wrapped function (returning a Promise)", async () => {
    const result = await withDbErrors(() => Promise.resolve("sync-async"));
    expect(result).toBe("sync-async");
  });
});
