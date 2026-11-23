/**
 * A role assignment row's user id is matched to the requested id as the database compares ids:
 * on MySQL without regard to case, as its statement matched the row; on PostgreSQL and SQLite
 * exactly, as theirs did.
 */
import { describe, expect, it } from "vitest";

import { userIdMatchFor } from "./user-id-match";

const ID = "0b6f1c2e-7a3d-4c1e-9f00-abcdef012345";

describe("a row's user id, matched as the database compares ids", () => {
  it("on MySQL, is the requested user however either spells the id's case", () => {
    const same = userIdMatchFor("mysql");
    expect(same(ID.toUpperCase(), ID)).toBe(true);
    expect(same(ID, ID.toUpperCase())).toBe(true);
    expect(same(ID, ID)).toBe(true);
  });

  it.each(["postgresql", "sqlite", undefined])(
    "on %s, is the requested user only when spelled exactly alike",
    dialect => {
      const same = userIdMatchFor(dialect);
      expect(same(ID, ID)).toBe(true);
      expect(same(ID.toUpperCase(), ID)).toBe(false);
      expect(same(ID, ID.toUpperCase())).toBe(false);
    }
  );

  it("is never another user's id, in any case, on any dialect", () => {
    for (const dialect of ["mysql", "postgresql", "sqlite"]) {
      const same = userIdMatchFor(dialect);
      expect(same(`${ID}0`, ID)).toBe(false);
      expect(same(ID.toUpperCase(), `${ID}0`)).toBe(false);
    }
  });
});
