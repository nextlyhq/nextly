/**
 * The line a run prints while passwords stored before this release are still
 * held as given, where it stopped before hashing them: a count, and the
 * command that hashes them, which is the run's own.
 */
import { describe, expect, it } from "vitest";

import { storedPasswordsNotice } from "../upgrade-steps/stored-passwords";

describe("the stored-passwords notice", () => {
  it("names the count and nextly migrate", () => {
    const notice = storedPasswordsNotice(3);
    expect(notice).toContain("3");
    expect(notice).toContain("`nextly migrate`");
  });

  it("reads as it always has for nextly migrate", () => {
    expect(storedPasswordsNotice(3)).toBe(
      "3 password(s) stored before this release are not yet hashed. `nextly migrate` hashes them once every migration has applied."
    );
  });

  it("names nextly db:sync where that is the run", () => {
    expect(storedPasswordsNotice(3, "nextly db:sync")).toBe(
      "3 password(s) stored before this release are not yet hashed. `nextly db:sync` hashes them once it has synced every entity."
    );
  });

  it("says nothing when there is nothing to hash", () => {
    expect(storedPasswordsNotice(0, "nextly db:sync")).toBeNull();
    expect(storedPasswordsNotice(0)).toBeNull();
  });
});
