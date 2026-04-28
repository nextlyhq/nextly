// Snapshot-style assertions on the per-dialect type-change warning text.

import { describe, it, expect } from "vitest";

import { buildPerDialectWarning } from "../type-warnings.js";

describe("buildPerDialectWarning", () => {
  it("text -> int produces a warning for each dialect", () => {
    const w = buildPerDialectWarning("text", "int");
    expect(w.pg).toMatch(/postgres/i);
    expect(w.pg).toMatch(/cannot be cast/i);
    expect(w.mysql).toMatch(/mysql/i);
    expect(w.mysql).toMatch(/silently/i);
    expect(w.sqlite).toMatch(/sqlite/i);
    expect(w.sqlite).toMatch(/silently/i);
  });

  it("includes from -> to in every dialect's warning body", () => {
    const w = buildPerDialectWarning("varchar(255)", "varchar(50)");
    expect(w.pg).toContain("varchar(255)");
    expect(w.pg).toContain("varchar(50)");
    expect(w.mysql).toContain("varchar(255)");
    expect(w.mysql).toContain("varchar(50)");
    expect(w.sqlite).toContain("varchar(255)");
    expect(w.sqlite).toContain("varchar(50)");
  });
});
