/**
 * What a slug refers to, and the cache that remembers the wrong answer.
 *
 * `singleKeys` and `singleDocumentKeys` are separate trees — `["singles"]` and
 * `["single-documents"]` — so clearing one cannot reach the other. Creating or
 * deleting a Single does not change a document, but it changes WHICH document
 * a slug names, and a slug reused by a recreated Single otherwise goes on
 * serving its predecessor's document, id and all.
 *
 * That id is a cache scope elsewhere: the version list and its diffs are keyed
 * on it, so a comparison mounted meanwhile belongs to an incarnation that no
 * longer exists.
 *
 * Asserted on the CACHE, not on the calls made to it. A spy on
 * `invalidateQueries` reports that a request was issued and says nothing about
 * what survived it — and invalidation keeps its data, so such a test passes
 * while the predecessor's document is still there to be handed out.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMock, deleteMock, getDocumentMock, getSchemaMock } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    deleteMock: vi.fn(),
    getDocumentMock: vi.fn(),
    getSchemaMock: vi.fn(),
  })
);

vi.mock("@admin/services/singleApi", () => ({
  singleApi: {
    create: (...a: unknown[]) => createMock(...a),
    deleteSingle: (...a: unknown[]) => deleteMock(...a),
    getDocument: (...a: unknown[]) => getDocumentMock(...a),
    getSchema: (...a: unknown[]) => getSchemaMock(...a),
  },
}));

// The delete path also mirrors the change into ui-schema.json and warns when
// that fails. Both are stubbed so these tests stay about the cache.
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { deleteSingle: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import {
  singleDocumentKeys,
  singleKeys,
  useBulkDeleteSingles,
  useCreateSingle,
  useDeleteSingle,
  useSingleDocument,
} from "../useSingles";

/** The document a slug pointed at before the Single was replaced. */
const PREDECESSOR = { id: "old-incarnation", title: "Homepage" };
/** The fields the builder would apply on a save if it read them. */
const PREDECESSOR_SCHEMA = { slug: "homepage", fields: [{ name: "oldField" }] };

function harness() {
  const client = new QueryClient({
    defaultOptions: {
      // The provider's stale window, which is the condition this whole module
      // is about: without it a seeded entry refetches on mount and no reader
      // ever holds the predecessor long enough for the defect to appear.
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false },
    },
  });
  // The cache as it is when an editor has already read the Single: this is the
  // payload that must not survive the slug being reused.
  client.setQueryData(documentKey("homepage"), PREDECESSOR);
  client.setQueryData(singleKeys.detail("homepage"), { slug: "homepage" });
  client.setQueryData(singleKeys.schema("homepage"), PREDECESSOR_SCHEMA);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

/**
 * The key `useSingleDocument` actually reads.
 *
 * `singleDocumentKeys.detail(slug)` is only its PREFIX — the hook appends the
 * locale, fallback, translation-status and draft options, because each changes
 * what the document contains. Seeding or reading the bare prefix would address
 * an entry no consumer ever looks at, so a test written against it would pass
 * whatever production did. The clearing helper matches by prefix, which is why
 * it reaches this key while the assertion has to name it in full.
 */
const documentKey = (slug: string) => [
  ...singleDocumentKeys.detail(slug),
  {
    locale: null,
    fallbackLocale: null,
    translationStatus: false,
    draft: false,
  },
];

/** What a consumer mounting now would be handed, synchronously. */
const documentInCache = (client: QueryClient) =>
  client.getQueryData(documentKey("homepage"));

