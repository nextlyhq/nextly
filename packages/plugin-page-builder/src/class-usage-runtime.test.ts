/**
 * Whether a subject resolves to the document it names, and whether the index
 * can be written at all.
 *
 * Every assertion here is a way the index gets filed against the WRONG
 * document while every layer above reports success: a draft's classes recorded
 * as the published row's, a shared field's rows filed under a language, or a
 * maintenance write refused because it asked as a user who cannot see the
 * table.
 *
 * @module class-usage-runtime.test
 */
import { describe, expect, it } from "vitest";

import type { ClassUsageSubject } from "./class-usage-reconcile";
import {
  classUsageDocumentReader,
  classUsageIndexStore,
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

  it("answers an EMPTY document for a row whose field was never written", async () => {
    // `blocksField` declares no `defaultValue`, so the column starts NULL and
    // stays that way until something saves. The row itself arrived, so this is
    // a definite reading — no classes — and it must not be reported as the
    // absence that leaves a subject's rows alone. Reported that way, every
    // document whose blocks field was never written kept whatever classes it
    // last had.
    const { api } = recordingApi({
      findByID: async () => ({ id: "p1", title: "unrelated", content: null }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "published" })
    );

    expect(document).toMatchObject({ nodes: [] });
  });

  it("answers an EMPTY document for a row that carries no such key at all", async () => {
    // The same reading for a projection that omits the field rather than
    // storing null: the row is in hand either way.
    const { api } = recordingApi({
      findByID: async () => ({ id: "p1", title: "unrelated" }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "published" })
    );

    expect(document).toMatchObject({ nodes: [] });
  });

  it("still answers NOTHING when no row came back at all", async () => {
    // The control that keeps the two apart. A withheld row is not a document
    // with no blocks, and only this case may leave the subject's rows alone.
    const { api } = recordingApi({ findByID: async () => null });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "published" })
    );

    expect(document).toBeUndefined();
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

describe("writing the index", () => {
  it("asks as the SYSTEM on every call, not as the acting user", async () => {
    // The table's access rules deny everything, and they are the only thing
    // keeping these rows private — `internal` sets `admin.hidden` and nothing
    // more. A write that respected the acting user would fail for every user,
    // so the index would simply never be maintained.
    const { api, calls } = recordingApi();
    const store = classUsageIndexStore(api);

    await store.find({
      collection: "idx",
      where: {},
      limit: 10,
      page: 1,
      sort: "id",
    });
    await store.create({ collection: "idx", data: { classId: "hero" } });
    await store.delete({ collection: "idx", id: "r1" });

    expect(calls.map(c => c.overrideAccess)).toEqual([true, true, true]);
    expect(calls.map(c => c.op)).toEqual(["find", "create", "delete"]);
  });

  it("forwards the sort and the predicates rather than dropping them", async () => {
    // These are OFFSET queries. Without the sort, successive pages have no
    // guaranteed order and a row can be skipped or returned twice — a skipped
    // row reads as a dropped reference and is deleted.
    const { api, calls } = recordingApi();

    await classUsageIndexStore(api).find({
      collection: "idx",
      where: { classId: { equals: "hero" } },
      limit: 200,
      page: 2,
      sort: "id",
    });

    expect(calls[0]).toMatchObject({
      sort: "id",
      limit: 200,
      page: 2,
      where: { classId: { equals: "hero" } },
    });
  });

  it("passes the Direct API envelope through unchanged", async () => {
    // The reconciler asks for exactly what the Direct API answers. Translating
    // between them restates one shape twice, and the statement this module
    // carried was the collection SERVICE's inner payload — which it never
    // sees, so every page came back empty and no stored row was ever found.
    const { api } = recordingApi({
      find: async () => ({
        items: [{ id: "a" }, { id: "b" }],
        meta: { hasNext: true },
      }),
    });

    const page = await classUsageIndexStore(api).find({
      collection: "idx",
      where: {},
      limit: 2,
      page: 1,
      sort: "id",
    });

    expect(page).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      meta: { hasNext: true },
    });
  });

  it("reports an empty table as an empty page, not as a failure", async () => {
    // The state every site is in before its first save.
    const { api } = recordingApi({
      find: async () => ({ items: [], meta: { hasNext: false } }),
    });

    const page = await classUsageIndexStore(api).find({
      collection: "idx",
      where: {},
      limit: 2,
      page: 1,
      sort: "id",
    });

    expect(page).toEqual({ items: [], meta: { hasNext: false } });
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
