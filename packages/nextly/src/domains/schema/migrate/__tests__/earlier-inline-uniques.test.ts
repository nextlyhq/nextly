// The name PostgreSQL gives a column's inline UNIQUE, which is the only one the run lets go of.
import { describe, expect, it } from "vitest";

import { postgresInlineUniqueName } from "../earlier-inline-uniques";

describe("postgresInlineUniqueName", () => {
  it("is the table, the column and `key` joined, while that fits", () => {
    expect(postgresInlineUniqueName("dc_profiles", "person")).toBe(
      "dc_profiles_person_key"
    );
  });

  it("shortens the longer name first, to 63 bytes in all", () => {
    const name = postgresInlineUniqueName("t".repeat(60), "person");
    expect(name).toBe(`${"t".repeat(52)}_person_key`);
    expect(name).toHaveLength(63);
  });

  it("shortens both names alike once they are the same length", () => {
    expect(postgresInlineUniqueName("t".repeat(40), "c".repeat(40))).toBe(
      `${"t".repeat(29)}_${"c".repeat(29)}_key`
    );
  });

  it("never cuts a character in two", () => {
    // Each "é" is two bytes: 31 of them are 62 bytes, one over what the table may keep.
    const name = postgresInlineUniqueName("é".repeat(31), "c".repeat(29));
    expect(name).toBe(`${"é".repeat(14)}_${"c".repeat(29)}_key`);
  });
});
