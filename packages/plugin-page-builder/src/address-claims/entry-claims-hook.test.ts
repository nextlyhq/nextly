/**
 * The order the entries' claims take their steps in, with the store and the
 * instance stubbed, for what a real instance cannot show without racing two
 * transactions: a save in a collection not declared in code reads its
 * template on the save's own transaction, holding the template's row before
 * it takes the collection's lock, the order a template's own write takes
 * them in, and reads it again under the lock when there was none, so a
 * template published or created meanwhile either is seen by the save or sees
 * the entry in its own walk. An entry with no slug in a collection with no
 * template takes no lock at all, and no save asks the registry.
 *
 * And, over a claim store kept in memory, which entries hold an address as
 * their collection's template and their own designs are published,
 * unpublished and deleted: an entry is served while it is published and
 * either is, and only where its collection still has an address and may
 * still have a template; and a template unpublished over many own designs
 * reads their entries in batches.
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
  /**
   * The template each read answers with, in order, in place of `template`:
   * a template created or published between the save's first read and its
   * second appears only on the second.
   */
  reads?: readonly ({
    published: boolean;
    address: readonly string[] | null;
  } | null)[];
}) {
  const steps: string[] = [];
  // The transaction each lifecycle read was asked on.
  const lifecycleReads: { collection: string; tx: unknown }[] = [];
  let read = 0;
  // The claims the store holds: one for an entry of a collection renamed away.
  const storedClaims = (read: {
    where?: Record<string, { equals?: unknown }>;
  }) =>
    read.where?.holderCollection?.equals === "gone"
      ? { data: [GONE_CLAIM], pagination: { total: 1 } }
      : { data: [], pagination: { total: 0 } };
  const lockKey = storedKey(collectionLockKey("events"));
  const claims = {
    slug: "address-claims",
    // A dialect that holds locks, so taking one is a write the stub sees.
    dialect: "postgresql",
    services: {
      ownCollections: {
        listEntries: async (
          _slug: string,
          read: { where?: Record<string, { equals?: unknown }> }
        ) => storedClaims(read),
        // The store reads its claims on the save's transaction.
        listEntriesInTransaction: async (
          _tx: unknown,
          _slug: string,
          read: { where?: Record<string, { equals?: unknown }> }
        ) => storedClaims(read),
      },
      collections: {
        createEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          data: Record<string, unknown>
        ) => {
          if (data.claimKey === lockKey) steps.push("lock events");
          // An address claimed for an entry, so a test sees what the save
          // took, not only the reads it made.
          else if (data.kind === "address") steps.push(`claim ${data.path}`);
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
    templateOf: async (collection, tx) => {
      // Read on the save's transaction, never through the pool.
      steps.push(
        `read template of ${collection}${tx === undefined ? " (pool)" : ""}`
      );
      const answer =
        options.reads === undefined
          ? (options.template ?? null)
          : (options.reads[read] ?? null);
      read += 1;
      return answer;
    },
    ownDesignPublished: async () => false,
    publishedDesigns: async () => new Set(),
    entriesWithIds: async (_collection, _ids, tx) => {
      if (tx === undefined) throw new Error("entries read off the write");
      return [];
    },
    storedAddresses: async () => new Map(),
    neverServed: collection => collection === "pages",
    mayHaveTemplate: async collection => {
      steps.push(`ask whether ${collection} may have a template`);
      return options.mayHaveTemplate;
    },
    storedAddressProblem: () => null,
    lifecycle: async (collection, tx) => {
      lifecycleReads.push({ collection, tx });
      return true;
    },
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
  // The transaction every write below runs in, so a read can be told
  // apart as one made on it.
  const transaction = {};
  const save = (
    collection: string,
    data: Record<string, unknown> = {
      id: "e1",
      slug: "launch",
      status: "published",
    }
  ) =>
    handlers.get("*")?.({
      collection,
      operation: "update",
      id: "e1",
      data,
      transaction,
    });
  const writeTemplate = (write: Record<string, unknown>) =>
    handlers.get("templates")?.({ transaction, ...write });
  return { steps, lifecycleReads, transaction, save, writeTemplate };
}

describe("an entry's save in a collection not given an address in code", () => {
  it("reads the template on the save's transaction, then takes the collection's lock, and reads it again when there was none", async () => {
    const { steps, save } = harness({ mayHaveTemplate: true });
    await save("events");
    expect(steps).toEqual([
      "read template of events",
      "lock events",
      "read template of events",
    ]);
  });

  it("claims the entry's address from a template that appears only on the read under the lock", async () => {
    const { steps, save } = harness({
      mayHaveTemplate: true,
      reads: [null, { published: true, address: ["events"] }],
    });
    await save("events");
    expect(steps).toEqual([
      "read template of events",
      "lock events",
      "read template of events",
      "claim /events/launch",
    ]);
  });

  it("asks whether the collection has a Draft/Published lifecycle on the save's transaction", async () => {
    const { steps, lifecycleReads, transaction, save } = harness({
      mayHaveTemplate: true,
      template: { published: true, address: ["events"] },
    });
    await save("events");
    expect(steps).toContain("claim /events/launch");
    expect(lifecycleReads).toEqual([{ collection: "events", tx: transaction }]);
  });

  it("holds an existing template's row before the collection's lock, as a template's own write does", async () => {
    const { steps, save } = harness({
      mayHaveTemplate: true,
      template: { published: false, address: ["events"] },
    });
    await save("events");
    expect(steps).toEqual(["read template of events", "lock events"]);
  });

  it("takes no lock for an entry with no slug in a collection with no template", async () => {
    const { steps, save } = harness({ mayHaveTemplate: true });
    await save("users", { id: "u1", email: "a@example.com" });
    expect(steps).toEqual(["read template of users"]);
  });

  it("gives addresses up, asking the registry nothing, where entries lost their slug", async () => {
    const { steps, save } = harness({
      mayHaveTemplate: false,
      template: { published: true, address: ["events"] },
    });
    await save("events", { id: "e1", title: "No slug", status: "published" });
    expect(steps).toEqual(["read template of events", "lock events"]);
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

describe("a template's publish", () => {
  it("asks whether its collection has a Draft/Published lifecycle on the publish's transaction", async () => {
    const { lifecycleReads, transaction, writeTemplate } = harness({
      mayHaveTemplate: true,
    });
    await writeTemplate({
      operation: "update",
      id: "t1",
      originalData: {
        id: "t1",
        collection: "events",
        status: "draft",
        address: "/events",
      },
      data: {
        id: "t1",
        collection: "events",
        status: "published",
        address: "/events",
      },
    });
    expect(lifecycleReads).toEqual([{ collection: "events", tx: transaction }]);
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
  /** The ids each read of entries by id asked for, in order. */
  const entryReads: string[][] = [];
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
    // Whether the collection may still have a template: false once it is
    // made localized, or loses its `slug` field.
    eligible: true,
  };
  const ours = (asked: string) => asked === collection;
  const deps: EntryClaimsDeps = {
    claims,
    addresses: options.declared ? new Map([["posts", ["blog"]]]) : new Map(),
    templates: "templates",
    locales: () => ["en"],
    templateOf: async asked => (ours(asked) ? state.template : null),
    ownDesignPublished: async (asked, id, tx) => {
      // Asked inside a write, so always on its transaction.
      if (tx === undefined) throw new Error("design read off the write");
      return ours(asked) && state.designs.get(id) === true;
    },
    publishedDesigns: async (asked, tx) => {
      if (tx === undefined) throw new Error("designs read off the write");
      return new Set(
        ours(asked)
          ? [...state.designs].filter(([, on]) => on).map(([id]) => id)
          : []
      );
    },
    entriesWithIds: async (asked, ids, tx) => {
      // Asked inside a write, so always on its transaction.
      if (tx === undefined) throw new Error("entries read off the write");
      entryReads.push([...ids]);
      return ours(asked)
        ? ids.flatMap(id => {
            const row = state.entries.get(id);
            return row === undefined ? [] : [row];
          })
        : [];
    },
    storedAddresses: async () =>
      stored === null ? new Map() : new Map([[collection, ["events"]]]),
    neverServed: asked => asked === "pages",
    mayHaveTemplate: async (_asked, tx) => {
      // Asked inside a write, so always on its transaction.
      if (tx === undefined) throw new Error("registry read off the write");
      return state.eligible;
    },
    storedAddressProblem: () => null,
    lifecycle: async (_asked, tx) => {
      // Every write here runs on a transaction, and every lifecycle read
      // is asked on it.
      if (tx === undefined) throw new Error("lifecycle read off the write");
      return true;
    },
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
    entryReads,
    /** Make the collection one that may, or may no longer, have a template. */
    setEligible: (eligible: boolean) => {
      state.eligible = eligible;
    },
    /** Save the entry `id`, published unless said, with the slug `id`. */
    save: async (id: string, status: "published" | "draft" = "published") => {
      const data = { id, slug: id, status };
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

  it("is not served while the entry itself is a draft, though its own design is published", async () => {
    const h = designHarness({ declared: true, templatePublished: false });
    await h.save("hello", "draft");

    // The design's publish finds no published entry to claim for.
    await h.giveDesign("hello", true);
    expect(h.held()).toEqual([]);

    await h.save("hello");
    expect(h.held()).toEqual(["address /blog/hello posts:hello"]);

    // Back to a draft, the entry gives its address up, design or not.
    await h.save("hello", "draft");
    expect(h.held()).toEqual([]);
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

describe("a template with many entries drawn with their own designs", () => {
  it("reads those entries in batches when it is unpublished, never one read per entry", async () => {
    const h = designHarness({ declared: true });
    const ids = Array.from(
      { length: 250 },
      (_, at) => `e${String(at).padStart(3, "0")}`
    );
    for (const id of ids) {
      await h.save(id);
      // Under the published template, a design's publish changes no claim
      // and reads no entry.
      await h.giveDesign(id, true);
    }
    expect(h.entryReads).toEqual([]);

    await h.unpublishTemplate();

    // Every entry is still served, by its own design.
    expect(h.held()).toHaveLength(250);
    expect(h.held()).toContain("address /blog/e249 posts:e249");
    // Three reads, each of at most a hundred ids, covering every entry
    // once: one read per entry would be 250 reads of one.
    expect(h.entryReads.map(read => read.length)).toEqual([100, 100, 50]);
    expect(h.entryReads.flat().sort()).toEqual(ids);
  });
});

describe("an entry drawn with its own design in a collection that may no longer have a template", () => {
  it("is not claimed when its design is published, and is once the collection may have a template again (the control)", async () => {
    const h = designHarness({ declared: false, templatePublished: false });
    await h.save("hello");
    await h.giveDesign("hello");
    // Made localized: its template and stored address remain.
    h.setEligible(false);

    await h.publishDesign("hello");
    expect(h.held()).toEqual([]);

    // CONTROL: the same publish, with the collection eligible again,
    // claims the address, so the gate is what held it back.
    await h.unpublishDesign("hello");
    h.setEligible(true);
    await h.publishDesign("hello");
    expect(h.held()).toEqual(["address /events/hello events:hello"]);
  });

  it("gives its address up when its design is unpublished, and does not claim it back when the design is published again", async () => {
    const h = designHarness({ declared: false, templatePublished: false });
    await h.save("hello");
    await h.giveDesign("hello", true);
    expect(h.held()).toEqual(["address /events/hello events:hello"]);

    h.setEligible(false);
    await h.unpublishDesign("hello");
    await h.publishDesign("hello");

    expect(h.held()).toEqual([]);
  });

  it("is not claimed by its own save under an unpublished template, and is once the collection may have a template again (the control)", async () => {
    const h = designHarness({ declared: false, templatePublished: false });
    await h.giveDesign("hello", true);
    h.setEligible(false);

    await h.save("hello");
    expect(h.held()).toEqual([]);

    // CONTROL: the same save, with the collection eligible again, holds
    // the address its own design serves it at.
    h.setEligible(true);
    await h.save("hello");
    expect(h.held()).toEqual(["address /events/hello events:hello"]);
  });

  it("keeps nothing when the collection's template is unpublished, own design or not", async () => {
    const h = designHarness({ declared: false });
    await h.save("hello");
    await h.save("other");
    await h.giveDesign("hello", true);
    h.setEligible(false);

    await h.unpublishTemplate();

    // Where the collection may still have a template, the entry with a
    // published own design keeps its address (see "keeps its address at a
    // runtime collection's stored address when the template is
    // unpublished" above).
    expect(h.held()).toEqual([]);
  });
});
