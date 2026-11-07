/**
 * The order the entries' claims take their steps in, with the store and the
 * instance stubbed, for what a real instance cannot show without racing two
 * transactions: a save in a collection not declared in code takes the
 * collection's lock BEFORE it reads whether the collection has a template, so
 * a template being published at the same time either is seen by the save or
 * sees the entry in its own walk. A collection that may not have a template
 * takes no lock at all.
 *
 * And, over a claim store kept in memory, which entries hold an address as
 * their collection's template and their own designs are published,
 * unpublished and deleted: an entry is served while either is published,
 * and only where its collection still has an address.
 *
 * What the claims do once taken is proved against a real instance on every
 * dialect by `__tests__/template-addresses-runtime.integration.test.ts` and
 * `__tests__/entry-designs.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { collectionLockKey } from "./claim-key";
import { storedKey, type Claims } from "./claim-store";
import {
  registerEntryAddressClaims,
  type EntryClaimsDeps,
  type ServingTemplate,
} from "./entry-claims-hook";

type Handler = (write: Record<string, unknown>) => Promise<void>;

/** A claim the store holds for an entry of a collection since renamed away. */
const GONE_CLAIM = {
  id: "c1",
  claimKey: "k1",
  kind: "address",
  locale: "en",
  path: "/gone/launch",
  holderCollection: "gone",
  holderId: "e9",
};

/**
 * Every step taken, in order: a lock row written, a template read, a claim
 * deleted.
 */
function harness(options: {
  mayHaveTemplate: boolean;
  template?: { published: boolean; address: readonly string[] | null };
}) {
  const steps: string[] = [];
  const lockKey = storedKey(collectionLockKey("events"));
  const listEntries = async (
    _slug: string,
    read: { where?: Record<string, { equals?: unknown }> }
  ) =>
    read.where?.holderCollection?.equals === "gone"
      ? { data: [GONE_CLAIM], pagination: { total: 1 } }
      : { data: [], pagination: { total: 0 } };
  const claims = {
    slug: "address-claims",
    // A dialect that holds locks, so taking one is a write the stub sees.
    dialect: "postgresql",
    services: {
      ownCollections: {
        listEntries,
        // The store reads on the saving transaction, and sees the same rows.
        listEntriesInTransaction: async (
          _tx: unknown,
          slug: string,
          read: { where?: Record<string, { equals?: unknown }> }
        ) => listEntries(slug, read),
      },
      collections: {
        createEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          data: Record<string, unknown>
        ) => {
          if (data.claimKey === lockKey) steps.push("lock events");
          return { id: "lock-1", ...data };
        },
        updateEntryInTransaction: async () => ({ item: {} }),
        deleteEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          id: string
        ) => {
          steps.push(`delete ${id}`);
          return {};
        },
      },
    },
  } as unknown as Claims;
  const deps: EntryClaimsDeps = {
    claims,
    addresses: new Map(),
    templates: "templates",
    locales: () => ["en"],
    templateOf: async collection => {
      steps.push(`read template of ${collection}`);
      return options.template ?? null;
    },
    ownDesignPublished: async () => false,
    publishedDesigns: async () => new Set(),
    publishedEntry: async () => null,
    storedAddresses: async () => new Map(),
    neverServed: collection => collection === "pages",
    mayHaveTemplate: async () => options.mayHaveTemplate,
    storedAddressProblem: () => null,
    lifecycle: async () => true,
    pages: "pages",
    pagesBackfilled: () => true,
    pagesWithSlugs: async () => [],
    publishedEntries: async () => [],
    describe: () => async holder => holder.id,
  };
  const handlers = new Map<string, Handler>();
  registerEntryAddressClaims(
    {
      onInTransaction: (collection, handler) => {
        handlers.set(collection, handler as unknown as Handler);
      },
    },
    deps
  );
  const save = (collection: string) =>
    handlers.get("*")?.({
      collection,
      operation: "update",
      id: "e1",
      data: { id: "e1", slug: "launch", status: "published" },
      transaction: {},
    });
  const writeTemplate = (write: Record<string, unknown>) =>
    handlers.get("templates")?.({ transaction: {}, ...write });
  return { steps, save, writeTemplate };
}

