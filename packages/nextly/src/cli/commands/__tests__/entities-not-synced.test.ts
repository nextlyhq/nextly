/**
 * What a `db:sync` run collects of the entities it could not sync: each once, with its first
 * reason, cleared when a later pass of the same run syncs it, and nothing outside a run.
 */
import { describe, expect, it } from "vitest";

import { ColumnsNotAddedError } from "../../../domains/schema/utils/missing-columns";
import {
  collectEntitiesNotSynced,
  noteEntityNotSynced,
  noteEntitySynced,
} from "../entities-not-synced";

const refused = (reason: string) =>
  new ColumnsNotAddedError("comp_seo", [{ column: "priority", reason }], []);

describe("the entities a run could not sync", () => {
  it("names each refused column with the database's reason, once per entity", async () => {
    const { notSynced } = await collectEntitiesNotSynced(async () => {
      noteEntityNotSynced("field group", "seo", refused("first"));
      // The settings pass after the first, failing again with another reason.
      noteEntityNotSynced("field group", "seo", refused("second"));
      noteEntityNotSynced("single", "seo", "its configuration was not found");
    });
    expect(notSynced).toEqual([
      { kind: "field group", slug: "seo", detail: "priority: first" },
      {
        kind: "single",
        slug: "seo",
        detail: "its configuration was not found",
      },
    ]);
  });

  it("forgets an entity a later pass of the run synced, and only that one", async () => {
    const { notSynced } = await collectEntitiesNotSynced(async () => {
      noteEntityNotSynced("field group", "seo", refused("locked"));
      noteEntityNotSynced("field group", "two", refused("locked"));
      noteEntitySynced("field group", "seo");
      // Another kind under the same slug is a different entity.
      noteEntitySynced("single", "two");
    });
    expect(notSynced.map(entity => entity.slug)).toEqual(["two"]);
  });

  it("keeps two runs apart, and notes nothing outside a run", async () => {
    noteEntityNotSynced("field group", "outside", refused("x"));
    const [first, second] = await Promise.all([
      collectEntitiesNotSynced(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        noteEntityNotSynced("field group", "a", refused("x"));
      }),
      collectEntitiesNotSynced(async () => {
        noteEntityNotSynced("field group", "b", refused("x"));
      }),
    ]);
    expect(first.notSynced.map(entity => entity.slug)).toEqual(["a"]);
    expect(second.notSynced.map(entity => entity.slug)).toEqual(["b"]);
  });
});
