// Guards that a Schema Builder (UI) save cannot emit DDL against a table
// owned by code-first config or a plugin.

import { describe, it, expect } from "vitest";

import type { Operation } from "../diff/types";
import {
  excludeLockedTableOps,
  lockedTableNames,
  operationTargetTable,
} from "../pushschema-pipeline";
import type { DesiredSchema } from "../types";

const desired: DesiredSchema = {
  collections: {
    // Code-first / plugin owned.
    posts: {
      slug: "posts",
      tableName: "dc_posts",
      fields: [],
      locked: true,
    },
    // Builder owned.
    widget: {
      slug: "widget",
      tableName: "dc_widget",
      fields: [],
      locked: false,
    },
  },
  singles: {
    homepage: {
      slug: "homepage",
      tableName: "single_homepage",
      fields: [],
      locked: true,
    },
  },
  components: {
    address: {
      slug: "address",
      tableName: "comp_address",
      fields: [],
      locked: true,
    },
  },
};

const addColumn = (tableName: string): Operation =>
  ({
    type: "add_column",
    tableName,
    column: { name: "headline", type: "text", nullable: true },
  }) as unknown as Operation;

describe("lockedTableNames", () => {
  it("collects locked tables across collections, singles and components", () => {
    expect(lockedTableNames(desired)).toEqual(
      new Set(["dc_posts", "single_homepage", "comp_address"])
    );
  });

  it("returns an empty set when nothing is locked", () => {
    expect(
      lockedTableNames({ collections: {}, singles: {}, components: {} })
    ).toEqual(new Set());
  });
});

describe("operationTargetTable", () => {
  it("resolves the target table for each operation kind", () => {
    expect(operationTargetTable(addColumn("dc_widget"))).toBe("dc_widget");
    expect(
      operationTargetTable({
        type: "drop_table",
        tableName: "dc_posts",
      } as Operation)
    ).toBe("dc_posts");
    expect(
      operationTargetTable({
        type: "add_table",
        table: { name: "dc_new", columns: [] },
      } as unknown as Operation)
    ).toBe("dc_new");
  });

  it("judges a rename by its source table, which is the one that exists", () => {
    expect(
      operationTargetTable({
        type: "rename_table",
        fromName: "dc_posts",
        toName: "dc_articles",
      } as Operation)
    ).toBe("dc_posts");
  });
});

describe("excludeLockedTableOps", () => {
  it("drops operations targeting code-first tables and keeps builder ones", () => {
    const ops = [
      addColumn("dc_widget"),
      addColumn("dc_posts"),
      addColumn("comp_address"),
    ];
    const { kept, skipped } = excludeLockedTableOps(ops, desired);

    expect(kept).toEqual([ops[0]]);
    expect(skipped).toEqual([ops[1], ops[2]]);
  });

  it("blocks a rename or drop of a code-first table", () => {
    const ops: Operation[] = [
      { type: "drop_table", tableName: "dc_posts" } as Operation,
      {
        type: "rename_table",
        fromName: "single_homepage",
        toName: "single_landing",
      } as Operation,
    ];
    const { kept, skipped } = excludeLockedTableOps(ops, desired);

    expect(kept).toEqual([]);
    expect(skipped).toHaveLength(2);
  });

  it("returns the operations untouched when nothing is locked", () => {
    const ops = [addColumn("dc_widget"), addColumn("dc_posts")];
    const { kept, skipped } = excludeLockedTableOps(ops, {
      collections: {},
      singles: {},
      components: {},
    });

    expect(kept).toBe(ops);
    expect(skipped).toEqual([]);
  });

  it("keeps a new table the builder is creating", () => {
    const ops: Operation[] = [
      {
        type: "add_table",
        table: { name: "dc_gadget", columns: [] },
      } as unknown as Operation,
    ];
    const { kept, skipped } = excludeLockedTableOps(ops, desired);

    expect(kept).toHaveLength(1);
    expect(skipped).toEqual([]);
  });
});
