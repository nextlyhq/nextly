/**
 * A template's write judged again in its own transaction, against a stand-in
 * hold: the shape of the row about to commit, the collections it newly names
 * held to those the guard let through, a new own design's entry, held on the
 * write's transaction and refused once it is gone, and the template a write
 * newly links its row to as the one it was copied from, held the same way.
 *
 * That the hold takes turns with a delete of the entry on every dialect is
 * core's, proved by `nextly`'s
 * `plugins/__tests__/hold-entry-in-transaction.integration.test.ts`; that a
 * Direct API create racing a delete is refused here is proved by
 * `__tests__/entry-designs.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { judgeTemplateInTransaction } from "./entry-design-write";
import {
  GUARDED_COLLECTIONS_CONTEXT,
  registerTemplateGuard,
  type TemplateGuardSetup,
} from "./template-guard";

const TX = { token: "the write's transaction" };

/** The row core hands the phase for a new own design of `posts/p1`. */
const design = (extra: Record<string, unknown> = {}) => ({
  id: "d1",
  title: "Hello world",
  collection: null,
  entry: "posts/p1",
  entryCollection: "posts",
  entryId: "p1",
  ...extra,
});

/** The row of a collection's template, as stored. */
const template = (extra: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Post page",
  collection: "posts",
  entry: null,
  entryCollection: null,
  entryId: null,
  ...extra,
});

/** The handler over a hold answering `exists`, recording what it held. */
function judging(exists: boolean) {
  return judgingWith(() => exists);
}

/**
 * The handler over a hold answering `exists` for each row it is asked to
 * hold, recording what it held.
 */
function judgingWith(exists: (collection: string, id: string) => boolean) {
  const held: [unknown, string, string][] = [];
  const handler = judgeTemplateInTransaction<typeof TX>(
    async (tx, collection, id) => {
      held.push([tx, collection, id]);
      return exists(collection, id);
    },
    "templates"
  );
  return { handler, held };
}

async function refusalOf(run: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("the write was not refused");
}

