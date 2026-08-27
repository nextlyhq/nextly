/**
 * Whether maintenance runs on every write that needs it, and whether it can
 * fail a save.
 *
 * Two failures matter here and they are opposite. A write that maintenance
 * skips leaves rows disagreeing with the document, so classes the page renders
 * read as unused and become deletable. A failure that ESCAPES tells an author
 * their save failed for a document already committed to disk.
 *
 * @module class-usage-hook.test
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  registerClassUsageMaintenance,
  type ClassUsagePluginContext,
} from "./class-usage-hook";

const INDEX = "nx_pb_class_usage";

/** A document whose single node applies the given classes. */
const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/** A plugin context that records registrations, plus the handler it captured. */
function harness(
  options: {
    collection?: unknown;
    getCollection?: () => Promise<unknown>;
    draftSplit?: () => Promise<{ eligible: boolean }>;
    locales?: readonly string[];
  } = {}
) {
  const registered: string[] = [];
  const handlers: ((c: Record<string, unknown>) => unknown)[] = [];
  const errors: unknown[] = [];

  const ctx: ClassUsagePluginContext = {
    hooks: {
      on: (type, collection, handler) => {
        registered.push(`${type}:${collection}`);
        handlers.push(handler);
      },
    },
    services: {
      collections: {
        getCollection:
          options.getCollection ??
          (async () =>
            options.collection ?? {
              fields: [{ type: "blocks", name: "content" }],
            }),
      },
    },
    logger: { error: (message, meta) => errors.push({ message, meta }) },
  };

  const api = {
    // The REAL Direct API shapes. Fixtures that restate what the code assumes
    // agree with the assumption rather than with the runtime: an earlier pair
    // used the collection service's inner `{ docs, hasNextPage }` payload and a
    // bare document, and every test passed while no index row was ever found
    // and no classes were ever derived.
    find: vi.fn(async (a: { collection?: string }) =>
      a.collection !== INDEX
        ? {
            items: [{ id: "p1", content: documentUsing("hero") }],
            meta: { hasNext: false },
          }
        : { items: [], meta: { hasNext: false } }
    ),
    findByID: vi.fn(async (args: { draft?: boolean }) => ({
      id: "p1",
      title: "unrelated",
      content: documentUsing("hero"),
      ...(args.draft === true ? { _isWorkingDraft: true } : {}),
    })),
    // Both read shapes: drafts go through the detail path (the only
    // sidecar-aware one), published through the list path (the only one
    // carrying a lifecycle filter).
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };

  registerClassUsageMaintenance({
    ctx,
    indexCollection: INDEX,
    draftSplit: options.draftSplit ?? (async () => ({ eligible: false })),
    locales: () => options.locales ?? [],
    limits: () => DEFAULT_LIMITS,
  });

  const fire = (over: Record<string, unknown> = {}) =>
    handlers[0]?.({
      collection: "pages",
      data: { id: "p1" },
      req: { nextly: api },
      ...over,
    });

  /**
   * Fire the handler registered for the DELETE phase.
   *
   * Addressed by the phase it was registered under rather than by position, so
   * that adding a phase cannot silently point this at the wrong handler — which
   * would make a delete test exercise reconciliation and still pass.
   */
  const fireDelete = (over: Record<string, unknown> = {}) =>
    handlers[registered.indexOf("afterDelete:*")]?.({
      collection: "pages",
      data: { id: "p1" },
      req: { nextly: api },
      ...over,
    });

  return { registered, fire, fireDelete, api, errors };
}

describe("what maintenance is registered on", () => {
  it("registers ONE wildcard handler per after-phase, not one per collection", async () => {
    // The set of collections is not known when the plugin is wired: the Schema
    // Builder creates them at runtime and a blocks field can be added later. A
    // list captured at registration would stop covering exactly the
    // collections that were added after it.
    const { registered } = harness();

    expect(registered).toEqual([
      "afterCreate:*",
      "afterUpdate:*",
      "afterDelete:*",
    ]);
  });
});

