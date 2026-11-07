/**
 * The shared styles' routes, against fakes of the store and the usage index:
 * who each asks, what each writes, and what each refuses.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  SHARED_STYLE_IN_USE_CODE,
  sharedStyleUsagePath,
  sharedStyleWhereUsedPath,
  type SharedStyleUsageKind,
} from "./library-contract";
import { pageBuilder } from "./plugin";
import {
  countSharedStyleUsage,
  firstReadableTitle,
  LOCK_SHARED_STYLES_PERMISSION,
  SHARED_STYLE_COUNT_MS,
  lockSharedStyle,
  mayReadSharedStyleUsage,
  readSharedStyleUsage,
  readSharedStyleUses,
  removeSharedStyles,
  sharedStyleRoutes,
  siteStyleClassStore,
  type SharedStyleStore,
  type StillUsedCheck,
  type SharedStyleUsageSource,
} from "./shared-styles-routes";
import { SHARED_STYLE_LOCK_WRITE_CONTEXT } from "./site-style-storage";
import type { DocumentsUsing } from "./usage-count";
import type { UsageIndexHealth } from "./usage-index-health";

const card = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: {},
};
const hero = { id: "c-hero", slug: "hero", orderIndex: 1, styles: {} };

const WHOLE: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
};
const NOT_WHOLE: UsageIndexHealth = {
  ...WHOLE,
  coversExistingDocuments: false,
};

/** A store over `classes`, read at version `rev`, recording each write. */
function storeOf(classes: Record<string, unknown>[], rev?: string) {
  const write = vi.fn<SharedStyleStore["write"]>(async () => undefined);
  const store: SharedStyleStore = {
    read: async () => ({ entries: classes, rev }),
    write,
  };
  return { store, write };
}

/** The read a write was made from, as `storeOf` gives it. */
const fromRead = (rev?: string) =>
  expect.objectContaining({ entries: expect.any(Array), rev });

const KINDS: Record<string, SharedStyleUsageKind> = {
  components: "components",
  patterns: "patterns",
};

function usageOf(
  health: UsageIndexHealth,
  uses: Record<string, DocumentsUsing["collections"]> = {},
  complete = true
) {
  const asked: string[] = [];
  const batches: (readonly string[])[] = [];
  const source: SharedStyleUsageSource = {
    health: vi.fn(async () => health),
    documentsUsingEach: async ids => {
      batches.push(ids);
      asked.push(...ids);
      return new Map(
        ids.map(id => [
          id,
          {
            collections: Object.hasOwn(uses, id) ? (uses[id] ?? []) : [],
            complete: complete && health.coversExistingDocuments,
          },
        ])
      );
    },
    kindOf: collection => KINDS[collection] ?? "pages",
  };
  return { source, asked, batches };
}

const post = (body: unknown) =>
  new Request("http://local/shared-styles", {
    method: "POST",
    body: JSON.stringify(body),
  });

/** A rescan that finds no stored document still using any style. */
const NOT_STILL_USED: StillUsedCheck = {
  uses: async () => [],
  firstReadable: async () => undefined,
};

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A Single reader for a listing that names no Single. */
const NO_SINGLE = async (): Promise<string | null> => null;

describe("the shared-style permission", () => {
  it("is the plugin's own, declared beside the site permission", () => {
    expect(LOCK_SHARED_STYLES_PERMISSION).toBe(
      "lock-page-builder-shared-styles"
    );
    const declared = (pageBuilder().contributes?.permissions ?? []).map(
      entry => `${entry.action}-${entry.resource}`
    );
    expect(declared).toEqual([
      "manage-page-builder-site",
      "lock-page-builder-shared-styles",
    ]);
  });

  it("gates lock and remove on their permission, and leaves the usage reads to their handler", () => {
    const routes = sharedStyleRoutes({
      configClassIds: new Set(),
      usage: () => usageOf(WHOLE).source,
    });
    const scope = {
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (slug: string, action: string) => `${action}-${slug}`,
      single: (slug: string, action: string) => `${action}-renamed_${slug}`,
    };
    expect(
      routes.map(route => [
        route.method,
        route.path,
        route.requiredPermission === undefined ||
        typeof route.requiredPermission === "string"
          ? route.requiredPermission
          : route.requiredPermission(scope),
      ])
    ).toEqual([
      ["POST", "/shared-styles/lock", "lock-page-builder-shared-styles"],
      ["GET", "/shared-styles/usage", undefined],
      ["GET", "/shared-styles/where-used", undefined],
      // Design's update: whoever a whole count lets remove a style.
      ["POST", "/shared-styles/count", "update-renamed_site-style"],
      ["POST", "/shared-styles/remove", "update-renamed_site-style"],
    ]);
  });
});

