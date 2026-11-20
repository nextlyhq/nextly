/**
 * A saved stage label or colour is shown wherever the stage is: the save marks
 * the workflows list and every document's review state stale, so the list, the
 * editor's review card and its status line read the stage again. A saved
 * default reviewer or grant changes who a part waits for and which steps a
 * reader may take, so it marks every review state stale too. A change naming
 * none of these (an email switch) leaves them as they are.
 *
 * The plausible broken save: one that only replaces the settings it answered,
 * leaving the list and the editor showing the label from before.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  updateWorkflowSettings: vi.fn(),
  listWorkflows: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  updateWorkflowSettings: api.updateWorkflowSettings,
  listWorkflows: api.listWorkflows,
}));
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({ data: { isAuthenticated: true } }),
}));

import { reviewKeys } from "../useReviewState";
import { useUpdateWorkflowSettings, useWorkflows } from "../useWorkflows";

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

  it("marks every review state stale once a default reviewer or who takes a step is saved, the list kept", async () => {
    // Who a part waits for and which steps a reader may take are part of each review state; the
    // list shows neither.
    for (const change of [
      { defaultReviewers: { inReview: { kind: "role" as const, id: "r1" } } },
      { grants: { approve: ["r1"] } },
    ]) {
      const client = clientWithReads();
      const { result } = renderHook(() => useUpdateWorkflowSettings("review"), {
        wrapper: wrapperFor(client),
      });

      await result.current.mutateAsync({ revision: 1, ...change });

      await waitFor(() => expect(stale(client, REVIEW)).toBe(true));
      expect(stale(client, LIST)).toBe(false);
    }
  });

  it("leaves them as they are for a change that names no label, reviewer or grant", async () => {
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

describe("the workflows list", () => {
  it("is read again each time it is opened, so its counts per stage follow moves made elsewhere", async () => {
    // A document moves stage through its own save, a publish or another person's step: none of
    // those passes through this cache, so a list read a moment ago is not trusted.
    // As the admin's own client keeps a read fresh for five minutes.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
    });
    client.setQueryData(LIST, { items: [], meta: {} });
    api.listWorkflows.mockResolvedValue({ items: [], meta: {} });

    renderHook(() => useWorkflows(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(api.listWorkflows).toHaveBeenCalledTimes(1));
  });
});
