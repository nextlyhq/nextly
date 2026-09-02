import { describe, expect, it } from "vitest";

import { isFieldGroupField } from "../../../../collections/fields/guards";
import {
  extractFieldGroupReferences,
  isFieldGroupType,
} from "../../../field-groups/storage/field-group-field-type";
import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import { diffSnapshots } from "../../pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";
import {
  fieldProducesColumn,
  getColumnDescriptor,
} from "../field-column-descriptor";

describe("Field Group Dual Vocabulary — type recognition & guards", () => {
  it("recognizes all standard field-group type tokens", () => {
    expect(isFieldGroupType("component")).toBe(true);
    expect(isFieldGroupType("fieldGroup")).toBe(true);
    expect(isFieldGroupType("text")).toBe(false);
    // No release ever wrote the kebab spelling, so accepting it would widen
    // the vocabulary beyond what storage declares.
    expect(isFieldGroupType("field-group")).toBe(false);
    expect(isFieldGroupType(null)).toBe(false);
    expect(isFieldGroupType(undefined)).toBe(false);
  });

  it("isFieldGroupField guard narrows both component and fieldGroup definitions", () => {
    expect(isFieldGroupField({ type: "component" })).toBe(true);
    expect(isFieldGroupField({ type: "fieldGroup" })).toBe(true);
    expect(isFieldGroupField({ type: "field-group" })).toBe(false);
    expect(isFieldGroupField({ type: "text" })).toBe(false);
  });

  it("extractFieldGroupReferences resolves single and multi references across keys", () => {
    expect(extractFieldGroupReferences({ component: "seo" })).toEqual({
      single: "seo",
      many: undefined,
    });
    expect(extractFieldGroupReferences({ fieldGroup: "seo" })).toEqual({
      single: "seo",
      many: undefined,
    });
    expect(
      extractFieldGroupReferences({ components: ["hero", "cta"] })
    ).toEqual({
      single: undefined,
      many: ["hero", "cta"],
    });
    expect(
      extractFieldGroupReferences({ fieldGroups: ["hero", "cta"] })
    ).toEqual({
      single: undefined,
      many: ["hero", "cta"],
    });
  });

  it("trims retained plural references, like the singular spellings", () => {
    // A padded slug resolves to nothing in a registry keyed by exact match —
    // and would slip past the deletion reference-protection scan with it.
    expect(
      extractFieldGroupReferences({ components: [" hero ", "cta"] })
    ).toEqual({
      single: undefined,
      many: ["hero", "cta"],
    });
    expect(
      extractFieldGroupReferences({ fieldGroups: ["hero", " cta "] })
    ).toEqual({
      single: undefined,
      many: ["hero", "cta"],
    });
  });
});

describe("Field Group Dual Vocabulary — schema table construction & diff", () => {
  it("never includes field-group fields as columns on collection tables", () => {
    const fields = [
      { name: "title", type: "text", required: true },
      { name: "seo", type: "fieldGroup", fieldGroup: "seo" },
      { name: "hero", type: "component", component: "hero" },
    ];

    const desiredTable = buildDesiredTableFromFields(
      "dc_blog_posts",
      fields as never,
      "sqlite",
      { builtBy: "collection" }
    );

    const columnNames = desiredTable.columns.map(c => c.name);
    expect(columnNames).toContain("title");
    expect(columnNames).not.toContain("seo");
    expect(columnNames).not.toContain("hero");
  });

  it("diffSnapshots emits zero drop/add column operations for field groups", () => {
    const fields = [
      { name: "title", type: "text" },
      { name: "seo", type: "fieldGroup", fieldGroup: "seo" },
    ];

    const desiredTable = buildDesiredTableFromFields(
      "dc_blog_posts",
      fields as never,
      "sqlite",
      { builtBy: "collection" }
    );

    const liveSnapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_blog_posts",
          columns: desiredTable.columns.map(c => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            default: c.default,
            primaryKey: c.primaryKey,
          })),
          indexes: [],
        },
      ],
    };

    const desiredSnapshot: NextlySchemaSnapshot = {
      tables: [desiredTable],
    };

    const ops = diffSnapshots(liveSnapshot, desiredSnapshot);
    const columnOps = ops.filter(
      op =>
        op.type === "add_column" ||
        op.type === "drop_column" ||
        op.type === "change_column_type" ||
        op.type === "change_column_nullable" ||
        op.type === "change_column_default"
    );
    expect(columnOps).toEqual([]);
  });
});
