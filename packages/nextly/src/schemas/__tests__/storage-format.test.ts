import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../storage-format";

// Pins the on-disk spellings. These describe data that already exists in every
// deployed database, so a change here is a migration rather than an edit — this
// test exists to make such a change impossible to land by accident.
describe("storage format", () => {
  it("spells the identifiers deployed databases already contain", () => {
    expect(STORAGE_FORMAT).toMatchObject({
      registryTable: "dynamic_components",
      tablePrefix: "comp_",
      companionSuffix: "_locales",
      columns: {
        parentId: "_parent_id",
        parentTable: "_parent_table",
        parentField: "_parent_field",
        order: "_order",
        type: "_component_type",
      },
      indexPrefix: "idx_",
      uniqueIndexPrefix: "uq_",
      configPathDir: "components",
    });
  });

  it("keeps the companion suffix consistent with the table prefix", () => {
    // A companion is recognised as `<main table><suffix>`, so a generated main
    // table and its companion must both be derivable from these two values.
    const main = `${STORAGE_FORMAT.tablePrefix}seo`;
    expect(`${main}${STORAGE_FORMAT.companionSuffix}`).toBe("comp_seo_locales");
  });
});