describe("an entry's save in a collection not given an address in code", () => {
  it("takes the collection's lock before it reads whether there is a template", async () => {
    const { steps, save } = harness({ mayHaveTemplate: true });
    await save("events");
    expect(steps).toEqual(["lock events", "read template of events"]);
  });

  it("takes no lock, and reads nothing, in a collection that may not have a template", async () => {
    const { steps, save } = harness({ mayHaveTemplate: false });
    await save("events");
    expect(steps).toEqual([]);
  });

  it("locks and gives addresses up in a collection that lost the means to have a template but still has one", async () => {
    const { steps, save } = harness({
      mayHaveTemplate: false,
      template: { published: true, address: ["events"] },
    });
    await save("events");
    expect(steps).toEqual([
      "read template of events",
      "lock events",
      "read template of events",
    ]);
  });

  it("leaves the page builder's own collections alone", async () => {
    const { steps, save } = harness({ mayHaveTemplate: true });
    await save("pages");
    expect(steps).toEqual([]);
  });
});

describe("a template pointed at another collection", () => {
  it("gives up every address the old collection's entries hold", async () => {
    const { steps, writeTemplate } = harness({ mayHaveTemplate: true });
    await writeTemplate({
      operation: "update",
      id: "t1",
      originalData: {
        id: "t1",
        collection: "gone",
        status: "published",
        address: "/gone",
      },
      data: { id: "t1", collection: "events", status: "draft", address: null },
    });
    expect(steps).toContain("delete c1");
  });
});

type Row = Record<string, unknown>;

/** A read of the store's rows: each field equal to, or among, the values. */
type Where = Record<string, { equals?: unknown; in?: readonly unknown[] }>;

/**
 * A claim store kept in memory, read and written as the real one is, on a
 * dialect that takes no lock rows, so every row in it is a claim or a wait.
 */
