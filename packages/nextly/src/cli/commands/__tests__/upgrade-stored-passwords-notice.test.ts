/**
 * The line `nextly migrate` prints while passwords stored before this release
 * are still held as given, on a run that stopped before hashing them: a
 * count, and the command that hashes them.
 */
import { describe, expect, it } from "vitest";

import { storedPasswordsNotice } from "../upgrade-steps/stored-passwords";

describe("the stored-passwords notice", () => {
  it("names the count and nextly migrate", () => {
    const notice = storedPasswordsNotice(3);
    expect(notice).toContain("3");
    expect(notice).toContain("`nextly migrate`");
  });

  it("says nothing when there is nothing to hash", () => {
    expect(storedPasswordsNotice(0)).toBeNull();
  });
});
