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

  // A localized field group whose storage has been migrated has a companion
  // under the migrated prefix. A caller that walks the catalog rather than the
  // managed filter reaches it, and one that does not recognise it as a
  // companion probes it as an instance table — for an `id` column a companion
  // does not have, which fails the delete of any entity that gets that far.
  it("detects companions under the migrated field-group prefix", () => {
    expect(isCompanionTable("fg_hero_locales")).toBe(true);
    expect(isCompanionTable("fg_hero")).toBe(false);
  });

  it("companion tables still match the managed-prefix regex (prefix-based)", () => {
    // They are prefixed dc_/single_ so tablesFilter still covers them — the
    // pipeline must additionally exclude them via isCompanionTable.
    expect(isManagedTable("dc_pages_locales")).toBe(true);
  });
});