function memoryClaims() {
  const rows: Row[] = [];
  let made = 0;
  const read = (
    pagination: { limit: number; page?: number },
    where: Where = {}
  ) => {
    const found = rows.filter(row =>
      Object.entries(where).every(([field, test]) =>
        test.in !== undefined
          ? test.in.includes(row[field])
          : test.equals === undefined || row[field] === test.equals
      )
    );
    const from = ((pagination.page ?? 1) - 1) * pagination.limit;
    return {
      data: found.slice(from, from + pagination.limit),
      pagination: { total: found.length },
    };
  };
  type Read = {
    where?: Where;
    pagination: { limit: number; page?: number };
  };
  const claims = {
    slug: "address-claims",
    dialect: "sqlite",
    services: {
      ownCollections: {
        listEntries: async (_slug: string, options: Read) =>
          read(options.pagination, options.where),
        listEntriesInTransaction: async (
          _tx: unknown,
          _slug: string,
          options: Read
        ) => read(options.pagination, options.where),
      },
      collections: {
        createEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          data: Row
        ) => {
          made += 1;
          const row = { id: `c${made}`, ...data };
          rows.push(row);
          return row;
        },
        updateEntryInTransaction: async () => ({ item: {} }),
        deleteEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          id: string
        ) => {
          const at = rows.findIndex(row => row.id === id);
          if (at >= 0) rows.splice(at, 1);
          return {};
        },
      },
    },
  } as unknown as Claims;
  /** Every address held and waited for: its kind, path and holder, sorted. */
  const held = () =>
    rows
      .map(
        row =>
          `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
      )
      .sort();
  return { claims, held };
}

/**
 * One collection's entries, its template and its entries' own designs, with
 * the hooks registered over a store in memory. `declared` gives the
 * collection `posts` the address `/blog` in code; otherwise it is `events`,
 * created at runtime and served at `/events`, stored on its template. Each
 * write runs its hook first, then stands as committed, as a write does.
 */
function designHarness(options: {
  declared: boolean;
  templatePublished?: boolean;
}) {
  const { claims, held } = memoryClaims();
  const collection = options.declared ? "posts" : "events";
  const stored = options.declared ? null : "/events";
  const state = {
    template: {
      published: options.templatePublished ?? true,
      address: options.declared ? null : ["events"],
    } as ServingTemplate | null,
    entries: new Map<string, Row>(),
    designs: new Map<string, boolean>(),
  };
  const ours = (asked: string) => asked === collection;
  const deps: EntryClaimsDeps = {
    claims,
    addresses: options.declared ? new Map([["posts", ["blog"]]]) : new Map(),
    templates: "templates",
    locales: () => ["en"],
    templateOf: async asked => (ours(asked) ? state.template : null),
    ownDesignPublished: async (asked, id) =>
      ours(asked) && state.designs.get(id) === true,
    publishedDesigns: async asked =>
      new Set(
        ours(asked)
          ? [...state.designs].filter(([, on]) => on).map(([id]) => id)
          : []
      ),
    publishedEntry: async (asked, id) => {
      const row = state.entries.get(id);
      return ours(asked) && row?.status === "published" ? row : null;
    },
    storedAddresses: async () =>
      stored === null ? new Map() : new Map([[collection, ["events"]]]),
    neverServed: asked => asked === "pages",
    mayHaveTemplate: async () => true,
    storedAddressProblem: () => null,
    lifecycle: async () => true,
    pages: "pages",
    pagesBackfilled: () => true,
    pagesWithSlugs: async () => [],
    publishedEntries: async (asked, page, size) =>
      ours(asked)
        ? [...state.entries.values()]
            .filter(row => row.status === "published")
            .slice((page - 1) * size, page * size)
        : [],
    describe: () => async holder => holder.id,
  };
  const handlers = new Map<string, Handler>();
  registerEntryAddressClaims(
    {
      onInTransaction: (slug, handler) => {
        handlers.set(slug, handler as unknown as Handler);
      },
    },
    deps
  );
  const run = async (slug: string, write: Row) => {
    const handler = handlers.get(slug);
    if (handler === undefined) throw new Error(`no hook on ${slug}`);
    await handler({ transaction: {}, ...write });
  };
  const entryHook = options.declared ? collection : "*";
  const templateRow = (status: string) => ({
    id: "t1",
    title: "Template",
    collection,
    status,
    address: stored,
  });
  const templateStatus = () =>
    state.template?.published === true ? "published" : "draft";
  const designRow = (id: string, published: boolean) => ({
    id: `d-${id}`,
    title: id,
    collection: null,
    entry: `${collection}/${id}`,
    entryCollection: collection,
    entryId: id,
    status: published ? "published" : "draft",
  });
  /** Write `id`'s own design: given, updated to `published`, or removed. */
  const design = async (
    id: string,
    operation: "create" | "update" | "delete",
    published = false
  ) => {
    const was = state.designs.get(id);
    const before = was === undefined ? undefined : designRow(id, was);
    await run("templates", {
      operation,
      id: `d-${id}`,
      data: operation === "delete" ? before : designRow(id, published),
      originalData: operation === "update" ? before : undefined,
    });
    if (operation === "delete") state.designs.delete(id);
    else state.designs.set(id, published);
  };
  return {
    held,
    /** Save the entry `id`, published, with the slug `id`. */
    save: async (id: string) => {
      const data = { id, slug: id, status: "published" };
      await run(entryHook, { collection, operation: "create", id, data });
      state.entries.set(id, data);
    },
    /** Delete the entry `id`, then its own design in the same delete. */
    deleteWithDesign: async (id: string) => {
      const data = state.entries.get(id);
      await run(entryHook, { collection, operation: "delete", id, data });
      await design(id, "delete");
      state.entries.delete(id);
    },
    unpublishTemplate: async () => {
      await run("templates", {
        operation: "update",
        id: "t1",
        data: templateRow("draft"),
        originalData: templateRow(templateStatus()),
      });
      state.template = {
        published: false,
        address: state.template?.address ?? null,
      };
    },
    deleteTemplate: async () => {
      await run("templates", {
        operation: "delete",
        id: "t1",
        data: templateRow(templateStatus()),
      });
      state.template = null;
    },
    giveDesign: (id: string, published = false) =>
      design(id, "create", published),
    publishDesign: (id: string) => design(id, "update", true),
    unpublishDesign: (id: string) => design(id, "update", false),
    removeDesign: (id: string) => design(id, "delete"),
  };
}

describe("an entry drawn with its own design", () => {
  it("keeps its address when its collection's template is unpublished, and the other entries give theirs up", async () => {
    const h = designHarness({ declared: true });
    await h.save("hello");
    await h.save("other");
    await h.giveDesign("hello", true);
    expect(h.held()).toEqual([
      "address /blog/hello posts:hello",
      "address /blog/other posts:other",
    ]);

    await h.unpublishTemplate();

    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
  });

  it("keeps its address when its collection's template is deleted, where the address is declared in code", async () => {
    const h = designHarness({ declared: true });
    await h.save("hello");
    await h.save("other");
    await h.giveDesign("hello", true);

    await h.deleteTemplate();

    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
  });

  it("keeps its address at a runtime collection's stored address when the template is unpublished", async () => {
    const h = designHarness({ declared: false });
    await h.save("hello");
    await h.save("other");
    await h.giveDesign("hello", true);

    await h.unpublishTemplate();

    expect(h.held()).toEqual(["address /events/hello events:hello"]);
  });

  it("holds nothing once a runtime collection's template is deleted, since no address is left, and later writes change nothing", async () => {
    const h = designHarness({ declared: false });
    await h.save("hello");
    await h.save("other");
    await h.giveDesign("hello", true);

    await h.deleteTemplate();
    expect(h.held()).toEqual([]);

    // Neither a save nor the design's unpublish and publish finds an
    // address to hold, and none of them fails.
    await h.save("hello");
    await h.unpublishDesign("hello");
    await h.publishDesign("hello");
    expect(h.held()).toEqual([]);
  });

  it("is claimed when its own design is published under an unpublished template, and given up when the design is unpublished or removed", async () => {
    const h = designHarness({ declared: true });
    await h.save("hello");
    await h.save("other");
    await h.unpublishTemplate();
    await h.giveDesign("hello");
    expect(h.held()).toEqual([]);

    await h.publishDesign("hello");
    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);

    await h.unpublishDesign("hello");
    expect(h.held()).toEqual([]);

    await h.publishDesign("hello");
    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
    await h.removeDesign("hello");
    expect(h.held()).toEqual([]);
  });

  it("is held when saved under an unpublished template while its own design is published, and an entry without one is not", async () => {
    const h = designHarness({ declared: true, templatePublished: false });
    await h.giveDesign("hello", true);

    await h.save("hello");
    await h.save("other");

    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
  });

  it("keeps its address when its own design is unpublished or removed while the template is published", async () => {
    const h = designHarness({ declared: true });
    await h.save("hello");
    await h.giveDesign("hello", true);

    await h.unpublishDesign("hello");
    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
    await h.removeDesign("hello");
    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);
  });

  it("is never claimed again by its design's delete when the entry itself is deleted", async () => {
    const h = designHarness({ declared: true });
    await h.save("hello");
    await h.giveDesign("hello", true);

    // The entry's delete gives its address up; the design deleted with it
    // reads the entry as still committed, and must not claim for it.
    await h.deleteWithDesign("hello");

    expect(h.held()).toEqual([]);
  });
});
