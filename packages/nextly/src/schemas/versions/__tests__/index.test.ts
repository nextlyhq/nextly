import { describe, it, expect } from "vitest";

import { NextlyError } from "../../../errors";
import { versionsTables } from "../index";
import { nextlyVersionsMysql } from "../mysql";
import { nextlyVersionsPg } from "../postgres";
import { nextlyVersionsSqlite } from "../sqlite";

describe("versionsTables", () => {
  // Assert each dialect returns its OWN table object (identity), so a mis-wired
  // switch that returns the wrong dialect's table is caught - not merely that
  // some defined table came back.
  it("returns the dialect-specific versions table", () => {
    expect(versionsTables("postgresql").nextlyVersions).toBe(nextlyVersionsPg);
    expect(versionsTables("mysql").nextlyVersions).toBe(nextlyVersionsMysql);
    expect(versionsTables("sqlite").nextlyVersions).toBe(nextlyVersionsSqlite);
  });

  it("throws a NextlyError on an unknown dialect", () => {
    // Cast through `unknown` (not `any`, not `@ts-expect-error`) to exercise the
    // runtime exhaustiveness guard with a value the type system forbids.
    const invalid = "oracle" as unknown as Parameters<typeof versionsTables>[0];
    expect(() => versionsTables(invalid)).toThrow(NextlyError);
  });
});
