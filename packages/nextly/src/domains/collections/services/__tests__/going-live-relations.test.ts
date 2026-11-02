/**
 * How a publish reads and lays out a document's components and many-to-many
 * relationships: one read for a whole batch, every field with a key, the
 * write's own values over the stored ones, a required component relaxed
 * outside the default language, and no publish where the components cannot
 * be read at all.
 */
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors";
import {
  componentsRequiredInDefaultLanguage,
  GoingLiveRelationsBatch,
  readStoredRelations,
  relationsGoingLive,
  type StoredRelations,
} from "../collection-mutation-service";

const HERO = {
  name: "hero",
  type: "component",
  component: "hero",
} as unknown as FieldDefinition;
const TAGS = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
} as unknown as FieldDefinition;
const TITLE = { name: "title", type: "text" } as unknown as FieldDefinition;

function relations(id: string): StoredRelations {
  return { components: { hero: { heading: id } }, manyToMany: { tags: [id] } };
}

describe("a batch's stored relations", () => {
  it("are read once for every document in the batch, per language", async () => {
    const load = vi.fn((ids: readonly string[]) =>
      Promise.resolve(new Map(ids.map(id => [id, relations(id)])))
    );
    const batch = new GoingLiveRelationsBatch(["a", "b", "c"]);

    await batch.read("a", "en", load);
    expect(await batch.read("c", "en", load)).toEqual(relations("c"));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith(["a", "b", "c"]);

    await batch.read("b", "de", load);
    await batch.read("b", undefined, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("are read again for a document the batch has written since", async () => {
    let version = 0;
    const load = vi.fn((ids: readonly string[]) =>
      Promise.resolve(
        new Map(ids.map(id => [id, relations(`${id}${version}`)]))
      )
    );
    const batch = new GoingLiveRelationsBatch(["a", "b"]);
    await batch.read("b", "en", load);

    version = 1;
    batch.written("a");

    expect(await batch.read("a", "en", load)).toEqual(relations("a1"));
    expect(load).toHaveBeenLastCalledWith(["a"]);
    // A document the batch has not written keeps the batch's read.
    expect(await batch.read("b", "en", load)).toEqual(relations("b0"));
  });

  it("are read alone for a document outside the batch", async () => {
    const load = vi.fn((ids: readonly string[]) =>
      Promise.resolve(new Map(ids.map(id => [id, relations(id)])))
    );
    const batch = new GoingLiveRelationsBatch(["a"]);

    expect(await batch.read("z", "en", load)).toEqual(relations("z"));
    expect(load).toHaveBeenLastCalledWith(["z"]);
  });
});

describe("reading stored relations", () => {
  const relationships = {
    fetchManyToManyTargetIdsOf: vi.fn((_c: string, ids: readonly string[]) =>
      Promise.resolve(
        new Map(ids.map(id => [id, id === "a" ? ["t1"] : []] as const))
      )
    ),
  };

  it("refuses where the collection has components and no field-group service", async () => {
    const read = readStoredRelations({
      entryIds: ["a"],
      collectionName: "pages",
      parentTable: "dc_pages",
      fields: [TITLE, HERO],
      manyToManyFields: [],
      language: undefined,
      fieldGroups: undefined,
      relationships,
    });

    await expect(read).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.code === "CONFIGURATION_ERROR" &&
        /field-group service/.test(error.logMessage ?? "")
    );
  });

  it("reads a collection without components with no field-group service", async () => {
    const found = await readStoredRelations({
      entryIds: ["a", "b"],
      collectionName: "stories",
      parentTable: "dc_stories",
      fields: [TITLE, TAGS],
      manyToManyFields: [TAGS],
      language: undefined,
      fieldGroups: undefined,
      relationships,
    });

    expect(found.get("a")).toEqual({
      components: {},
      manyToMany: { tags: ["t1"] },
    });
    // No links is an empty list, which `required` judges, not an absent key.
    expect(found.get("b")).toEqual({
      components: {},
      manyToMany: { tags: [] },
    });
  });

  it("reads every document's components in one call, in the language and on the connection given", async () => {
    const populateComponentDataMany = vi.fn(
      (params: { entries: Record<string, unknown>[] }) =>
        Promise.resolve(
          params.entries.map(entry => ({ ...entry, hero: null, other: 1 }))
        )
    );
    const executor = { connection: "tx" };

    const found = await readStoredRelations({
      entryIds: ["a", "b"],
      collectionName: "pages",
      parentTable: "dc_pages_custom",
      fields: [TITLE, HERO],
      manyToManyFields: [],
      language: "de",
      executor,
      fieldGroups: { populateComponentDataMany },
      relationships,
    });

    expect(populateComponentDataMany).toHaveBeenCalledTimes(1);
    expect(populateComponentDataMany).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [{ id: "a" }, { id: "b" }],
        parentTable: "dc_pages_custom",
        depth: 0,
        strict: true,
        executor,
        locale: "de",
        fallbackLocale: false,
      })
    );
    // The component read's empty value is kept as a key; nothing else is.
    expect(found.get("b")).toEqual({
      components: { hero: null },
      manyToMany: {},
    });
  });
});

describe("what goes live", () => {
  it("lays the write's own values over the stored ones", () => {
    const live = relationsGoingLive({
      stored: {
        components: { hero: { heading: "Stored", code: "kept" }, cards: [] },
        manyToMany: { tags: ["t1"], topics: [] },
      },
      fields: [HERO, TAGS],
      componentSchemas: null,
      components: { hero: { heading: "Sent" } },
      manyToMany: { topics: ["p1"] },
    });

    expect(live).toEqual({
      hero: { heading: "Sent", code: "kept" },
      cards: [],
      tags: ["t1"],
      topics: ["p1"],
    });
  });
});

describe("required components by language", () => {
  const context = (enforce: boolean) => ({
    localizedFieldNames: new Set(["title"]),
    enforceLocalizedRequired: enforce,
  });

  it("relaxes a component's required outside the default language, as a translated field's", () => {
    expect(
      [
        ...componentsRequiredInDefaultLanguage(context(false), [
          TITLE,
          HERO,
          TAGS,
        ]).localizedFieldNames,
      ].sort()
    ).toEqual(["hero", "title"]);
  });

  it("keeps it in the default language", () => {
    const ctx = context(true);
    expect(componentsRequiredInDefaultLanguage(ctx, [TITLE, HERO])).toBe(ctx);
  });
});
