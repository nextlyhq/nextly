// A save that fails withdraws what it wrote. Where a withdrawal fails too, the failure that called
// for it must not be hidden, and the files it may have left must be named: a `nextly migrate` would
// otherwise apply a save the person was told failed.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { undoThenThrow } from "../collection-save";

const failure = NextlyError.conflict({ message: "The teardown failed." });

describe("withdrawing a failed save's files", () => {
  it("rethrows the failure itself when every withdrawal succeeds", async () => {
    const undone: string[] = [];
    await expect(
      undoThenThrow(failure, [
        {
          files: ["b.sql"],
          undo: () => Promise.resolve(void undone.push("b")),
        },
        {
          files: ["a.sql"],
          undo: () => Promise.resolve(void undone.push("a")),
        },
      ])
    ).rejects.toBe(failure);
    expect(undone).toEqual(["b", "a"]);
  });

  it("tries every withdrawal, and names the files of each that failed with the failure kept", async () => {
    const undone: string[] = [];
    const thrown = await undoThenThrow(failure, [
      { files: ["b.sql"], undo: () => Promise.reject(new Error("EACCES")) },
      { files: ["a.sql"], undo: () => Promise.resolve(void undone.push("a")) },
    ]).catch((error: unknown) => error);

    expect(undone).toEqual(["a"]);
    expect(thrown).toBeInstanceOf(NextlyError);
    const error = thrown as NextlyError;
    expect(error.publicMessage).toContain("The teardown failed.");
    expect(error.publicMessage).toContain("b.sql");
    expect(error.publicMessage).not.toContain("a.sql");
    expect(error.cause).toBe(failure);
  });
});
