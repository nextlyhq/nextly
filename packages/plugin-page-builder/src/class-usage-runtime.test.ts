/**
 * Whether a subject resolves to the document it names, and whether the index
 * can be written at all.
 *
 * Every assertion here is a way the index gets filed against the WRONG
 * document while every layer above reports success: a draft's classes recorded
 * as the published row's, a shared field's rows filed under a language, or a
 * Single's document created by the read that asked about it.
 *
 * @module class-usage-runtime.test
 */
import { describe, expect, it } from "vitest";

import type { ClassUsageSubject } from "./class-usage-reconcile";
import {
  classUsageDocumentReader,
  hostFieldReader,
  singleRebuildDocumentStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";

/** A document whose single node applies the given classes. */
const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/**
 * A Direct API that records every call and answers with fixed values.
 *
 * `find` serves BOTH readers now — the index store and the document reader —
 * so it answers by collection. That is a property of the real API too: the
 * reader stopped using `findByID` because that call cannot express a lifecycle
 * filter, and `status` is the only authoritative way to name a variant.
 */
function recordingApi(overrides: Partial<ClassUsageDirectApi> = {}) {
  const calls: Record<string, unknown>[] = [];
  const api: ClassUsageDirectApi = {
    // The DOCUMENT reader for both variants. It carries no lifecycle filter for
    // a trusted caller — `resolveStatusFilter` returns null when
    // `overrideAccess` is set and no status is named — so it answers the row
    // that exists whatever state that row is in. Only `draft` differs between
    // the two subjects, and it selects the working-draft overlay.
    findByID: async args => {
      calls.push({ op: "findByID", ...args });
      return {
        id: "p1",
        title: "unrelated",
        content: documentUsing("hero"),
        ...(args.draft === true ? { _isWorkingDraft: true } : {}),
      };
    },
    // Serves the INDEX store only. The document reader stopped using it: an
    // explicit `status` is a conjunction over the main row and the localized
    // companion together, which drops documents legitimately in neither state.
    find: async args => {
      calls.push({ op: "find", ...args });
      return { items: [{ id: "r1" }], meta: { hasNext: false } };
    },
    create: async args => {
      calls.push({ op: "create", ...args });
      return {};
    },
    delete: async args => {
      calls.push({ op: "delete", ...args });
      return {};
    },
    findSingle: async args => {
      calls.push({ op: "findSingle", ...args });
      return {
        id: "s1",
        content: documentUsing("hero"),
        ...(args.draft === true ? { _isWorkingDraft: true } : {}),
      };
    },
    ...overrides,
  };
  return { api, calls };
}

/** What the derivation needs to see: a document with a top-level `nodes` array. */
const subject = (over: Partial<ClassUsageSubject> = {}): ClassUsageSubject => ({
  scope: "collection",
  entity: "pages",
  entityKey: "p1",
  field: "content",
  locale: "",
  variant: "published",
  ...over,
});

describe("resolving a subject to its document", () => {
  it("reads a DRAFT through the detail path, which is the only sidecar-aware one", async () => {
    // An already-published document keeps its main row at `published` and its
    // pending edits in a sidecar. The list read filters the main table, so it
    // returns nothing for such a document — and reading that as the draft's
    // content records a pending draft as applying no classes at all. The
    // overlay exists only on the by-id path.
    const { api, calls } = recordingApi();

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "draft" })
    );

    expect(calls[0]).toMatchObject({ op: "findByID", draft: true });
    // The POSITIVE control, and the half that matters. Asserting only the call
    // leaves an implementation that makes it and then answers nothing passing:
    // every working draft would go unindexed, and a class used only by pending
    // edits would pass the safe-delete check.
    expect(document).toEqual(documentUsing("hero"));
  });

  it("reads PUBLISHED with NO lifecycle filter, and does not opt into the draft", async () => {
    // `status: "published"` is a conjunction: listEntries constrains the main
    // row AND hands the same value to the localized companion's `_status`
    // (collection-query-service.ts:1143-1159). A translation unpublished under
    // a published default matches neither state, and a collection whose draft
    // split is ineligible enumerates only this subject — so filtering it drops
    // the document's only row and indexes it nowhere.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ variant: "published" }));

    expect(calls[0]).toMatchObject({ op: "findByID", id: "p1" });
    expect(calls[0]).not.toHaveProperty("status");
    expect(calls[0].draft).toBeUndefined();
  });

  it("REFUSES a live row answered to a draft request", async () => {
    // `draft: true` falls back to the live row when no pending draft exists.
    // Accepting it files the published classes under a draft that is not there.
    // The fixture carries the status a live row really has, so that refusing it
    // has to be a decision about `published` rather than about a missing key.
    const { api } = recordingApi({
      findByID: async () => ({
        id: "p1",
        status: "published",
        content: documentUsing("hero"),
      }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "draft" })
    );

    expect(document).toBeUndefined();
  });

  it("records a NEVER-PUBLISHED document under its published subject", async () => {
    // Its only row IS a draft, and no sidecar exists so nothing marks it. The
    // published read carries no lifecycle filter, so it answers that row rather
    // than excluding it — which is where a page still being written gets
    // indexed at all. Filtering would leave a class used only there recorded
    // nowhere, and safe-delete would report no usage for it.
    const { api } = recordingApi({
      findByID: async () => ({
        id: "p1",
        status: "draft",
        content: documentUsing("hero"),
      }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "published" })
    );

    expect(document).toEqual(documentUsing("hero"));
  });

  it("records a LOCALE unpublished while the default stays published", async () => {
    // Unpublishing a non-default translation moves the companion's `_status` to
    // draft and deliberately LEAVES the main row published
    // (domains/i18n/writes-status.integration.test.ts:157). An explicit status
    // matches neither state for that language, so the by-id read is what can
    // still answer for it — and it is asked in the subject's own locale.
    // The recording default answers a row whose MAIN status is published,
    // which is exactly this document's state — the German companion is the
    // part that is draft, and no status is sent at all.
    const { api, calls } = recordingApi();

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "published", locale: "de" })
    );

    expect(document).toEqual(documentUsing("hero"));
    expect(calls[0]).toMatchObject({
      op: "findByID",
      locale: "de",
      fallbackLocale: false,
    });
    expect(calls[0]).not.toHaveProperty("status");
  });

  it("REFUSES a document that does not identify as the subject's", async () => {
    // Neither end of the read can be trusted alone. `beforeOperation` may
    // rewrite the queried id and the service builds its predicate from the
    // rewritten one (collection-query-service.ts:757), so asking about a
    // document is not being answered about it. `afterRead` may rewrite or drop
    // `id` for reasons unrelated to which row was read. A differing id is
    // therefore either a legitimate reshape or another document, and nothing
    // available here tells them apart.
    //
    // Reconciling an unconfirmed document files ITS classes here and removes
    // the rows the real one earned, so a class the real document still renders
    // reads as unused and becomes deletable. Refusing costs a maintenance pass
    // and leaves the rows alone. Only one of those is recoverable.
    const { api } = recordingApi({
      findByID: async () => ({
        id: "some-other-page",
        content: documentUsing("intruder"),
      }),
    });

    await expect(
      classUsageDocumentReader(api)(subject({ variant: "published" }))
    ).rejects.toThrow(/some-other-page/);
  });

  it("REFUSES a document an afterRead hook stripped the id from", async () => {
    // The same undecidability with nothing to compare at all: a stripped id
    // cannot confirm the read reached this subject, so it cannot licence
    // removing this subject's rows either.
    const { api } = recordingApi({
      findByID: async () => ({ content: documentUsing("hero") }),
    });

    await expect(
      classUsageDocumentReader(api)(subject({ variant: "published" }))
    ).rejects.toThrow(/cannot be confirmed|identifying as/);
  });

  it("sends NO locale for a shared field rather than the empty string", async () => {
    // A shared field stores one value every language reads, and that value is
    // what a read with no locale resolves to.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ locale: "" }));

    expect(calls[0]).not.toHaveProperty("locale");
  });

  it("turns FALLBACK OFF for a real locale, and asks for that locale", async () => {
    // Fallback is on by default, so a locale with no translation resolves the
    // field from its fallback chain. Filing that document's classes under this
    // subject gives a translation that does not exist rows of its own, and the
    // per-locale model the reconciler and the rebuild share stops being true.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ locale: "fr" }));

    expect(calls[0]).toMatchObject({ locale: "fr", fallbackLocale: false });
  });

  it("reads the stored shape, unpopulated, as the system", async () => {
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject());

    expect(calls[0]).toMatchObject({
      op: "findByID",
      collection: "pages",
      id: "p1",
      depth: 0,
      overrideAccess: true,
    });
    // Never suppressed: `disableErrors` converts EVERY unsuccessful result to
    // null, so a failing read would be indistinguishable from an absent row.
    expect(calls[0].disableErrors).toBeUndefined();
  });

  it("returns the FIELD's document, not the collection row", async () => {
    // The derivation walks a top-level `nodes` array. A record has none, so
    // handing back the row derives no rows at all and every class the document
    // applies reads as unused.
    const { api } = recordingApi();

    const document = await classUsageDocumentReader(api)(
      subject({ field: "content" })
    );

    expect(document).toEqual(documentUsing("hero"));
  });

  it("answers nothing when the published row is absent", async () => {
    const { api } = recordingApi({
      findByID: async () => null,
    });

    const document = await classUsageDocumentReader(api)(subject());

    expect(document).toBeUndefined();
  });

  it("does NOT swallow a read failure", async () => {
    // `disableErrors` returned null for EVERY unsuccessful result, not only a
    // missing row — so a failing `afterRead` hook read as ordinary absence and
    // the subject was reconciled to zero against a document nobody could read.
    const { api } = recordingApi({
      findByID: async () => {
        throw new Error("afterRead hook failed");
      },
    });

    await expect(classUsageDocumentReader(api)(subject())).rejects.toThrow(
      "afterRead hook failed"
    );
  });
});

