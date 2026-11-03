/**
 * The shared styles' routes, against fakes of the store and the usage index:
 * who each asks, what each writes, and what each refuses.
 */
import { describe, expect, it, vi } from "vitest";

import type { SharedStyleUsageKind } from "./library-contract";
import { pageBuilder } from "./plugin";
import {
  LOCK_SHARED_STYLES_PERMISSION,
  lockSharedStyle,
  readSharedStyleUsage,
  readSharedStyleUses,
  removeSharedStyles,
  sharedStyleRoutes,
  type SharedStyleStore,
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

function storeOf(classes: Record<string, unknown>[]) {
  const write = vi.fn<SharedStyleStore["write"]>(async () => undefined);
  const store: SharedStyleStore = { read: async () => classes, write };
  return { store, write };
}

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
  const source: SharedStyleUsageSource = {
    health: vi.fn(async () => health),
    documentsUsing: async id => {
      asked.push(id);
      return {
        collections: uses[id] ?? [],
        complete: complete && health.coversExistingDocuments,
      };
    },
    kindOf: collection => KINDS[collection] ?? "pages",
  };
  return { source, asked };
}

const post = (body: unknown) =>
  new Request("http://local/shared-styles", {
    method: "POST",
    body: JSON.stringify(body),
  });

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

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

  it("gates each route on its own permission", () => {
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
        typeof route.requiredPermission === "string"
          ? route.requiredPermission
          : route.requiredPermission(scope),
      ])
    ).toEqual([
      ["POST", "/shared-styles/lock", "lock-page-builder-shared-styles"],
      ["GET", "/shared-styles/usage", "read-renamed_site-style"],
      ["GET", "/shared-styles/where-used", "read-renamed_site-style"],
      ["POST", "/shared-styles/remove", "update-renamed_site-style"],
    ]);
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
      SHARED_STYLE_LOCK_WRITE_CONTEXT
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
      SHARED_STYLE_LOCK_WRITE_CONTEXT
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
  const caller = (lock: boolean) => ({
    caller: {
      can: vi.fn(async (action: string, resource: string) =>
        lock ? `${action}-${resource}` === LOCK_SHARED_STYLES_PERMISSION : false
      ),
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
      mayLock: true,
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
      await readSharedStyleUses(whereUsed, source, readNamed)
    ).json();
    expect(body).toEqual({
      items: [{ id: "p1", title: "Home", collection: "pages", kind: "pages" }],
      meta: {
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
        hiddenCount: 2,
      },
    });
  });

  it("names at most twenty, and says more remain", async () => {
    const documents = Array.from({ length: 300 }, (_, n) => `p${n}`);
    const { source } = usageOf(WHOLE, {
      "c-card": [{ collection: "pages", documents }],
    });
    const readNamed = vi.fn(async (_c: string, ids: readonly string[]) =>
      ids.map(id => ({ id, title: id }))
    );
    const body = (await (
      await readSharedStyleUses(whereUsed, source, readNamed)
    ).json()) as { items: unknown[]; meta: Record<string, unknown> };
    expect(body.items).toHaveLength(20);
    expect(body.meta).toMatchObject({
      total: 300,
      hasNext: true,
      hiddenCount: 0,
    });
    // Reading stopped once the list was full: one batch, not three.
    expect(readNamed).toHaveBeenCalledTimes(1);
  });

  it("says the list may be short while the index is not whole", async () => {
    const { source } = usageOf(NOT_WHOLE);
    const body = (await (
      await readSharedStyleUses(whereUsed, source, async () => [])
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
      new Set()
    );
    expect(write).toHaveBeenCalledWith([hero], {});
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
        removeSharedStyles(post({ ids: ["c-card"] }), store, source, new Set())
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. Some pages are still being counted, so no shared style can be removed yet.",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a used, a locked and a code-defined style, naming each", async () => {
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
          new Set(["c-code"])
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. hero is locked. code is defined in the site's code. Card is used on 2 documents.",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a style whose uses could not all be counted", async () => {
    const { store, write } = storeOf([card]);
    const { source } = usageOf(WHOLE, {}, false);
    expect(
      await refusal(
        removeSharedStyles(post({ ids: ["c-card"] }), store, source, new Set())
      )
    ).toMatchObject({ code: "CONFLICT" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a style that is not stored", async () => {
    const { store } = storeOf([card]);
    const { source } = usageOf(WHOLE);
    expect(
      await refusal(
        removeSharedStyles(post({ ids: ["c-none"] }), store, source, new Set())
      )
    ).toMatchObject({ code: "NOT_FOUND" });
  });
});
