/**
 * A header & footer set's area choices: every published component the caller
 * may read, the ones marked for the area first, then the others, each by
 * title; the component the set holds answered for past the list's bound; and
 * the definitions read only for what is drawn.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { readSetAreaChoices } from "./set-area-choices-route";

const ctx = () => ({
  self: { collections: {} },
  caller: {
    can: vi.fn(async () => true),
    identity: vi.fn(async () => ({ user: { id: "ada" } })),
  },
});

/** The Direct API over published rows, and by id over `byId`. */
function nextly(
  rows: Record<string, unknown>[],
  byId: Record<string, Record<string, unknown>> = {},
  hasNext = false
) {
  return {
    find: vi.fn(async (args: Record<string, unknown>) => {
      const id = (args.where as { id?: { equals?: string } } | undefined)?.id;
      if (id?.equals !== undefined) {
        const row = byId[id.equals];
        return { items: row === undefined ? [] : [row], meta: {} };
      }
      // The definitions' reads, by many ids: none stored here.
      if (id !== undefined) return { items: [], meta: {} };
      return { items: rows, meta: { hasNext } };
    }),
  };
}

const ROWS = [
  { id: "a", title: "Alpha", area: "footer" },
  { id: "b", title: "Bravo", area: "header" },
  { id: "c", title: "Charlie", area: null },
  { id: "d", title: "Delta", area: "header" },
];

const ASK = {
  area: "header" as const,
  locale: undefined,
  selected: undefined,
  pictures: false,
  store: { field: "content" },
  limits: DEFAULT_LIMITS,
};

describe("a set's area choices", () => {
  it("lists the components marked for the area first, then the others, each by title", async () => {
    const answer = await readSetAreaChoices(
      ctx() as never,
      nextly(ROWS) as never,
      ASK
    );
    expect(answer.items).toEqual([
      { id: "b", title: "Bravo", marked: true },
      { id: "d", title: "Delta", marked: true },
      { id: "a", title: "Alpha", marked: false },
      { id: "c", title: "Charlie", marked: false },
    ]);
    expect(answer.meta).toEqual({
      area: "header",
      more: false,
      definitions: {},
    });
  });

  it("reads published components only, as the caller, names and marks alone", async () => {
    const api = nextly(ROWS);
    await readSetAreaChoices(ctx() as never, api as never, ASK);
    expect(api.find).toHaveBeenCalledTimes(1);
    expect(api.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "components",
        status: "published",
        sort: "title",
        overrideAccess: false,
        user: { id: "ada" },
        select: { id: true, title: true, area: true },
      })
    );
  });

  it("answers for the component the set holds past the list's bound", async () => {
    const api = nextly(
      ROWS,
      { z: { id: "z", title: "Zulu", area: "header" } },
      true
    );
    const answer = await readSetAreaChoices(ctx() as never, api as never, {
      ...ASK,
      selected: "z",
    });
    expect(answer.items.map(item => item.id)).toEqual([
      "b",
      "d",
      "z",
      "a",
      "c",
    ]);
    expect(answer.meta.more).toBe(true);
  });

  it("does not read the selected component again when the list holds it", async () => {
    const api = nextly(ROWS);
    await readSetAreaChoices(ctx() as never, api as never, {
      ...ASK,
      selected: "b",
    });
    const byId = api.find.mock.calls.filter(
      ([args]) =>
        (args.where as { id?: { equals?: string } } | undefined)?.id?.equals !==
        undefined
    );
    expect(byId).toEqual([]);
  });

  it("leaves out a selected component the caller can't read published", async () => {
    const answer = await readSetAreaChoices(
      ctx() as never,
      nextly(ROWS) as never,
      { ...ASK, selected: "gone" }
    );
    expect(answer.items.map(item => item.id)).not.toContain("gone");
  });

  /** The ids each definitions read asked for, in order. */
  function definitionReads(api: ReturnType<typeof nextly>): string[][] {
    return api.find.mock.calls.flatMap(([args]) => {
      const ids = (args.where as { id?: { in?: string[] } } | undefined)?.id
        ?.in;
      return ids === undefined ? [] : [ids];
    });
  }

  it("reads the definitions of the selected component alone, without pictures", async () => {
    const api = nextly(ROWS);
    await readSetAreaChoices(ctx() as never, api as never, {
      ...ASK,
      selected: "d",
    });
    expect(definitionReads(api).flat()).toEqual(["d"]);
  });

  it("reads every listed component's definitions when the pictures are asked for", async () => {
    const api = nextly(ROWS);
    await readSetAreaChoices(ctx() as never, api as never, {
      ...ASK,
      pictures: true,
    });
    expect(new Set(definitionReads(api).flat())).toEqual(
      new Set(["a", "b", "c", "d"])
    );
  });
});
