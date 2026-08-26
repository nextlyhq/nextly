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
    findByID: async args => {
      calls.push({ op: "findByID", ...args });
      return {
        id: "p1",
        _isWorkingDraft: true,
        content: documentUsing("hero"),
      };
    },
    find: async args => {
      calls.push({ op: "find", ...args });
      if (args.collection === "idx") {
        return { items: [{ id: "r1" }], meta: { hasNext: false } };
      }
      // A COLLECTION ROW, which is what the API answers: the block document
      // sits under the field, beside everything else the record holds.
      return {
        items: [
          { id: "p1", title: "unrelated", content: documentUsing("hero") },
        ],
        meta: { hasNext: false },
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
  it("reads a DRAFT through the detail path, which is the only sidecar-aware one", async () => {
    // An already-published document keeps its main row at `published` and its
    // pending edits in a sidecar. The list read filters the main table, so it
    // returns nothing for such a document — and reading that as the draft's
    // content records a pending draft as applying no classes at all. The
    // overlay exists only on the by-id path.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ variant: "draft" }));

    expect(calls[0]).toMatchObject({ op: "findByID", draft: true });
  });

  it("reads PUBLISHED through the lifecycle filter, which only the list read carries", async () => {
    // The by-id path has no lifecycle parameter, so a published subject read
    // that way would accept a document whose only row is a draft.
    const { api, calls } = recordingApi();

    await classUsageDocumentReader(api)(subject({ variant: "published" }));

    expect(calls[0]).toMatchObject({ op: "find", status: "published" });
  });

  it("REFUSES a live row answered to a draft request", async () => {
    // `draft: true` falls back to the live row when no pending draft exists.
    // Accepting it files the published classes under a draft that is not there.
    const { api } = recordingApi({
      findByID: async () => ({ id: "p1", content: documentUsing("hero") }),
    });

    const document = await classUsageDocumentReader(api)(
      subject({ variant: "draft" })
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
      collection: "pages",
      where: { id: { equals: "p1" } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
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
      find: async () => ({ items: [], meta: { hasNext: false } }),
    });

    const document = await classUsageDocumentReader(api)(subject());

    expect(document).toBeUndefined();
  });

  it("does NOT swallow a read failure", async () => {
    // `disableErrors` returned null for EVERY unsuccessful result, not only a
    // missing row — so a failing `afterRead` hook read as ordinary absence and
    // the subject was reconciled to zero against a document nobody could read.
    const { api } = recordingApi({
      find: async () => {
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