describe("a Single's identity leaves the document cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue({ slug: "homepage" });
    deleteMock.mockResolvedValue({ success: true });
  });

  it("is gone after a Single is created", async () => {
    const { client, wrapper } = harness();
    // The premise: it really is cached before the mutation, so its absence
    // afterwards is this change and not an empty cache all along.
    expect(documentInCache(client)).toEqual(PREDECESSOR);

    const { result } = renderHook(() => useCreateSingle(), { wrapper });
    result.current.mutate({ slug: "homepage" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(documentInCache(client)).toBeUndefined();
  });

  it("is gone after a Single is deleted", async () => {
    const { client, wrapper } = harness();
    expect(documentInCache(client)).toEqual(PREDECESSOR);

    const { result } = renderHook(() => useDeleteSingle(), { wrapper });
    result.current.mutate("homepage");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(documentInCache(client)).toBeUndefined();
  });

  /**
   * The bulk path had no test at all, which is how one copy of an invariant
   * drifts from the other two without anything reporting it.
   */
  it("is gone after Singles are deleted in bulk", async () => {
    const { client, wrapper } = harness();
    expect(documentInCache(client)).toEqual(PREDECESSOR);

    const { result } = renderHook(() => useBulkDeleteSingles(), { wrapper });
    await act(async () => {
      await result.current.mutate(["homepage"], undefined);
    });

    expect(documentInCache(client)).toBeUndefined();
  });

  /**
   * The SCHEMA goes too, and it is not a lesser case than the document. The
   * builder reads `useSingleSchema(slug)`; handed the predecessor's fields it
   * can apply them to the new Single with one save. `singleKeys.all()` is the
   * prefix of this key, so clearing the tree as a whole marked it stale and
   * kept the fields available — which is the shape of the original defect.
   */
  it("clears the slug's schema and detail, not only its document", async () => {
    const { client, wrapper } = harness();
    expect(client.getQueryData(singleKeys.schema("homepage"))).toEqual(
      PREDECESSOR_SCHEMA
    );

    const { result } = renderHook(() => useDeleteSingle(), { wrapper });
    result.current.mutate("homepage");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(singleKeys.schema("homepage"))).toBeUndefined();
    expect(client.getQueryData(singleKeys.detail("homepage"))).toBeUndefined();
  });

  /**
   * A consumer already MOUNTED against the document, which is the case a cache
   * lookup cannot see. Removal drops the data without telling an existing
   * observer, so the page goes on presenting the result it last saw — the old
   * id, and the history keyed on it — until something else makes it render.
   */
  it("tells a mounted reader to stop showing the old document", async () => {
    const { client, wrapper } = harness();
    getDocumentMock.mockResolvedValue({ id: "new-incarnation" });

    const reader = renderHook(() => useSingleDocument("homepage"), { wrapper });
    // The premise: the mounted reader really is showing the predecessor.
    await waitFor(() =>
      expect(reader.result.current.data).toEqual(PREDECESSOR)
    );

    const { result } = renderHook(() => useDeleteSingle(), { wrapper });
    result.current.mutate("homepage");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await waitFor(() =>
      expect(reader.result.current.data).not.toEqual(PREDECESSOR)
    );
  });

  /**
   * A bulk delete in which nothing succeeded must leave every cache alone:
   * those Singles still exist, and discarding their content during the failure
   * that already cost the reader something makes it worse.
   */
  it("leaves the caches alone when every deletion failed", async () => {
    const { client, wrapper } = harness();
    deleteMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useBulkDeleteSingles(), { wrapper });
    await act(async () => {
      await result.current.mutate(["homepage"], undefined);
    });

    expect(documentInCache(client)).toEqual(PREDECESSOR);
    expect(client.getQueryData(singleKeys.schema("homepage"))).toEqual(
      PREDECESSOR_SCHEMA
    );
  });

  /**
   * The control on the key factories. The whole defect is that these are
   * separate trees; if they ever shared a prefix, clearing one WOULD reach the
   * other and every assertion above would pass for an unrelated reason.
   */
  it("keeps the two caches in genuinely separate trees", () => {
    expect(singleKeys.all()).toEqual(["singles"]);
    expect(singleDocumentKeys.all()).toEqual(["single-documents"]);
  });
});
