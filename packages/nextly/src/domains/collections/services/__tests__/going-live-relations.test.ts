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
  readStoredComponents,
  readStoredManyToMany,
  relationsBatchFor,
  relationsGoingLive,
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

/** A load that answers each document by its id, counting its reads. */
function countingLoad() {
  const components = vi.fn(
    (ids: readonly string[], language: string | undefined) =>
      Promise.resolve(
        new Map(
          ids.map(id => [id, { hero: { heading: `${id}:${language ?? "-"}` } }])
        )
      )
  );
  const manyToMany = vi.fn((ids: readonly string[]) =>
    Promise.resolve(new Map(ids.map(id => [id, { tags: [id] }])))
  );
  return { components, manyToMany };
}

describe("a batch's stored relations", () => {
  it("are read once for every document in the batch: components per language, links once", async () => {
    const load = countingLoad();
    const batch = new GoingLiveRelationsBatch(["a", "b", "c"]);

    await batch.read("a", "en", load);
    expect(await batch.read("c", "en", load)).toEqual({
      components: { hero: { heading: "c:en" } },
      manyToMany: { tags: ["c"] },
    });
    expect(load.components).toHaveBeenCalledTimes(1);
    expect(load.components).toHaveBeenLastCalledWith(["a", "b", "c"], "en");

    await batch.read("b", "de", load);
    await batch.read("b", undefined, load);
    expect(load.components).toHaveBeenCalledTimes(3);
    // The links are the same in every language: read once for the batch.
    expect(load.manyToMany).toHaveBeenCalledTimes(1);
  });

  it("read each component's definition once for every document", async () => {
    const batch = new GoingLiveRelationsBatch(["a", "b"]);
    const read = vi.fn(() => Promise.resolve([]));

    await batch.componentFields("hero", read);
    await batch.componentFields("hero", read);
    await batch.componentFields("card", read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("are read alone for a document outside the batch", async () => {
    const load = countingLoad();
    const batch = new GoingLiveRelationsBatch(["a"]);

    expect((await batch.read("z", "en", load)).manyToMany).toEqual({
      tags: ["z"],
    });
    expect(load.components).toHaveBeenLastCalledWith(["z"], "en");
  });
});

// A transaction holds the lock of the one row it judges, so the relations it
// reads through a batch holding other rows could change before it locks them.
// The plausible broken implementation shares any batch on a transaction, and
// a judgement there reads another row's relations as they were before it held
// that row's lock.
describe("the batch a judgement reads its stored relations through", () => {
  it("is never a batch holding another entry, on a transaction", async () => {
    const shared = new GoingLiveRelationsBatch(["a", "b"]);
    const load = countingLoad();
    await shared.read("a", "en", load);

    const batch = relationsBatchFor({
      entryId: "a",
      onTransaction: true,
      shared,
    });

    expect(batch).not.toBe(shared);
    // A fresh read, for the locked entry alone.
    await batch.read("a", "en", load);
    expect(load.components).toHaveBeenCalledTimes(2);
    expect(load.components).toHaveBeenLastCalledWith(["a"], "en");
  });

  it("is the batch holding the locked entry alone, on a transaction", () => {
    const shared = new GoingLiveRelationsBatch(["a"]);

    expect(
      relationsBatchFor({ entryId: "a", onTransaction: true, shared })
    ).toBe(shared);
    expect(
      relationsBatchFor({ entryId: "b", onTransaction: true, shared })
    ).not.toBe(shared);
  });

  it("is the batch the judgement is made with, off a transaction", () => {
    const shared = new GoingLiveRelationsBatch(["a", "b"]);

    expect(
      relationsBatchFor({ entryId: "a", onTransaction: false, shared })
    ).toBe(shared);
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
    const read = readStoredComponents({
      entryIds: ["a"],
      collectionName: "pages",
      parentTable: "dc_pages",
      fields: [TITLE, HERO],
      language: undefined,
      fieldGroups: undefined,
    });

    await expect(read).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.code === "CONFIGURATION_ERROR" &&
        /field-group service/.test(error.logMessage ?? "")
    );
  });

  it("reads a collection without components with no field-group service", async () => {
    const read = {
      entryIds: ["a", "b"],
      collectionName: "stories",
      fields: [TITLE, TAGS],
    };
    expect(
      await readStoredComponents({
        ...read,
        parentTable: "dc_stories",
        language: undefined,
        fieldGroups: undefined,
      })
    ).toEqual(new Map());

    const links = await readStoredManyToMany({
      ...read,
      manyToManyFields: [TAGS],
      relationships,
    });
    expect(links.get("a")).toEqual({ tags: ["t1"] });
    // No links is an empty list, which `required` judges, not an absent key.
    expect(links.get("b")).toEqual({ tags: [] });
  });

  it("reads every document's components in one call, in the language and on the connection given", async () => {
    const populateComponentDataMany = vi.fn(
      (params: { entries: Record<string, unknown>[] }) =>
        Promise.resolve(
          params.entries.map(entry => ({ ...entry, hero: null, other: 1 }))
        )
    );
    const executor = { connection: "tx" };

    const found = await readStoredComponents({
      entryIds: ["a", "b"],
      collectionName: "pages",
      parentTable: "dc_pages_custom",
      fields: [TITLE, HERO],
      language: "de",
      executor,
      fieldGroups: { populateComponentDataMany },
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
    expect(found.get("b")).toEqual({ hero: null });
  });

  it("reads a batch past one statement's parameters in runs of 500 ids", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `e${i}`);
    const populateComponentDataMany = vi.fn(
      (params: { entries: Record<string, unknown>[] }) =>
        Promise.resolve(params.entries.map(entry => ({ ...entry, hero: null })))
    );
    const fetchManyToManyTargetIdsOf = vi.fn(
      (_c: string, chunk: readonly string[]) =>
        Promise.resolve(new Map(chunk.map(id => [id, [] as string[]])))
    );

    const components = await readStoredComponents({
      entryIds: ids,
      collectionName: "pages",
      parentTable: "dc_pages",
      fields: [HERO],
      language: undefined,
      fieldGroups: { populateComponentDataMany },
    });
    const links = await readStoredManyToMany({
      entryIds: ids,
      collectionName: "pages",
      fields: [TAGS],
      manyToManyFields: [TAGS],
      relationships: { fetchManyToManyTargetIdsOf },
    });

    expect(
      populateComponentDataMany.mock.calls.map(([p]) => p.entries.length)
    ).toEqual([500, 500, 1]);
    expect(
      fetchManyToManyTargetIdsOf.mock.calls.map(([, chunk]) => chunk.length)
    ).toEqual([500, 500, 1]);
    expect(components.size).toBe(1001);
    expect(links.get("e1000")).toEqual({ tags: [] });
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
        ...componentsRequiredInDefaultLanguage(
          context(false),
          [TITLE, HERO, TAGS],
          true
        ).localizedFieldNames,
      ].sort()
    ).toEqual(["hero", "title"]);
  });

  it("keeps it on a document that is the same in every language, whatever the language", () => {
    const ctx = {
      localizedFieldNames: new Set<string>(),
      enforceLocalizedRequired: false,
    };
    expect(componentsRequiredInDefaultLanguage(ctx, [TITLE, HERO], false)).toBe(
      ctx
    );
  });

  it("relaxes it on a document whose only translated values sit in a component", () => {
    const ctx = {
      localizedFieldNames: new Set<string>(),
      enforceLocalizedRequired: false,
    };
    expect([
      ...componentsRequiredInDefaultLanguage(ctx, [TITLE, HERO], true)
        .localizedFieldNames,
    ]).toEqual(["hero"]);
  });

  it("keeps it in the default language", () => {
    const ctx = context(true);
    expect(componentsRequiredInDefaultLanguage(ctx, [TITLE, HERO], true)).toBe(
      ctx
    );
  });
});