describe("who may read shared styles' usage", () => {
  /** A caller holding exactly the permissions named, as `action-resource`. */
  const holding = (...held: string[]) => ({
    self: { singles: { "site-style": "renamed_site-style" } } as never,
    caller: {
      can: vi.fn(async (action: string, resource: string) =>
        held.includes(`${action}-${resource}`)
      ),
    } as never,
  });

  it("admits Design's read of the RESOLVED site style", async () => {
    expect(
      await mayReadSharedStyleUsage(holding("read-renamed_site-style"))
    ).toBe(true);
  });

  it("admits the lock permission alone", async () => {
    expect(
      await mayReadSharedStyleUsage(holding(LOCK_SHARED_STYLES_PERMISSION))
    ).toBe(true);
  });

  it("refuses a caller holding neither, and nobody", async () => {
    expect(await mayReadSharedStyleUsage(holding("read-pages"))).toBe(false);
    expect(
      await mayReadSharedStyleUsage({
        self: { singles: {} } as never,
        caller: null,
      })
    ).toBe(false);
  });
});

describe("locking a shared style", () => {
  it("sets only its lock, marked as the lock route's write", async () => {
    const { store, write } = storeOf([card, hero]);
    const response = await lockSharedStyle(
      post({ classId: "c-card", locked: true }),
      store,
      new Set()
    );
    expect(write).toHaveBeenCalledWith(
      [{ ...card, locked: true }, hero],
      SHARED_STYLE_LOCK_WRITE_CONTEXT,
      fromRead()
    );
    expect(await response.json()).toEqual({
      message: "Card is locked.",
      item: { ...card, locked: true },
    });
  });

  it("unlocks by removing the key, never writing false", async () => {
    const { store, write } = storeOf([{ ...card, locked: true }, hero]);
    await lockSharedStyle(
      post({ classId: "c-card", locked: false }),
      store,
      new Set()
    );
    expect(write).toHaveBeenCalledWith(
      [card, hero],
      SHARED_STYLE_LOCK_WRITE_CONTEXT,
      fromRead()
    );
  });

  it("writes nothing when the style is already as asked", async () => {
    const { store, write } = storeOf([{ ...card, locked: true }]);
    await lockSharedStyle(
      post({ classId: "c-card", locked: true }),
      store,
      new Set()
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a style the site defines only in code, and one that is not there", async () => {
    const { store, write } = storeOf([hero]);
    expect(
      await refusal(
        lockSharedStyle(
          post({ classId: "c-code", locked: true }),
          store,
          new Set(["c-code"])
        )
      )
    ).toMatchObject({ code: "CONFLICT" });
    expect(
      await refusal(
        lockSharedStyle(
          post({ classId: "c-none", locked: true }),
          store,
          new Set()
        )
      )
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a class id and a lock", async () => {
    const { store } = storeOf([card]);
    expect(
      await refusal(
        lockSharedStyle(post({ classId: "c-card" }), store, new Set())
      )
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("how widely shared styles are used", () => {
  const usageRequest = (...ids: string[]) =>
    new Request(
      `http://local/shared-styles/usage?${ids.map(id => `id=${encodeURIComponent(id)}`).join("&")}`
    );
  const caller = (lock: boolean, design = false) => ({
    self: { singles: { "site-style": "renamed_site-style" } } as never,
    caller: {
      can: vi.fn(async (action: string, resource: string) => {
        const held = `${action}-${resource}`;
        if (lock && held === LOCK_SHARED_STYLES_PERMISSION) return true;
        // Design's update of the RESOLVED site style.
        return design && held === "update-renamed_site-style";
      }),
    } as never,
  });

  it("counts each style's documents, by kind, with the index's health", async () => {
    const { source } = usageOf(WHOLE, {
      "c-card": [
        { collection: "pages", documents: ["p1", "p2"] },
        { collection: "posts", documents: ["x1"] },
        { collection: "components", documents: ["k1"] },
      ],
    });
    const answer = await readSharedStyleUsage(
      usageRequest("c-card", "c-hero"),
      caller(true),
      source
    );
    expect(answer).toEqual({
      whole: true,
      counting: false,
      mayLock: true,
      // The lock alone counts nothing: counting is Design's update.
      mayCount: false,
      styles: {
        "c-card": {
          documents: 4,
          byKind: { pages: 3, components: 1, patterns: 0, layouts: 0 },
          complete: true,
        },
        "c-hero": {
          documents: 0,
          byKind: { pages: 0, components: 0, patterns: 0, layouts: 0 },
          complete: true,
        },
      },
    });
  });

  it("says this caller may count the pages now only with Design's update", async () => {
    const { source } = usageOf(NOT_WHOLE);
    const design = await readSharedStyleUsage(
      usageRequest("c-card"),
      caller(false, true),
      source
    );
    expect(design.mayCount).toBe(true);
    const lockOnly = await readSharedStyleUsage(
      usageRequest("c-card"),
      caller(true),
      source
    );
    expect(lockOnly.mayCount).toBe(false);
  });

  it("says whether the counts may still become whole", async () => {
    const counting = usageOf({ ...NOT_WHOLE, backfillPending: true }).source;
    const stuck = usageOf({ ...NOT_WHOLE, backfillPending: false }).source;
    const ask = (source: SharedStyleUsageSource) =>
      readSharedStyleUsage(usageRequest("c-card"), caller(false), source);
    // A backfill still walking: the next read may be whole.
    expect(await ask(counting)).toMatchObject({ whole: false, counting: true });
    // Content the index can never reach: floors for good, nothing to wait for.
    expect(await ask(stuck)).toMatchObject({ whole: false, counting: false });
    expect(await ask(usageOf(WHOLE).source)).toMatchObject({
      whole: true,
      counting: false,
    });
  });

  it("says the counts are floors while the index is not whole", async () => {
    const { source } = usageOf(NOT_WHOLE, {
      "c-card": [{ collection: "pages", documents: ["p1"] }],
    });
    const answer = await readSharedStyleUsage(
      usageRequest("c-card"),
      caller(false),
      source
    );
    expect(answer).toMatchObject({
      whole: false,
      mayLock: false,
      styles: { "c-card": { documents: 1, complete: false } },
    });
    // Health is read once for the screen, not per style.
    expect(source.health).toHaveBeenCalledTimes(1);
  });

  it("asks the index about a whole page of styles in one read", async () => {
    const { source, batches } = usageOf(WHOLE);
    const many = Array.from({ length: 50 }, (_, n) => `c-${n}`);
    const answer = await readSharedStyleUsage(
      usageRequest(...many),
      caller(false),
      source
    );
    expect(batches).toEqual([many]);
    expect(Object.keys(answer.styles)).toHaveLength(50);
  });

  it("answers for an id named like an object's own machinery", async () => {
    // A class id is any bounded string, so `__proto__` is one an author could
    // store; a plain object would swallow it as its prototype.
    const { source } = usageOf(
      WHOLE,
      Object.fromEntries([
        ["__proto__", [{ collection: "pages", documents: ["p1"] }]],
      ])
    );
    const answer = await readSharedStyleUsage(
      usageRequest("__proto__", "constructor"),
      caller(false),
      source
    );
    expect(Object.keys(answer.styles).sort()).toEqual([
      "__proto__",
      "constructor",
    ]);
    expect(JSON.parse(JSON.stringify(answer)).styles.__proto__).toMatchObject({
      documents: 1,
    });
  });

  it("refuses more than one page of rows, and none", async () => {
    const { source } = usageOf(WHOLE);
    const many = Array.from({ length: 51 }, (_, n) => `c-${n}`);
    for (const ids of [many, []]) {
      expect(
        await refusal(
          readSharedStyleUsage(usageRequest(...ids), caller(false), source)
        )
      ).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });
});

describe("the paths the browser asks on", () => {
  // Built by the contract and read by the routes, so the editor's reads
  // cannot drift from what the routes parse.
  it("asks the usage route about every id it names, awkward ones included", async () => {
    const ids = ["c-card", "a&b=c", "__proto__"];
    const { source, asked } = usageOf(WHOLE);
    const answer = await readSharedStyleUsage(
      new Request(`http://local${sharedStyleUsagePath(ids)}`),
      {
        self: { singles: { "site-style": "site-style" } } as never,
        caller: { can: async () => false } as never,
      },
      source
    );
    expect(asked).toEqual(ids);
    expect(Object.keys(answer.styles)).toEqual(ids);
  });

  it("asks the where-used route for one style and the page named", async () => {
    // Zero-padded, so their order by id is the order they are made in.
    const documents = Array.from(
      { length: 25 },
      (_, n) => `p${String(n).padStart(2, "0")}`
    );
    const { source } = usageOf(WHOLE, {
      "a&b": [{ collection: "pages", documents }],
    });
    const response = await readSharedStyleUses(
      new Request(`http://local${sharedStyleWhereUsedPath("a&b", 2)}`),
      source,
      async (_c, ids) => ids.map(id => ({ id, title: id })),
      NO_SINGLE
    );
    const body = (await response.json()) as {
      items: { id: string }[];
      meta: { page: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.items.map(item => item.id)).toEqual(documents.slice(20));
  });
});

describe("where a shared style is used", () => {
  const whereUsed = new Request(
    "http://local/shared-styles/where-used?id=c-card"
  );

  it("names the documents the caller may read, and counts the rest", async () => {
    const { source } = usageOf(WHOLE, {
      "c-card": [
        { collection: "pages", documents: ["p1", "p2"] },
        { collection: "secret", documents: ["s1"] },
      ],
    });
    const readNamed = vi.fn(
      async (collection: string, ids: readonly string[]) =>
        collection === "secret"
          ? null
          : ids.filter(id => id === "p1").map(id => ({ id, title: "Home" }))
    );
    const body = await (
      await readSharedStyleUses(whereUsed, source, readNamed, NO_SINGLE)
    ).json();
    expect(body).toEqual({
      items: [{ id: "p1", title: "Home", collection: "pages", kind: "pages" }],
      meta: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
        hiddenCount: 2,
      },
    });
  });

  it("names a Single the caller may read, and counts one it may not", async () => {
    const { source } = usageOf(WHOLE, {
      "c-card": [
        { collection: "home", documents: [""], single: true },
        { collection: "footer", documents: [""], single: true },
        { collection: "pages", documents: ["p1"] },
      ],
    });
    const readSingle = vi.fn(async (slug: string) =>
      slug === "home" ? "Home page" : null
    );
    const body = await (
      await readSharedStyleUses(
        whereUsed,
        source,
        async (_c, ids) => ids.map(id => ({ id, title: id })),
        readSingle
      )
    ).json();
    expect(body.items).toEqual([
      { id: "", title: "Home page", collection: "home", kind: "pages" },
      { id: "p1", title: "p1", collection: "pages", kind: "pages" },
    ]);
    expect(body.meta.hiddenCount).toBe(1);
    // CONTROL: read through the Single reader, never as a collection entry.
    expect(readSingle.mock.calls.map(([slug]) => slug).sort()).toEqual([
      "footer",
      "home",
    ]);
  });

  describe("a style used on many documents", () => {
    // Zero-padded, so their order by id is the order they are made in.
    const documents = Array.from(
      { length: 45 },
      (_, n) => `p${String(n).padStart(2, "0")}`
    );
    const named = async (_c: string, ids: readonly string[]) =>
      ids.map(id => ({ id, title: id }));
    const page = async (query: string) => {
      const { source } = usageOf(WHOLE, {
        "c-card": [{ collection: "pages", documents }],
      });
      const response = await readSharedStyleUses(
        new Request(`http://local/shared-styles/where-used?id=c-card${query}`),
        source,
        named,
        NO_SINGLE
      );
      return (await response.json()) as {
        items: { id: string }[];
        meta: Record<string, unknown>;
      };
    };

    it("names twenty on the first page, and says more remain", async () => {
      const body = await page("");
      expect(body.items.map(item => item.id)).toEqual(documents.slice(0, 20));
      expect(body.meta).toEqual({
        total: 45,
        page: 1,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
        hiddenCount: 0,
      });
    });

    it("names the next twenty on page 2", async () => {
      const body = await page("&page=2");
      expect(body.items.map(item => item.id)).toEqual(documents.slice(20, 40));
      expect(body.meta).toMatchObject({
        page: 2,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it("names the rest on the last page", async () => {
      const body = await page("&page=3");
      expect(body.items.map(item => item.id)).toEqual(documents.slice(40));
      expect(body.meta).toMatchObject({ hasNext: false, hasPrev: true });
    });

    it("refuses a page that is not a positive whole number", async () => {
      for (const query of ["&page=0", "&page=two", "&page=1.5"]) {
        expect(await refusal(page(query))).toMatchObject({
          code: "VALIDATION_ERROR",
        });
      }
    });
  });

  it("pages the same order on every request, so pages neither repeat nor drop a document", async () => {
    const pages = Array.from({ length: 14 }, (_, n) => `p${n}`);
    const posts = Array.from({ length: 13 }, (_, n) => `x${n}`);
    let calls = 0;
    // Each request lists the collections and their documents in another
    // order, as reads without an ORDER BY may.
    const source: SharedStyleUsageSource = {
      health: async () => WHOLE,
      documentsUsingEach: async ids => {
        calls += 1;
        const turn = <T>(items: readonly T[]) =>
          calls % 2 === 0 ? [...items].reverse() : [...items];
        const collections = turn([
          { collection: "pages", documents: turn(pages) },
          { collection: "posts", documents: turn(posts) },
        ]);
        return new Map(ids.map(id => [id, { collections, complete: true }]));
      },
      kindOf: () => "pages",
    };
    const named = async (_c: string, ids: readonly string[]) =>
      [...ids].reverse().map(id => ({ id, title: id }));
    const read = async (page: number) =>
      (
        (await (
          await readSharedStyleUses(
            new Request(
              `http://local/shared-styles/where-used?id=c-card&page=${page}`
            ),
            source,
            named,
            NO_SINGLE
          )
        ).json()) as { items: { collection: string; id: string }[] }
      ).items.map(item => `${item.collection}:${item.id}`);
    const seen = [...(await read(1)), ...(await read(2))];
    expect(seen).toHaveLength(27);
    expect(new Set(seen).size).toBe(27);
    expect(seen.slice(0, 2)).toEqual(["pages:p0", "pages:p1"]);
  });

  it("says the list may be short while the index is not whole", async () => {
    const { source } = usageOf(NOT_WHOLE);
    const body = (await (
      await readSharedStyleUses(whereUsed, source, async () => [], NO_SINGLE)
    ).json()) as { meta: Record<string, unknown> };
    expect(body.meta.notConsulted).toEqual(["uncounted-documents"]);
  });
});

describe("removing unused shared styles", () => {
  it("removes an unused style on a whole index, marked as the remove route's write", async () => {
    const { store, write } = storeOf([card, hero]);
    const { source } = usageOf(WHOLE);
    const response = await removeSharedStyles(
      post({ ids: ["c-card"] }),
      store,
      source,
      new Set(),
      NOT_STILL_USED
    );
    expect(write).toHaveBeenCalledWith([hero], {}, fromRead());
    expect(await response.json()).toEqual({
      message: "The shared style was removed.",
      item: { ids: ["c-card"] },
    });
  });

  it("refuses everything while the index is not whole", async () => {
    const { store, write } = storeOf([card, hero]);
    const { source } = usageOf(NOT_WHOLE);
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card"] }),
          store,
          source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. Some pages haven't been counted yet, so no shared style can be removed.",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a used, a locked and a code-defined style as a conflict naming each", async () => {
    const { store, write } = storeOf([
      card,
      { ...hero, locked: true },
      { id: "c-code", slug: "code", orderIndex: 2, styles: {} },
    ]);
    const { source } = usageOf(WHOLE, {
      "c-card": [{ collection: "pages", documents: ["p1", "p2"] }],
    });
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card", "c-hero", "c-code"] }),
          store,
          source,
          new Set(["c-code"]),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({
      // Not every reason is a use, so none carries the in-use code: the lock
      // and the code's style would read as uses otherwise.
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. hero is locked. code is defined in the site's code. Card is used on 2 documents.",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses styles all of whose reasons are uses as the in-use refusal, its one issue naming each", async () => {
    const { store, write } = storeOf([card, hero]);
    const { source } = usageOf(WHOLE, {
      "c-card": [{ collection: "pages", documents: ["p1", "p2"] }],
      "c-hero": [{ collection: "pages", documents: ["p3"] }],
    });
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card", "c-hero"] }),
          store,
          source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "",
            code: SHARED_STYLE_IN_USE_CODE,
            message:
              "Nothing was removed. Card is used on 2 documents. Hero is used on 1 document.",
          },
        ],
      },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a lock alone as a conflict, saying nothing of use", async () => {
    const { store } = storeOf([{ ...card, locked: true }]);
    const { source } = usageOf(WHOLE);
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card"] }),
          store,
          source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage: "Nothing was removed. Card is locked.",
    });
  });

  it("refuses a style whose uses could not all be counted", async () => {
    const { store, write } = storeOf([card]);
    const { source } = usageOf(WHOLE, {}, false);
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card"] }),
          store,
          source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({ code: "CONFLICT" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a style the index counts on nothing while a stored document still uses it", async () => {
    const { store, write } = storeOf([card, hero]);
    const { source } = usageOf(WHOLE);
    const asked: (readonly string[])[] = [];
    const check: StillUsedCheck = {
      uses: async ids => {
        asked.push(ids);
        return [
          { kind: "collection", slug: "pages", id: "p1" },
          { kind: "collection", slug: "pages", id: "p2" },
          { kind: "single", slug: "home", id: "", label: "Home" },
        ];
      },
      firstReadable: async () => "Home",
    };
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-card"] }),
          store,
          source,
          new Set(),
          check
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "",
            code: "IN_USE",
            message:
              "Still used on Home and 2 more. Remove it from those pages first.",
          },
        ],
      },
    });
    expect(asked).toEqual([["c-card"]]);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not walk the documents once the index has refused", async () => {
    const { store } = storeOf([card]);
    const { source } = usageOf(WHOLE, {
      "c-card": [{ collection: "pages", documents: ["p1"] }],
    });
    const uses = vi.fn<StillUsedCheck["uses"]>(async () => []);
    await refusal(
      removeSharedStyles(post({ ids: ["c-card"] }), store, source, new Set(), {
        uses,
        firstReadable: async () => undefined,
      })
    );
    expect(uses).not.toHaveBeenCalled();
  });

  it("refuses a style that is not stored", async () => {
    const { store } = storeOf([card]);
    const { source } = usageOf(WHOLE);
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-none"] }),
          store,
          source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("naming a stored use in a refusal", () => {
  const uses = [
    { kind: "collection", slug: "secret", id: "s1" },
    { kind: "collection", slug: "pages", id: "p1" },
    { kind: "collection", slug: "pages", id: "p2" },
    { kind: "single", slug: "home", id: "", label: "Home" },
  ] as const;

  it("names the first document the caller may read, read as the caller", async () => {
    const readNamed = vi.fn(
      async (collection: string, ids: readonly string[]) =>
        collection === "secret"
          ? null
          : ids.filter(id => id === "p2").map(id => ({ id, title: "About" }))
    );
    expect(await firstReadableTitle(uses, readNamed, async () => true)).toBe(
      "About"
    );
    expect(readNamed.mock.calls).toEqual([
      ["secret", ["s1"]],
      ["pages", ["p1", "p2"]],
    ]);
  });

  it("names a Single by its label only when the caller may read it", async () => {
    const none = async () => [];
    expect(await firstReadableTitle(uses, none, async () => true)).toBe("Home");
    expect(
      await firstReadableTitle(uses, none, async () => false)
    ).toBeUndefined();
  });
});

describe("the version a shared-style write sends", () => {
  // The list is written whole, so it is written from the read it was made
  // from: a save of the Single since refuses the write rather than losing a
  // shared style someone else added.
  it("hands the store the read the list was made from", async () => {
    const { store, write } = storeOf([card, hero], "4");
    await lockSharedStyle(
      post({ classId: "c-card", locked: true }),
      store,
      new Set()
    );
    expect(write.mock.calls[0]?.[2]).toEqual({
      entries: [card, hero],
      rev: "4",
    });
  });

  it("writes the Single with the version its read gave", async () => {
    const updates: Record<string, unknown>[] = [];
    const store = siteStyleClassStore(
      { self: { singles: {} }, user: null } as never,
      {
        findSingle: async () => ({ classes: [card], _rev: "4" }),
        updateSingle: async args => {
          updates.push(args.data);
          return {};
        },
      }
    );

    const read = await store.read();
    expect(read).toEqual({ entries: [card], rev: "4" });
    await store.write([card, hero], {}, read);

    expect(updates).toEqual([{ classes: [card, hero], _rev: "4" }]);
  });
});

/**
 * A store whose reads answer each list of `reads` in turn, version 1, 2, …,
 * the last one again after; a write is refused as stale while its read is
 * not the newest.
 */
function changingStoreOf(...reads: Record<string, unknown>[][]) {
  let at = 0;
  const read = vi.fn<SharedStyleStore["read"]>(async () => {
    const entries = reads[Math.min(at, reads.length - 1)] ?? [];
    at += 1;
    return { entries, rev: String(Math.min(at, reads.length)) };
  });
  const write = vi.fn<SharedStyleStore["write"]>(async (_list, _ctx, from) => {
    if (from.rev !== String(reads.length)) {
      throw NextlyError.staleVersion({
        data: { currentVersion: String(reads.length) },
      });
    }
  });
  const store: SharedStyleStore = { read, write };
  return { store, read, write };
}

describe("a shared-style write refused because the Single was saved meanwhile", () => {
  const renamedHero = { ...hero, label: "Hero 2" };

  it("locks again on the newest list, changing only the style's lock", async () => {
    const { store, write } = changingStoreOf([card, hero], [card, renamedHero]);
    const response = await lockSharedStyle(
      post({ classId: "c-card", locked: true }),
      store,
      new Set()
    );
    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toEqual([
      { ...card, locked: true },
      renamedHero,
    ]);
    expect(write.mock.calls[1]?.[2]).toMatchObject({ rev: "2" });
  });

  it("writes nothing more when the newest list already holds the lock asked", async () => {
    const { store, write } = changingStoreOf(
      [card, hero],
      [{ ...card, locked: true }, hero]
    );
    const response = await lockSharedStyle(
      post({ classId: "c-card", locked: true }),
      store,
      new Set()
    );
    expect(await response.json()).toMatchObject({
      message: "Card is locked.",
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("refuses a lock on a style removed meanwhile, as one not there", async () => {
    const { store, write } = changingStoreOf([card, hero], [hero]);
    expect(
      await refusal(
        lockSharedStyle(
          post({ classId: "c-card", locked: true }),
          store,
          new Set()
        )
      )
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("removes again from the newest list, keeping a style added meanwhile", async () => {
    const spare = { id: "c-spare", slug: "spare", orderIndex: 2, styles: {} };
    const { store, write } = changingStoreOf(
      [card, hero],
      [card, renamedHero, spare]
    );
    const usage = usageOf(WHOLE);
    const stillUsed = {
      uses: vi.fn<StillUsedCheck["uses"]>(async () => []),
      firstReadable: async () => undefined,
    };
    await removeSharedStyles(
      post({ ids: ["c-hero"] }),
      store,
      usage.source,
      new Set(),
      stillUsed
    );
    expect(write.mock.calls[1]?.[0]).toEqual([card, spare]);
    // The index and the stored documents are both asked again on the
    // retry: a page saved meanwhile may use the style the index missed.
    expect(usage.source.health).toHaveBeenCalledTimes(2);
    expect(stillUsed.uses).toHaveBeenCalledTimes(2);
  });

  it("refuses on the retry when a page saved meanwhile uses the style", async () => {
    const { store, write } = changingStoreOf([card, hero], [card, hero]);
    const usage = usageOf(WHOLE);
    const stillUsed = {
      uses: vi
        .fn<StillUsedCheck["uses"]>()
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ kind: "collection", slug: "pages", id: "p1" }]),
      firstReadable: async () => "Home",
    };
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-hero"] }),
          store,
          usage.source,
          new Set(),
          stillUsed
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: { errors: [{ code: "IN_USE" }] },
    });
    // The stale first write, and nothing after the second walk refused.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("refuses a removal when the style was locked meanwhile, writing nothing more", async () => {
    const { store, write } = changingStoreOf(
      [card, hero],
      [card, { ...hero, locked: true }]
    );
    expect(
      await refusal(
        removeSharedStyles(
          post({ ids: ["c-hero"] }),
          store,
          usageOf(WHOLE).source,
          new Set(),
          NOT_STILL_USED
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringContaining("hero is locked."),
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("answers the stale refusal once three writes in all were refused", async () => {
    const { store, write } = changingStoreOf(
      [card, hero],
      [card, hero],
      [card, hero],
      [card, hero]
    );
    expect(
      await refusal(
        lockSharedStyle(
          post({ classId: "c-card", locked: true }),
          store,
          new Set()
        )
      )
    ).toMatchObject({ code: "STALE_VERSION" });
    expect(write).toHaveBeenCalledTimes(3);
  });
});

describe("counting the pages now", () => {
  const jobsThat = (ran: boolean) => ({
    runSweepNow: vi.fn(async () => ({ ran })),
  });

  it("runs the usage backfill for a bounded time, then answers the health after", async () => {
    const jobs = jobsThat(true);
    // Read once, after the run: the answer says how far this run got.
    const health = vi.fn(async () => ({ ...NOT_WHOLE, backfillPending: true }));
    const response = await countSharedStyleUsage(jobs, { health });
    const body = (await response.json()) as {
      item: { ran: boolean; whole: boolean; counting: boolean };
    };

    expect(jobs.runSweepNow).toHaveBeenCalledWith(
      "page-builder:usage-backfill",
      { maxDurationMs: SHARED_STYLE_COUNT_MS }
    );
    expect(health).toHaveBeenCalledTimes(1);
    expect(
      jobs.runSweepNow.mock.invocationCallOrder[0] ?? Infinity
    ).toBeLessThan(health.mock.invocationCallOrder[0] ?? -Infinity);
    expect(body.item).toEqual({ ran: true, whole: false, counting: true });
  });

  it("says when every page is counted", async () => {
    const response = await countSharedStyleUsage(jobsThat(true), {
      health: async () => WHOLE,
    });
    const body = (await response.json()) as {
      message: string;
      item: { whole: boolean; counting: boolean };
    };
    expect(body.item).toMatchObject({ whole: true, counting: false });
    expect(body.message).toBe("Every page has been counted.");
  });

  it("says when another run was already counting", async () => {
    const response = await countSharedStyleUsage(jobsThat(false), {
      health: async () => ({ ...NOT_WHOLE, backfillPending: true }),
    });
    const body = (await response.json()) as { item: { ran: boolean } };
    expect(body.item.ran).toBe(false);
  });
});
