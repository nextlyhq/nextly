/**
 * The review state and the waiting scope are asked only where a workflow can
 * hold something, as the server's workspace answer says: a document whose
 * collection no workflow holds is answered not attached without a request,
 * and nothing is asked while that answer is on its way. Where the server did
 * not say (its workspace half failed, or it sends no list), both are asked as
 * they always were.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reviewSpy, scopeSpy, workspace } = vi.hoisted(() => ({
  reviewSpy: vi.fn(),
  scopeSpy: vi.fn(),
  workspace: {
    entities: undefined as string[] | undefined,
    pending: false,
    unavailable: false,
  },
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: reviewSpy,
  fetchWaitingScope: scopeSpy,
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () =>
    workspace.entities === undefined
      ? {}
      : { workflowEntities: workspace.entities },
  useBrandingStatus: () => ({
    isPending: workspace.pending,
    isUnavailable: workspace.unavailable,
    isBrandingUnavailable: false,
    retry: () => {},
  }),
}));

import { reviewKeys, useReviewState } from "../useReviewState";
import { useWaitingScope } from "../useWaitingForMe";

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Lets every query that would start do so, so an absent call is not a race. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("workflow reads follow the workspace answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewSpy.mockResolvedValue({ attached: false });
    scopeSpy.mockResolvedValue({ reviews: false, stages: 0 });
    Object.assign(workspace, {
      entities: undefined,
      pending: false,
      unavailable: false,
    });
  });

  it("answers a document no workflow holds as not attached, without asking", async () => {
    workspace.entities = ["notes"];
    const { result } = renderHook(() => useReviewState(post), { wrapper });
    expect(result.current.data).toEqual({ attached: false });
    await settle();
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("reads an answer held from before the workflow was detached as not attached", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(reviewKeys.document(post), {
      attached: true,
      review: { workflow: "review", parts: [] },
    });
    workspace.entities = [];
    const { result } = renderHook(() => useReviewState(post), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current.data).toEqual({ attached: false });
    await settle();
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("asks a document a workflow holds", async () => {
    workspace.entities = ["posts"];
    renderHook(() => useReviewState(post), { wrapper });
    await waitFor(() =>
      expect(reviewSpy).toHaveBeenCalledWith({ collection: "posts", id: "e1" })
    );
  });

  it("asks once a workflow comes to hold the document", async () => {
    workspace.entities = [];
    const { rerender } = renderHook(() => useReviewState(post), { wrapper });
    await settle();
    expect(reviewSpy).not.toHaveBeenCalled();
    workspace.entities = ["posts"];
    rerender();
    await waitFor(() => expect(reviewSpy).toHaveBeenCalledTimes(1));
  });

  it("waits, with no answer, while the workspace answer is on its way", async () => {
    workspace.pending = true;
    const { result } = renderHook(() => useReviewState(post), { wrapper });
    await settle();
    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it.each([
    ["the workspace half failed", { entities: [], unavailable: true }],
    ["the server sends no list", { entities: undefined }],
  ])("asks as before where %s", async (_case, state) => {
    Object.assign(workspace, state);
    renderHook(() => useReviewState(post), { wrapper });
    renderHook(() => useWaitingScope(), { wrapper });
    await waitFor(() => expect(reviewSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(scopeSpy).toHaveBeenCalledTimes(1));
  });

  it("asks the waiting scope only where a workflow holds something", async () => {
    workspace.entities = [];
    renderHook(() => useWaitingScope(), { wrapper });
    await settle();
    expect(scopeSpy).not.toHaveBeenCalled();

    workspace.entities = ["notes"];
    renderHook(() => useWaitingScope(), { wrapper });
    await waitFor(() => expect(scopeSpy).toHaveBeenCalledTimes(1));
  });
});
