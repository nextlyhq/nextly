/**
 * A template's write judged again in its own transaction, against a stand-in
 * hold: the shape of the row about to commit, and a new own design's entry,
 * held on the write's transaction and refused once it is gone.
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
  const held: [unknown, string, string][] = [];
  const handler = judgeTemplateInTransaction<typeof TX>(
    async (tx, collection, id) => {
      held.push([tx, collection, id]);
      return exists;
    }
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

  it("asks nothing of a delete", async () => {
    const { handler, held } = judging(false);

    await handler({
      operation: "delete",
      originalData: design({ collection: "posts" }),
      transaction: TX,
    });

    expect(held).toEqual([]);
  });
});
