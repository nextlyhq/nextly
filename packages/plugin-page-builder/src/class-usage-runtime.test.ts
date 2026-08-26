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

/** A Direct API that records every call and answers with fixed values. */
function recordingApi(overrides: Partial<ClassUsageDirectApi> = {}) {
  const calls: Record<string, unknown>[] = [];
  const api: ClassUsageDirectApi = {
    find: async args => {
      calls.push({ op: "find", ...args });
      return { docs: [{ id: "r1" }], hasNextPage: false };
    },
    findByID: async args => {
      calls.push({ op: "findByID", ...args });
      return { id: args.id };
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

  it("translates the paging shape the reconciler reads", async () => {
    const { api } = recordingApi({
      find: async () => ({
        docs: [{ id: "a" }, { id: "b" }],
        hasNextPage: true,
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

  it("reads a response with no docs as an EMPTY page, not as a failure", async () => {
    // Which is the correct reading of a table nothing has written to yet — the
    // state every site is in before the first save. Treating it as an error
    // would fail maintenance on exactly the documents that need it most.
    const { api } = recordingApi({ find: async () => ({}) });

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
