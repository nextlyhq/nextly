/**
 * The boot's storage-layout check reads the Schema Builder's registries to find entities laid out
 * the other way. A registry that is not there holds nothing to judge; one that is there but cannot
 * be read must refuse the boot, or every entity in it goes unjudged and boot carries on over them.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { readLayoutScanEntities } from "./layout-scan-entities";

/** An adapter whose registries are `present`, answering each read with `answer`. */
function adapterWith(args: {
  present: readonly string[];
  answer: (sql: string) => Promise<unknown[]>;
}): DrizzleAdapter {
  return {
    dialect: "sqlite",
    tableExists: (name: string) => Promise.resolve(args.present.includes(name)),
    listTables: () => Promise.resolve([...args.present]),
    executeQuery: (sql: string) => args.answer(sql),
  } as unknown as DrizzleAdapter;
}

const ROW = {
  slug: "memos",
  table_name: "dc_memos",
  fields: JSON.stringify([{ name: "heading", type: "text" }]),
  status: 0,
  localized: 0,
};

describe("readLayoutScanEntities", () => {
  it("reads each Builder entity the configuration does not declare", async () => {
    const adapter = adapterWith({
      present: ["dynamic_collections", "dynamic_singles"],
      answer: sql =>
        Promise.resolve(sql.includes("dynamic_collections") ? [ROW] : []),
    });
    const entities = await readLayoutScanEntities(adapter, new Set());
    expect(entities).toEqual([
      expect.objectContaining({ kind: "collection", tableName: "dc_memos" }),
    ]);
  });

  it("reads nothing from a registry that is not there yet", async () => {
    const adapter = adapterWith({
      present: [],
      answer: () => Promise.reject(new Error("no such table: dynamic_x")),
    });
    await expect(readLayoutScanEntities(adapter, new Set())).resolves.toEqual(
      []
    );
  });

  it("refuses when a registry that is there cannot be read", async () => {
    const adapter = adapterWith({
      present: ["dynamic_collections", "dynamic_singles"],
      answer: sql =>
        sql.includes("dynamic_collections")
          ? Promise.reject(new Error("connection reset"))
          : Promise.resolve([]),
    });
    await expect(
      readLayoutScanEntities(adapter, new Set())
    ).rejects.toMatchObject({
      code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    });
  });

  // Which of its two names the component registry carries is read from the catalog; a catalog
  // that cannot answer is not a database without components.
  it("refuses when the component registry's name cannot be read", async () => {
    const adapter = {
      ...adapterWith({
        present: ["dynamic_collections", "dynamic_singles"],
        answer: () => Promise.resolve([]),
      }),
      listTables: () => Promise.reject(new Error("catalog unavailable")),
    } as unknown as DrizzleAdapter;
    await expect(
      readLayoutScanEntities(adapter, new Set())
    ).rejects.toMatchObject({
      code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    });
  });
});