describe("a new own design, in its transaction", () => {
  it("holds its entry on the write's transaction and goes through while it is there", async () => {
    const { handler, held } = judging(true);

    await handler({ operation: "create", data: design(), transaction: TX });

    expect(held).toEqual([[TX, "posts", "p1"]]);
  });

  it("is refused when its entry is gone by the time it holds it", async () => {
    const { handler } = judging(false);

    const refused = await refusalOf(() =>
      handler({ operation: "create", data: design(), transaction: TX })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refused.publicData)).toContain(
      'The collection \\"posts\\" has no entry \\"p1\\"'
    );
  });

  it("is refused, before any hold, when a later hook made it name a collection too", async () => {
    const { handler, held } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: design({ collection: "posts" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(held).toEqual([]);
  });

  it("is refused when its key is not the one its entry makes", async () => {
    const { handler } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: design({ entry: "posts/p2" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
  });
});

describe("a collection's template, in its transaction", () => {
  it("holds no entry", async () => {
    const { handler, held } = judging(false);

    await handler({ operation: "create", data: template(), transaction: TX });

    expect(held).toEqual([]);
  });

  it("is refused when it stores an empty value for a field naming an entry", async () => {
    const { handler } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: template({ entry: "" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
  });
});

describe("an update, in its transaction", () => {
  it("is refused when it moves an own design to another entry", async () => {
    const { handler, held } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "update",
        originalData: design(),
        data: design({ entry: "posts/p2", entryId: "p2" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(held).toEqual([]);
  });

  it("is refused when it empties a field naming an entry", async () => {
    const { handler } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "update",
        originalData: template(),
        data: template({ entryId: "" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
  });

  it("judges only what it changes, so a template stored before the rule still saves", async () => {
    const { handler } = judging(true);

    await handler({
      operation: "update",
      originalData: template({ entry: "" }),
      data: template({ entry: "", title: "Renamed" }),
      transaction: TX,
    });
  });

  it("lets an own design's ordinary save through, holding nothing", async () => {
    const { handler, held } = judging(false);

    await handler({
      operation: "update",
      originalData: design(),
      data: design({ title: "Renamed" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });

  it("lets an update that carries no stored row through, judging and holding nothing", async () => {
    const { handler, held } = judging(false);

    // Naming both a collection and an entry, which a create is refused for:
    // without the stored row there is nothing to tell a move from.
    await handler({
      operation: "update",
      data: design({ collection: "posts" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });

  it("asks nothing of a delete", async () => {
    const { handler, held } = judging(false);

    // A delete carries the document it removed in `data`.
    await handler({
      operation: "delete",
      data: design({ collection: "posts" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });
});

/** The hook context the guard leaves, naming `collections` as let through. */
const guarded = (collections: {
  collection: string | null;
  entryCollection: string | null;
}) => Object.freeze({ [GUARDED_COLLECTIONS_CONTEXT]: { ...collections } });

/** The path a refusal names. */
function pathOf(error: NextlyError): string | undefined {
  return (error.publicData as { errors?: { path: string }[] })?.errors?.[0]
    ?.path;
}

describe("a collection a hook names after the guard", () => {
  it("refuses a collection's template a later hook pointed at another collection", async () => {
    const { handler } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        // The guard let "posts" through; a later hook made it the page
        // builder's own pages, which the guard refuses.
        data: template({ collection: "pages" }),
        context: guarded({ collection: "posts", entryCollection: null }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("collection");
    expect(JSON.stringify(refused.publicData)).toContain(
      "after the collection was checked"
    );
  });

  it("refuses an own design a later hook moved to another collection's entry, before holding it", async () => {
    const { handler, held } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: design({ entry: "pages/p1", entryCollection: "pages" }),
        context: guarded({ collection: null, entryCollection: "posts" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("entryCollection");
    expect(JSON.stringify(refused.publicData)).toContain(
      "after the collection was checked"
    );
    expect(held).toEqual([]);
  });

  it("lets through the collection the guard let through", async () => {
    const { handler, held } = judging(true);

    await handler({
      operation: "create",
      data: template(),
      context: guarded({ collection: "posts", entryCollection: null }),
      transaction: TX,
    });
    await handler({
      operation: "create",
      data: design(),
      context: guarded({ collection: null, entryCollection: "posts" }),
      transaction: TX,
    });

    expect(held).toEqual([[TX, "posts", "p1"]]);
  });

  it("refuses an update a later hook pointed elsewhere, the write naming no collection itself", async () => {
    const { handler } = judging(true);

    const refused = await refusalOf(() =>
      handler({
        operation: "update",
        originalData: template(),
        data: template({ collection: "secrets" }),
        // The guard saw the stored "posts", which the write left alone.
        context: guarded({ collection: "posts", entryCollection: null }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("collection");
    expect(JSON.stringify(refused.publicData)).toContain(
      "after the collection was checked"
    );
  });

  it("lets an update point a template at the collection the guard judged", async () => {
    const { handler } = judging(true);

    await handler({
      operation: "update",
      originalData: template({ collection: "gone" }),
      data: template({ collection: "posts" }),
      context: guarded({ collection: "posts", entryCollection: null }),
      transaction: TX,
    });
  });

  it("refuses the row when a hook after the guard rewrote it, with the context the guard left", async () => {
    // The guard as registered, judging "posts" and leaving its record in the
    // write's shared context; then a later hook rewrites the collection, and
    // the phase is handed a frozen copy of that context, as core hands it.
    const guardSetup: TemplateGuardSetup = {
      templatesCollection: "templates",
      ownCollections: () => new Set(["pages", "templates"]),
      readCollection: async slug =>
        slug === "posts"
          ? { slug, fields: [{ name: "slug", type: "text" }] }
          : null,
      holderOf: async () => null,
      holdEntry: async () => true,
      entryExists: async () => true,
      declaredAddresses: new Map(),
      addressHolderOf: async () => null,
    };
    let guard: ((context: unknown) => unknown) | undefined;
    registerTemplateGuard(
      {
        hooks: {
          on: (_type, _collection, handler) => {
            guard = handler;
          },
        },
      },
      guardSetup
    );
    if (!guard) throw new Error("the guard was not registered");
    const shared: Record<string, unknown> = {};
    const data: Record<string, unknown> = {
      title: "Post page",
      collection: "posts",
    };
    await guard({ operation: "create", data, context: shared });
    data.collection = "pages";

    const { handler } = judging(true);
    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: template({ collection: data.collection }),
        context: Object.freeze(structuredClone(shared)),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("collection");
    expect(JSON.stringify(refused.publicData)).toContain(
      "after the collection was checked"
    );
  });
});

describe("the template a write links its row to, in its transaction", () => {
  /** A hold over every entry, and every template but `gone`. */
  const allBut = (gone: string) =>
    judgingWith(
      (collection, id) => !(collection === "templates" && id === gone)
    );

  it("holds the template a new own design was copied from, after its entry, and lets it through", async () => {
    const { handler, held } = allBut("none");

    await handler({
      operation: "create",
      data: design({ forkedFrom: "t1" }),
      transaction: TX,
    });

    expect(held).toEqual([
      [TX, "posts", "p1"],
      [TX, "templates", "t1"],
    ]);
  });

  it("refuses a new row linked to a template that is gone by the time it holds it", async () => {
    const { handler, held } = allBut("t1");

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: design({ forkedFrom: "t1" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("forkedFrom");
    expect(JSON.stringify(refused.publicData)).toContain(
      'There is no template \\"t1\\" for forkedFrom to name'
    );
    expect(held).toContainEqual([TX, "templates", "t1"]);
  });

  it("holds the link on any template row, not only an own design", async () => {
    const { handler, held } = allBut("t9");

    const refused = await refusalOf(() =>
      handler({
        operation: "create",
        data: template({ forkedFrom: "t9" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(held).toEqual([[TX, "templates", "t9"]]);
  });

  it("holds nothing for a row linked to no template, or to an empty one", async () => {
    const { handler, held } = allBut("none");

    await handler({
      operation: "create",
      data: template({ forkedFrom: null }),
      transaction: TX,
    });
    await handler({
      operation: "create",
      data: template({ forkedFrom: "" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });

  it("asks nothing of an update that leaves the link as it was, even to a template since deleted", async () => {
    // The hold would refuse "t1": a copy whose template was deleted while a
    // draft waited keeps the link on its live row, and still saves.
    const { handler, held } = allBut("t1");

    await handler({
      operation: "update",
      originalData: design({ forkedFrom: "t1" }),
      data: design({ forkedFrom: "t1", title: "Renamed" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });

  it("holds the template an update links its row to anew, and refuses it once gone", async () => {
    const { handler, held } = allBut("t2");

    await handler({
      operation: "update",
      originalData: design({ forkedFrom: null }),
      data: design({ forkedFrom: "t1" }),
      transaction: TX,
    });
    expect(held).toEqual([[TX, "templates", "t1"]]);

    const refused = await refusalOf(() =>
      handler({
        operation: "update",
        originalData: design({ forkedFrom: "t1" }),
        data: design({ forkedFrom: "t2" }),
        transaction: TX,
      })
    );
    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(pathOf(refused)).toBe("forkedFrom");
    expect(held).toEqual([
      [TX, "templates", "t1"],
      [TX, "templates", "t2"],
    ]);
  });

  it("asks nothing of an update emptying the link", async () => {
    const { handler, held } = allBut("t1");

    await handler({
      operation: "update",
      originalData: design({ forkedFrom: "t1" }),
      data: design({ forkedFrom: null }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });

  it("holds the link an update without the stored row names, having nothing to tell it from", async () => {
    const { handler, held } = allBut("t1");

    const refused = await refusalOf(() =>
      handler({
        operation: "update",
        data: design({ forkedFrom: "t1" }),
        transaction: TX,
      })
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(held).toEqual([[TX, "templates", "t1"]]);
  });
});