describe("a document that was deleted", () => {
  it("removes its rows, bound on the DOCUMENT and not on a subject", async () => {
    // A delete removes the document in every language and both lifecycle
    // states at once, so every subject it owned goes with it. Binding field,
    // locale or variant would leave the rows that did not match behind, with
    // no document left to reconcile them against.
    const { fireDelete, api } = harness();
    api.find.mockImplementation(async (a: { collection?: string }) =>
      a.collection === INDEX
        ? {
            items: [
              {
                id: "r1",
                scope: "collection",
                entity: "pages",
                entityKey: "p1",
                field: "content",
                locale: "",
                variant: "published",
                classId: "hero",
              },
            ],
            meta: { hasNext: false },
          }
        : { items: [], meta: { hasNext: false } }
    );

    await fireDelete();

    expect(api.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: INDEX,
        where: {
          scope: { equals: "collection" },
          entity: { equals: "pages" },
          entityKey: { equals: "p1" },
        },
      })
    );
    expect(api.delete).toHaveBeenCalledWith(
      expect.objectContaining({ collection: INDEX, id: "r1" })
    );
  });

  it("does NOT read the collection's configuration", async () => {
    // Maintenance asks which blocks fields a collection has because it derives
    // a row per field. A delete has nothing to derive. Asking anyway would be
    // actively wrong: a blocks field REMOVED from the collection after its rows
    // were written makes the collection look untracked, and every row that
    // field owned would survive the delete for ever.
    const getCollection = vi.fn(async () => ({
      fields: [{ type: "blocks", name: "content" }],
    }));
    const { fireDelete, fire, api } = harness({ getCollection });

    await fireDelete();

    expect(getCollection).not.toHaveBeenCalled();
    // Controls, both on this harness: the delete DID run, and a SAVE on the
    // same context does read the configuration. Without them this would hold
    // for a delete handler that never ran and for a stubbed-out reader.
    expect(api.find).toHaveBeenCalled();
    await fire();
    expect(getCollection).toHaveBeenCalled();
  });

  it("SKIPS a delete inside a caller-owned transaction", async () => {
    // The hook runs before that transaction commits, and the pooled Direct API
    // cannot join it. The rebuild is what repairs a subject a write bypassed.
    const { fireDelete, api } = harness();

    // Control first, on the SAME harness: an ordinary delete does reach the
    // index. Without it this assertion would hold just as well for a handler
    // that was never registered, or one that does nothing at all.
    await fireDelete();
    expect(api.find).toHaveBeenCalled();
    api.find.mockClear();
    api.delete.mockClear();

    await fireDelete({ executor: {} });

    expect(api.find).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("SKIPS its own index collection, whose rows this deletes", async () => {
    // Every row removed here is itself a delete on the index collection, which
    // fires this same handler again.
    const { fireDelete, api } = harness();

    await fireDelete();
    expect(api.find).toHaveBeenCalled();
    api.find.mockClear();

    await fireDelete({ collection: INDEX });

    expect(api.find).not.toHaveBeenCalled();
  });

  it("SKIPS a Single, which a wildcard registration also receives", async () => {
    // Core namespaces a Single's hooks as `single:<slug>`. The index models
    // Single subjects but a plugin has no supported way to read one, so none
    // are written and there are none to forget.
    const { fireDelete, api } = harness();

    await fireDelete();
    expect(api.find).toHaveBeenCalled();
    api.find.mockClear();

    await fireDelete({ collection: "single:site-style" });

    expect(api.find).not.toHaveBeenCalled();
  });

  it("RAISES when the rows cannot be removed, so the caller is told", async () => {
    // The delete itself is already committed and cannot be rolled back. A
    // swallowed failure would report a clean deletion while the rows stay
    // behind counting towards their classes — and they name a document that no
    // longer exists, so no later write reconciles them.
    const { fireDelete, api } = harness();
    api.find.mockRejectedValue(new Error("index unreachable"));

    await expect(fireDelete()).rejects.toThrow(/could not forget/);
  });
});

