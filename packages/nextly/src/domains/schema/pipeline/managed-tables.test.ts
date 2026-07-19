import { describe, it, expect } from "vitest";

import { isCompanionTable, isManagedTable } from "./managed-tables";

describe("isCompanionTable", () => {
  it("detects localized companion tables", () => {
    expect(isCompanionTable("dc_pages_locales")).toBe(true);
    expect(isCompanionTable("single_home_locales")).toBe(true);
  });

  it("is false for main / component / other tables", () => {
    expect(isCompanionTable("dc_pages")).toBe(false);
    expect(isCompanionTable("single_home")).toBe(false);
    expect(isCompanionTable("comp_hero")).toBe(false);
    expect(isCompanionTable("users")).toBe(false);
  });

  it("companion tables still match the managed-prefix regex (prefix-based)", () => {
    // They are prefixed dc_/single_ so tablesFilter still covers them — the
    // pipeline must additionally exclude them via isCompanionTable.
    expect(isManagedTable("dc_pages_locales")).toBe(true);
  });
});
