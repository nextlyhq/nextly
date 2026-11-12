// Whether a Builder save's change reaches a relation's storage, which only the push applies: a
// field that stores another shape now, or one storing a list whose live column still carries a key.
// Every other change answers false, so the writer's own file applies it, and the live table is read
// only where a field stores a list or a reference naming its collection.
import { describe, expect, it, vi } from "vitest";

import type { TableSpec } from "../diff/types";
import { reachesRelationStorage } from "../recorded-shapes";

const one = { name: "author", type: "relationship", relationTo: "authors" };
const many = { ...one, hasMany: true };
const targets = { ...one, relationTo: ["authors", "tags"] };
const title = { name: "title", type: "text" };

/** The live `dc_posts`, with a key on each of `keyed`. */
const table = (keyed: string[]): TableSpec => ({
  name: "dc_posts",
  columns: [],
  foreignKeys: keyed.map(column => ({
    name: `fk_dc_posts_${column}`,
    columns: [column],
    referencesTable: "dc_authors",
    referencesColumns: ["id"],
    onDelete: "set null",
    onUpdate: "no action",
  })),
});

describe("reachesRelationStorage", () => {
  it.each([
    ["one to many", one, many],
    ["many to one", many, one],
    ["one to several collections", one, targets],
    ["a list to several collections", many, { ...targets, hasMany: true }],
  ])("answers true for %s, reading no table", async (_n, before, after) => {
    const liveTable = vi.fn();
    expect(
      await reachesRelationStorage({
        before: [title, before],
        after: [title, after],
        liveTable,
      })
    ).toBe(true);
    expect(liveTable).not.toHaveBeenCalled();
  });

  it("matches a field by its column, so a name in another case is the same field", async () => {
    expect(
      await reachesRelationStorage({
        before: [{ ...one, name: "Author" }],
        after: [many],
        liveTable: async () => table([]),
      })
    ).toBe(true);
  });

  it("answers false for a change to no relation, reading no table", async () => {
    const liveTable = vi.fn();
    expect(
      await reachesRelationStorage({
        before: [title, one],
        // The title becomes a textarea: a change, to no relation.
        after: [{ ...title, type: "textarea" }, one],
        liveTable,
      })
    ).toBe(false);
    expect(liveTable).not.toHaveBeenCalled();
  });

  it("answers false for a list kept as a list whose column has no key", async () => {
    expect(
      await reachesRelationStorage({
        before: [many],
        after: [many],
        liveTable: async () => table([]),
      })
    ).toBe(false);
  });

  it("answers true for a list kept as a list whose live column still has a key", async () => {
    expect(
      await reachesRelationStorage({
        before: [many],
        after: [many],
        liveTable: async () => table(["author"]),
      })
    ).toBe(true);
  });

  it("answers false for one reference kept as one, whose key belongs there", async () => {
    const liveTable = vi.fn(async () => table(["author"]));
    expect(
      await reachesRelationStorage({ before: [one], after: [one], liveTable })
    ).toBe(false);
    expect(liveTable).not.toHaveBeenCalled();
  });
});
