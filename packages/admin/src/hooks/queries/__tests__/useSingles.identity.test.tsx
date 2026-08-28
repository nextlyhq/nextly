/**
 * What a slug refers to, and the cache that remembers the wrong answer.
 *
 * `singleKeys` and `singleDocumentKeys` are separate trees — `["singles"]` and
 * `["single-documents"]` — so invalidating one cannot reach the other. Creating
 * or removing a Single does not change a document, but it changes WHICH
 * document a slug names, and a slug reused by a recreated Single kept serving
 * its predecessor's document, id and all, for the provider's stale window.
 *
 * That id is a cache scope elsewhere: the version history and its diffs are
 * keyed on it, so the comparison page painted a dead incarnation's history
 * under the recreated Single.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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
// that fails. Both are stubbed so this test stays about cache invalidation.
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { deleteSingle: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import {
  singleDocumentKeys,
  singleKeys,
  useCreateSingle,
  useDeleteSingle,
} from "../useSingles";

/** The key trees each `invalidateQueries` call named, as joined strings. */
function invalidatedTrees(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.map(([arg]) => {
    const key = (arg as { queryKey?: readonly unknown[] })?.queryKey ?? [];
    return key.join("/");
  });
}

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, spy, wrapper };
}

describe("a Single's identity leaves the document cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue({ slug: "homepage" });
    deleteMock.mockResolvedValue({ success: true });
  });

  it("clears the document cache when a Single is created", async () => {
    const { spy, wrapper } = harness();
    const { result } = renderHook(() => useCreateSingle(), { wrapper });

    result.current.mutate({ slug: "homepage" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const trees = invalidatedTrees(spy);
    // The premise: it does invalidate SOMETHING, so an absent document tree
    // below is a missing invalidation rather than a mutation that never ran.
    expect(trees).toContain(singleKeys.all().join("/"));
    expect(trees).toContain(singleDocumentKeys.all().join("/"));
  });

  it("clears the document cache when a Single is deleted", async () => {
    const { spy, wrapper } = harness();
    const { result } = renderHook(() => useDeleteSingle(), { wrapper });

    result.current.mutate("homepage");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const trees = invalidatedTrees(spy);
    expect(trees).toContain(singleKeys.all().join("/"));
    expect(trees).toContain(singleDocumentKeys.all().join("/"));
  });

  /**
   * The control on the key factories themselves. The whole defect is that
   * these are separate trees; if they ever shared a prefix, invalidating one
   * WOULD reach the other and the assertions above would pass for a reason
   * that has nothing to do with the fix.
   */
  it("keeps the two caches in genuinely separate trees", () => {
    expect(singleKeys.all()).toEqual(["singles"]);
    expect(singleDocumentKeys.all()).toEqual(["single-documents"]);
    expect(singleDocumentKeys.all()[0]).not.toBe(singleKeys.all()[0]);
  });
});
