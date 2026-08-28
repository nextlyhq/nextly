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

const { createMock, deleteMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@admin/services/singleApi", () => ({
  singleApi: {
    create: (...a: unknown[]) => createMock(...a),
    deleteSingle: (...a: unknown[]) => deleteMock(...a),
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
} from "../useSingles";

/** The document a slug pointed at before the Single was replaced. */
const PREDECESSOR = { id: "old-incarnation", title: "Homepage" };

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The cache as it is when an editor has already read the Single: this is the
  // payload that must not survive the slug being reused.
  client.setQueryData(singleDocumentKeys.detail("homepage"), PREDECESSOR);
  client.setQueryData(singleKeys.detail("homepage"), { slug: "homepage" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

/** What a consumer mounting now would be handed, synchronously. */
const documentInCache = (client: QueryClient) =>
  client.getQueryData(singleDocumentKeys.detail("homepage"));

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
   * The schema tree is INVALIDATED rather than removed, and that difference is
   * deliberate: a slightly stale list costs a reader nothing while it
   * refetches, and it is the identity that must not survive. Asserting it here
   * keeps the two from being collapsed into one behaviour later.
   */
  it("keeps the schema entry, marking it stale rather than evicting it", async () => {
    const { client, wrapper } = harness();
    const { result } = renderHook(() => useDeleteSingle(), { wrapper });
    result.current.mutate("homepage");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(singleKeys.detail("homepage"))).toEqual({
      slug: "homepage",
    });
    expect(
      client.getQueryState(singleKeys.detail("homepage"))?.isInvalidated
    ).toBe(true);
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
