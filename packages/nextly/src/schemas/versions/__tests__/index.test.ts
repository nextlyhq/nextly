import { describe, it, expect } from "vitest";

import { versionsTables } from "../index";

describe("versionsTables", () => {
  it("returns the versions table for each dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      expect(versionsTables(dialect).nextlyVersions).toBeDefined();
    }
  });

  it("throws on an unknown dialect", () => {
    // @ts-expect-error deliberately passing an invalid dialect
    expect(() => versionsTables("oracle")).toThrow(/Unsupported dialect/);
  });
});
