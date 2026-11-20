/**
 * A saved stage label or colour is shown wherever the stage is: the save marks
 * the workflows list and every document's review state stale, so the list, the
 * editor's review card and its status line read the stage again. A change that
 * names no label (an email switch) leaves them as they are.
 *
 * The plausible broken save: one that only replaces the settings it answered,
 * leaving the list and the editor showing the label from before.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ updateWorkflowSettings: vi.fn() }));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  updateWorkflowSettings: api.updateWorkflowSettings,
}));

import { reviewKeys } from "../useReviewState";
import { useUpdateWorkflowSettings } from "../useWorkflows";

const LIST = ["workflows", "list"] as const;
const REVIEW = reviewKeys.document({
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
});

function clientWithReads(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(LIST, { items: [], meta: {} });
  client.setQueryData(REVIEW, { attached: false });
  return client;
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const stale = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated ?? false;

beforeEach(() => {
  vi.clearAllMocks();
  api.updateWorkflowSettings.mockResolvedValue({ workflow: "review" });
});

describe("saving a workflow's settings", () => {
  it("marks the list and every review state stale once a label or colour is saved or reset", async () => {
    for (const labels of [
      { inReview: { label: "Waiting", colour: "#d97706" } },
      { inReview: null },
    ]) {
      const client = clientWithReads();
      const { result } = renderHook(() => useUpdateWorkflowSettings("review"), {
        wrapper: wrapperFor(client),
      });

      await result.current.mutateAsync({ revision: 1, labels });

      await waitFor(() => expect(stale(client, LIST)).toBe(true));
      expect(stale(client, REVIEW)).toBe(true);
    }
  });

  it("leaves them as they are for a change that names no label", async () => {
    const client = clientWithReads();
    const { result } = renderHook(() => useUpdateWorkflowSettings("review"), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync({
      revision: 1,
      emails: { approved: false },
    });

    expect(api.updateWorkflowSettings).toHaveBeenCalled();
    expect(stale(client, LIST)).toBe(false);
    expect(stale(client, REVIEW)).toBe(false);
  });
});
