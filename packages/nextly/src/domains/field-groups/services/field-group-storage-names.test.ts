import { describe, expect, it } from "vitest";

import { typeColumnForNewTable } from "../storage/resolve-storage-names";

import {
  fieldGroupTableNameFor,
  isDerivedTableName,
  namingOfRegistry,
  storageNamesFor,
  underNaming,
} from "./field-group-storage-names";

describe("field-group storage names", () => {
  it("gives each naming its registry, prefix and discriminator", () => {
    expect(storageNamesFor("legacy")).toMatchObject({
      registryTable: "dynamic_components",
      tablePrefix: "comp_",
      typeColumn: "_component_type",
    });
    expect(storageNamesFor("current")).toMatchObject({
      registryTable: "dynamic_field_groups",
      tablePrefix: "fg_",
      typeColumn: "_field_group_type",
    });
  });

  it("reads the naming off the registry's name", () => {
    expect(namingOfRegistry("dynamic_field_groups")).toBe("current");
    expect(namingOfRegistry("dynamic_components")).toBe("legacy");
  });

  it("names a new group's table by the slug's form under either naming", () => {
    expect(fieldGroupTableNameFor("legacy", "hero-banner")).toBe(
      "comp_hero_banner"
    );
    // The name the storage migration moves the legacy one to.
    expect(fieldGroupTableNameFor("current", "hero-banner")).toBe(
      "fg_hero_banner"
    );
  });

  it("moves only the legacy prefix, and leaves any other name as it is", () => {
    expect(underNaming("current", "comp_card")).toBe("fg_card");
    expect(underNaming("legacy", "comp_card")).toBe("comp_card");
    expect(underNaming("current", "fg_card")).toBe("fg_card");
    expect(underNaming("current", "archive")).toBe("archive");
  });

  it("knows a stored name as the group's own under either naming, and nothing else", () => {
    expect(isDerivedTableName("card", "comp_card")).toBe(true);
    expect(isDerivedTableName("card", "fg_card")).toBe(true);
    expect(isDerivedTableName("card", "comp_other")).toBe(false);
    expect(isDerivedTableName("card", "card")).toBe(false);
  });
});

describe("the discriminator a table is created with", () => {
  it("is the migrated column for a table under the current prefix", () => {
    expect(typeColumnForNewTable("fg_card")).toBe("_field_group_type");
    expect(typeColumnForNewTable("FG_card")).toBe("_field_group_type");
  });

  it("is the legacy column for any other name", () => {
    expect(typeColumnForNewTable("comp_card")).toBe("_component_type");
    expect(typeColumnForNewTable("archive")).toBe("_component_type");
  });
});
