/**
 * Which rows of a structured value a write records the source row of.
 *
 * A translated repeater keeps its rows in an array; a blocks field keeps them in a block document,
 * as `nodes`, with a container block's own nodes in its slots. A claim's `rows` names source rows
 * by row id for both, so each node a claim names is recorded under `<field>#<node id>`, nested
 * nodes included, as each item of a repeater is.
 */
import { describe, expect, it } from "vitest";

import { recordWrittenValues, type ProvenanceDb } from "../record-provenance";

/** A provenance table held in memory: what a write inserts, and nothing to read back. */
function memoryDb(): ProvenanceDb & { inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    select: async () => [],
    insert: async <T>(_table: string, data: Record<string, unknown>) => {
      inserted.push(data);
      return data as T;
    },
    updateCount: async () => 0,
    delete: async () => 0,
  };
}

const write = {
  scopeKind: "collection" as const,
  scopeSlug: "pages",
  entryId: "p1",
  locale: "es",
  partState: "live" as const,
  defaultLocale: "en",
  savedBy: { type: "apiKey" as const, id: "key-1" },
};

const node = (id: string, slots?: Record<string, unknown[]>) => ({
  id,
  type: "core/section",
  version: 1,
  props: {},
  ...(slots ? { slots } : {}),
});

describe("recording the source row of each row a claim names", () => {
  it("records each node of a block document, a container's nested nodes included", async () => {
    const db = memoryDb();
    await recordWrittenValues(db, {
      ...write,
      values: {
        body: {
          formatVersion: 1,
          kind: "page",
          nodes: [node("n1", { children: [node("n2")] }), node("n3")],
        },
      },
      jsonFields: new Set(["body"]),
      claims: {
        body: {
          origin: "machine",
          engine: "e1",
          rows: { n1: "s1", n2: "s2", n3: "s3" },
        },
      },
    });
    expect(
      db.inserted
        .map(row => [String(row.fieldPath), row.originRowId ?? null])
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
    ).toEqual([
      ["body", null],
      ["body#n1", "s1"],
      ["body#n2", "s2"],
      ["body#n3", "s3"],
    ]);
  });

  it("records each item of a repeater, as before", async () => {
    const db = memoryDb();
    await recordWrittenValues(db, {
      ...write,
      values: { items: [{ id: "a", label: "Uno" }] },
      jsonFields: new Set(["items"]),
      claims: { items: { origin: "machine", engine: "e1", rows: { a: "a" } } },
    });
    expect(db.inserted.map(row => row.fieldPath).sort()).toEqual([
      "items",
      "items#a",
    ]);
  });
});
