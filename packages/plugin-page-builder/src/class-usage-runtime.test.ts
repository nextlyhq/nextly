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

/** A Direct API that records every call and answers with fixed values. */
function recordingApi(overrides: Partial<ClassUsageDirectApi> = {}) {
  const calls: Record<string, unknown>[] = [];
  const api: ClassUsageDirectApi = {
    find: async args => {
      calls.push({ op: "find", ...args });
      return { items: [{ id: "r1" }], meta: { hasNext: false } };
    },
    findByID: async args => {
      calls.push({ op: "findByID", ...args });
      // A COLLECTION ROW, which is what the Direct API answers: the block
      // document sits under the field, beside everything else the record holds.
      return {
        id: args.id,
        title: "unrelated",
        content: documentUsing("hero"),
        ...(args.draft === true ? { _isWorkingDraft: true } : {}),
      };
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
  it("asks for the WORKING DRAFT only when the subject is the draft variant", async () => {
    // The two variants are separate rows precisely because the two documents
    // can differ. Omitting the overlay for a draft subject reads the published
    // row and files its classes as the draft's; passing it for a published
    // subject does the reverse wherever a draft exists.
    const { api, calls } = recordingApi();
    const read = classUsageDocumentReader(api);

    await read(subject({ variant: "published" }));
    await read(subject({ variant: "draft" }));

    expect(calls.map(c => c.draft)).toEqual([false, true]);
  });

  it("sends NO locale for a shared field rather than the empty string", async () => {
    // A shared field stores one value every language reads, and that value is
    // what a read with no locale resolves to. Asking for the `""` locale asks
    // for a language nobody configured.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ locale: "" }));

    expect(calls[0]).not.toHaveProperty("locale");
  });

  it("sends the subject's locale when it has one", async () => {
    // The control on the case above: a reader that simply never sent a locale
    // would satisfy that assertion and file every language's rows from the
    // default locale's document.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ locale: "fr" }));

    expect(calls[0]?.locale).toBe("fr");
  });

  it("reads the stored shape, unpopulated, and treats a miss as absence", async () => {
    // `depth: 0` because the rows derive from the stored blocks JSON;
    // populating replaces ids with documents, changing the shape the
    // derivation walks. `disableErrors` turns a missing document into null,
    // which the caller reads as "leave this subject alone" — the right reading
    // for an untranslated locale or a document with no pending draft.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject());

    expect(calls[0]).toMatchObject({
      collection: "pages",
      id: "p1",
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
    });
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

describe("what the reader hands back", () => {
  it("returns the FIELD's document, not the collection row", async () => {
    // The derivation walks a top-level `nodes` array. A record has none, so
    // handing back the row derives no rows at all and every class the document
    // applies reads as unused — the state that licences deleting one a page
    // still renders. The rebuild already reads `item[field]`; this is the same
    // place, reached the same way.
    const { api } = recordingApi();

    const document = await classUsageDocumentReader(api)(
      subject({ field: "content" })
    );

    expect(document).toEqual(documentUsing("hero"));
  });

  it("returns nothing when the row has no value for that field", async () => {
    const { api } = recordingApi();

    const document = await classUsageDocumentReader(api)(
      subject({ field: "sidebar" })
    );

    expect(document).toBeUndefined();
  });

  it("REFUSES a live row answered to a draft request", async () => {
    // Asking for the draft overlay on a document with no pending draft answers
    // the live published row rather than nothing. Accepting it files the
    // published classes under a draft that does not exist — phantom references
    // no rebuild can reconcile, which block deleting a class nothing uses.
    const { api } = recordingApi({
      findByID: async () => ({ id: "p1", content: documentUsing("hero") }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "draft" })
    );

    expect(document).toBeUndefined();
  });

  it("accepts a row carrying the working-draft marker", async () => {
    // The control on the case above: a reader that refused every draft would
    // satisfy it while never indexing a draft at all.
    const { api } = recordingApi({
      findByID: async () => ({
        id: "p1",
        _isWorkingDraft: true,
        content: documentUsing("draft-only"),
      }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "draft" })
    );

    expect(document).toEqual(documentUsing("draft-only"));
  });
});