describe("resolving a Single's subject to its document", () => {
  const single = (over: Partial<ClassUsageSubject> = {}) =>
    subject({ scope: "single", entity: "home", entityKey: "", ...over });

  it("reads it by slug, as the system, WITHOUT creating it, and an unsaved one as its default", async () => {
    // Any other read of a Single writes its default document when it has
    // none, which would materialise every Single in the app as a side effect
    // of indexing it. An unsaved Single is read as the default its first read
    // will store, so what that default places is counted before it is stored.
    const { api, calls } = recordingApi();

    expect(await classUsageDocumentReader(api)(single())).toEqual(
      documentUsing("hero")
    );
    expect(calls).toEqual([
      {
        op: "findSingle",
        slug: "home",
        createIfMissing: false,
        whenAbsent: "default",
        status: "all",
        depth: 0,
        overrideAccess: true,
      },
    ]);
  });

  it("opts into the working draft for its draft, and declines a live row answered to it", async () => {
    const { api, calls } = recordingApi();
    await classUsageDocumentReader(api)(single({ variant: "draft" }));
    expect(calls[0]).toMatchObject({ op: "findSingle", draft: true });

    const { api: live } = recordingApi({
      findSingle: async () => ({ id: "s1", content: documentUsing("hero") }),
    });
    expect(
      await classUsageDocumentReader(live)(single({ variant: "draft" }))
    ).toBeUndefined();
  });

  it("asks for a real locale with FALLBACK OFF", async () => {
    const { api, calls } = recordingApi();
    await classUsageDocumentReader(api)(single({ locale: "fr" }));
    expect(calls[0]).toMatchObject({ locale: "fr", fallbackLocale: false });
  });

  it("answers nothing for a Single nobody has saved", async () => {
    const { api } = recordingApi({ findSingle: async () => null });
    expect(await classUsageDocumentReader(api)(single())).toBeUndefined();
  });

  it("is walked by a rebuild as its one document, once", async () => {
    const { api } = recordingApi();
    const store = singleRebuildDocumentStore(api);
    const at = {
      collection: "home",
      limit: 100,
      sort: "id",
      locale: "",
      variant: "published",
    } as const;

    expect((await store.find({ ...at, page: 1 })).items).toHaveLength(1);
    // A walk resuming after its cursor has already repaired it.
    expect(
      (await store.find({ ...at, page: 1, after: "s1" })).items
    ).toHaveLength(0);
    expect(
      await store.exists({
        collection: "home",
        id: "",
        locale: "",
        variant: "published",
      })
    ).toBe(true);
  });
});

