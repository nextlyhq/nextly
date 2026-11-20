/**
 * A document's review state as the editor holds it: asked once per document,
 * an answer (not an error) where no workflow is attached, and asked again
 * after a step or an assignment moves it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSpy, stepSpy, assignSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  stepSpy: vi.fn(),
  assignSpy: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  takeWorkflowStep: stepSpy,
  assignWorkflowParts: assignSpy,
}));

import {
  reviewKeys,
  useAssignPart,
  useReviewState,
  useTakeStep,
} from "../useReviewState";

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("useReviewState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks nothing before the document exists", () => {
    renderHook(() => useReviewState(undefined), {
      wrapper: wrapperFor(client()),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers a document with no workflow as not attached, with no error", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const { result } = renderHook(() => useReviewState(post), {
      wrapper: wrapperFor(client()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ attached: false });
    expect(result.current.isError).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith({ collection: "posts", id: "e1" });
  });

  it("asks a Single by its slug", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    renderHook(
      () =>
        useReviewState({
          scopeKind: "single",
          scopeSlug: "home",
          entryId: "s",
        }),
      { wrapper: wrapperFor(client()) }
    );
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith({ single: "home" })
    );
  });

  it("asks the document's review state again after a step", async () => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
    const { result } = renderHook(() => useTakeStep(post), {
      wrapper: wrapperFor(queryClient),
    });
    await result.current.mutateAsync({
      step: "submit",
      parts: [null],
      seen: [{ part: null, revision: 0, version: "v1" }],
    });
    expect(stepSpy).toHaveBeenCalledWith({
      document: { collection: "posts", id: "e1" },
      step: "submit",
      parts: [null],
      seen: [{ part: null, revision: 0, version: "v1" }],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: reviewKeys.document(post),
    });
  });

  it("asks the document's review state again after an assignment", async () => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    assignSpy.mockResolvedValue({ message: "Assigned.", item: {} });
    const { result } = renderHook(() => useAssignPart(post), {
      wrapper: wrapperFor(queryClient),
    });
    await result.current.mutateAsync({
      part: "en",
      revision: 3,
      assignee: { kind: "role", id: "editors" },
    });
    expect(assignSpy).toHaveBeenCalledWith([
      {
        document: { collection: "posts", id: "e1" },
        part: "en",
        revision: 3,
        assignee: { kind: "role", id: "editors" },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: reviewKeys.document(post),
    });
  });
});
