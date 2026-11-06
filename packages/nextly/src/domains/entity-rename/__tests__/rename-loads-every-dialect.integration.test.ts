/**
 * A rename refuses a new slug too wide for a column on ANY dialect, so it
 * reads all three dialects' declared widths, while a process loads only its
 * own dialect's tables when its adapter is created. The rename loads the
 * other two itself.
 *
 * It boots an instance, so it runs in the integration lane, whose setup loads
 * every dialect. Before each test it removes PostgreSQL's and MySQL's loads,
 * leaving a process with only SQLite loaded, as an app's would be, so a rename
 * that read the other dialects without loading them fails here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { loadedDialect } from "../../../database/dialect-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The loaded-dialect cache `dialect-tables.ts` keeps on `globalThis`. */
const cache = (
  globalThis as unknown as { __nextly_dialectTables: Map<string, unknown> }
).__nextly_dialectTables;
const OTHERS = ["postgresql", "mysql"];
const earlierLoads = new Map<string, unknown>();
let current: TestNextly | undefined;

beforeEach(() => {
  for (const dialect of OTHERS) {
    earlierLoads.set(dialect, cache.get(dialect));
    cache.delete(dialect);
  }
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  for (const [dialect, earlier] of earlierLoads) {
    if (earlier === undefined) cache.delete(dialect);
    else cache.set(dialect, earlier);
  }
});

describe("renaming a collection in a SQLite process", () => {
  it("succeeds, loading the other dialects' tables to measure widths", async () => {
    current = await createTestNextly({
      dialect: "sqlite",
      collections: [
        defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
      ],
    });
    // Renaming is a Builder operation, which a locked code-first collection
    // refuses.
    await current.adapter.update(
      "dynamic_collections",
      { source: "ui", locked: false },
      { and: [{ column: "slug", op: "=", value: "notes" }] }
    );
    expect(() => loadedDialect("postgresql")).toThrow();

    const renamed = await new DynamicCollectionRegistryService(
      current.adapter,
      silentLogger
    ).updateCollectionMetadata("notes", { slug: "journal" });

    expect(renamed).toMatchObject({ slug: "journal" });
    expect(loadedDialect("postgresql").dialect).toBe("postgresql");
    expect(loadedDialect("mysql").dialect).toBe("mysql");
  });
});
