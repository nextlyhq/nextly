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
 * What the claims do once taken is proved against a real instance on every
 * dialect by `__tests__/template-addresses-runtime.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { collectionLockKey } from "./claim-key";
import { storedKey, type Claims } from "./claim-store";
import {
  registerEntryAddressClaims,
  type EntryClaimsDeps,
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
  const claims = {
    slug: "address-claims",
    // A dialect that holds locks, so taking one is a write the stub sees.
    dialect: "postgresql",
    services: {
      ownCollections: {
        listEntries: async (
          _slug: string,
          read: { where?: Record<string, { equals?: unknown }> }
        ) =>
          read.where?.holderCollection?.equals === "gone"
            ? { data: [GONE_CLAIM], pagination: { total: 1 } }
            : { data: [], pagination: { total: 0 } },
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
    templateOf: async (collection, tx) => {
      // Read on the save's transaction, never through the pool.
      steps.push(
        `read template of ${collection}${tx === undefined ? " (pool)" : ""}`
      );
      return options.template ?? null;
    },
    storedAddresses: async () => new Map(),
    neverServed: collection => collection === "pages",
    mayHaveTemplate: async collection => {
      steps.push(`ask whether ${collection} may have a template`);
      return options.mayHaveTemplate;
    },
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
      transaction: {},
    });
  const writeTemplate = (write: Record<string, unknown>) =>
    handlers.get("templates")?.({ transaction: {}, ...write });
  return { steps, save, writeTemplate };
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