describe("which writes it acts on", () => {
  it("maintains a collection that declares a blocks field", async () => {
    const { fire, api } = harness();

    await fire();

    expect(api.create).toHaveBeenCalled();
  });

  it("does nothing for a collection with no blocks field, and asks nothing", async () => {
    // The common path: the hook fires for EVERY collection. The draft-split
    // question reaches the component registry, so an untracked collection must
    // not reach it — the filter is why this is affordable at all.
    const draftSplit = vi.fn(async () => ({ eligible: false }));
    const { fire, api } = harness({
      collection: { fields: [{ type: "text", name: "title" }] },
      draftSplit,
    });

    await fire();

    expect(draftSplit).not.toHaveBeenCalled();
    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("SKIPS its own index collection, which it writes", async () => {
    // Every row this inserts is a create on that collection, which fires this
    // hook again. Without the guard the first maintained save recurses.
    const { fire, api } = harness();

    await fire({ collection: INDEX });

    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does nothing when the hook was handed no Direct API", async () => {
    const { fire, api, errors } = harness();

    await fire({ req: {} });

    expect(api.create).not.toHaveBeenCalled();
    // Absent, not broken: some paths supply none, and there is no maintenance
    // to do without one. So it must not be reported as a failure either.
    expect(errors).toEqual([]);
  });

  it("does nothing when the saved record carries no usable id", async () => {
    // The id IS the entityKey of every row. Without one there is no
    // addressable subject, so filing anything would create rows no rebuild
    // could reconcile or sweep.
    const { fire, api } = harness();

    await fire({ data: {} });

    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("the draft split it asks for", () => {
  it("enumerates BOTH variants when the collection keeps a working draft", async () => {
    const { fire, api } = harness({
      draftSplit: async () => ({ eligible: true }),
    });

    await fire();

    // Both subjects are read by id, because a lifecycle filter constrains the
    // main row and the localized companion together and drops documents that
    // are legitimately in neither state. The variants differ only in whether
    // they opt into the working-draft overlay.
    expect(api.findByID).toHaveBeenCalledTimes(2);
    expect(api.findByID.mock.calls.map(c => c[0].draft)).toEqual([
      undefined,
      true,
    ]);
    // The document is never read through the list path.
    expect(
      api.find.mock.calls.filter(c => c[0].collection === "pages")
    ).toHaveLength(0);
  });

  it("enumerates only the published variant when it does not", async () => {
    // The control on the case above. Filing rows against a draft that cannot
    // exist produces records nothing downstream can tell from real ones.
    const { fire, api } = harness({
      draftSplit: async () => ({ eligible: false }),
    });

    await fire();

    // Published only, and read WITHOUT opting into the working draft. Its row
    // is not filtered by lifecycle: this collection has status but no draft
    // split, so the single subject must be read whatever state that row is in
    // — filtering it to published indexes an unpublished document nowhere.
    expect(api.findByID).toHaveBeenCalledTimes(1);
    expect(api.findByID.mock.calls[0]?.[0].draft).toBeUndefined();
    expect(
      api.find.mock.calls.filter(c => c[0].collection === "pages")
    ).toHaveLength(0);
  });
});

describe("failure, on a write that has already committed", () => {
  // `after*` is a SIDE-EFFECT phase, and the hook registry already handles a
  // throw from one: it keeps the committed write, logs, runs the remaining
  // handlers, and records a warning the REST and Direct API responses carry
  // back. Raising is therefore how a caller learns the safety index is stale.
  //
  // Swallowing would bypass all of it — the operation would report plain
  // success, and a stale index is exactly the state in which a class a page
  // still renders reads as unused and can be deleted.

  it("RAISES when the config read fails, so the caller is told", async () => {
    const { fire } = harness({
      getCollection: async () => {
        throw new Error("registry unavailable");
      },
    });

    await expect(fire()).rejects.toThrow("registry unavailable");
  });

  it("RAISES when the draft-split question fails", async () => {
    const { fire } = harness({
      draftSplit: async () => {
        throw new Error("component registry unavailable");
      },
    });

    await expect(fire()).rejects.toThrow("component registry unavailable");
  });

  it("attempts EVERY subject before raising, and says how many failed", async () => {
    // Reconciliation is per-subject and idempotent, so stopping at the first
    // failure would leave the later subjects stale as well as the failed one.
    const { fire, api, errors } = harness({
      draftSplit: async () => ({ eligible: true }),
    });
    api.findByID.mockRejectedValueOnce(new Error("document unreadable"));

    await expect(fire()).rejects.toThrow(/1 of 2 subject\(s\)/);

    // Both subjects were read, so the second was not skipped by the first
    // failing.
    expect(api.findByID).toHaveBeenCalledTimes(2);
    // And the detail reaches the logger, which the thrown summary cannot carry.
    expect(errors).toHaveLength(1);
  });

  it("does NOT raise when every subject reconciles", async () => {
    // The control: a handler that always threw would satisfy the three cases
    // above while failing every ordinary save.
    const { fire } = harness();

    await expect(fire()).resolves.toBeUndefined();
  });
});

describe("a write inside a caller-owned transaction", () => {
  it("is SKIPPED, because the hook runs before that transaction commits", async () => {
    // Core binds `executor` onto the after-context only on the transactional
    // path (`createEntryWrite`, reached from `createEntryInTransaction`), and
    // it runs the hook while the caller's transaction is still open. The
    // pooled Direct API cannot join that transaction: on a small pool it can
    // stall on the connection the transaction holds, and otherwise it reads a
    // database that does not yet contain this write. Deriving rows from that
    // read records the document's previous classes and reports success.
    const { fire, api } = harness();

    await fire({ executor: {} });

    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("still runs when no executor is bound, which is the ordinary path", async () => {
    // The control. A guard that skipped everything would satisfy the case
    // above while disabling maintenance entirely.
    const { fire, api } = harness();

    await fire();

    expect(api.create).toHaveBeenCalled();
  });
});

describe("a Single, which a wildcard registration also receives", () => {
  it("is SKIPPED rather than looked up as a collection", async () => {
    // Core namespaces a Single's hooks as `single:<slug>`, and this plugin
    // contributes its own site-style Single — so every style save reached this
    // handler. Handing that namespace to the collection service answers
    // not-found, and since failures now raise, every Single save would be
    // reported as a maintenance failure.
    //
    // Skipped rather than adapted: a plugin has no supported way to read a
    // Single's document. The one available path CREATES the row when it is
    // absent, so reconciling Singles would materialise every Single in the app
    // as a side effect of asking about them.
    const { fire, api, errors } = harness();

    await expect(
      fire({ collection: "single:site-style" })
    ).resolves.toBeUndefined();

    expect(api.create).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("still maintains an ordinary collection whose slug merely contains a colon", async () => {
    // The control on the prefix test: matching a colon anywhere would exclude
    // collections a host is entitled to name that way.
    const { fire, api } = harness();

    await fire({ collection: "my:pages" });

    expect(api.create).toHaveBeenCalled();
  });
});