describe("reading a host's field, as the variant count does", () => {
  it("reads a Single by its slug, without creating it, and an entry by its id", async () => {
    const { api, calls } = recordingApi();
    const read = hostFieldReader(api);

    expect(
      await read(
        { slug: "home", id: "", field: "content", single: true },
        "published"
      )
    ).toEqual(documentUsing("hero"));
    expect(calls).toEqual([
      expect.objectContaining({
        op: "findSingle",
        slug: "home",
        createIfMissing: false,
      }),
    ]);

    // CONTROL: a collection entry is read by its id.
    calls.length = 0;
    await read({ slug: "pages", id: "p1", field: "content" }, "published");
    expect(calls).toEqual([
      expect.objectContaining({
        op: "findByID",
        collection: "pages",
        id: "p1",
      }),
    ]);
  });
});

describe("a failure on the DRAFT read", () => {
  it("does not ASK the API to suppress errors", async () => {
    // Asserted on the argument, not on a thrown error, and that distinction is
    // the point. `disableErrors` is honoured inside the Direct API — it
    // converts every unsuccessful result to null, not only a missing row — so
    // a fake that simply throws propagates whether or not the flag is set, and
    // a test written that way passes with the defect present.
    //
    // What this module controls is whether it asks for the suppression, so
    // that is what is asserted. Setting it would make a failing `afterRead`
    // hook read as "this document has no pending draft": the subject is left
    // alone, the caller is told nothing, and a class the saved draft added
    // still passes the safe-delete check.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ variant: "draft" }));

    expect(calls[0]).not.toHaveProperty("disableErrors");
  });

  it("does not ask for it on the PUBLISHED read either", async () => {
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ variant: "published" }));

    expect(calls[0]).not.toHaveProperty("disableErrors");
  });

  it("propagates a read failure to the caller", async () => {
    // Separate from the flag: whatever the API raises must reach the caller
    // rather than being caught here.
    const { api } = recordingApi({
      findByID: async () => {
        throw new Error("afterRead hook failed");
      },
    });

    await expect(
      classUsageDocumentReader(api)(subject({ variant: "draft" }))
    ).rejects.toThrow("afterRead hook failed");
  });

  it("still reads a live row as NO draft, which is a success and not a failure", async () => {
    // The control. A document with no pending draft is a successful read of
    // the live row, refused by the marker — so dropping the suppression cannot
    // turn an ordinary state into a reported failure.
    const { api } = recordingApi({
      findByID: async () => ({ id: "p1", content: documentUsing("hero") }),
    });

    await expect(
      classUsageDocumentReader(api)(subject({ variant: "draft" }))
    ).resolves.toBeUndefined();
  });
});
