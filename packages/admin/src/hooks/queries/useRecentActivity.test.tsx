/**
 * How a feed row is headed: a Single's row by the Single's label alone, and a
 * collection's row, or one from a server that does not state a kind, by its
 * entry and its collection as before.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({ activities: [] as unknown[] }));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async () => ({ activities: answer.activities, hasMore: false }),
  },
}));

import { useRecentActivity } from "./useRecentActivity";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = {
  id: "a1",
  actorType: "user",
  userId: "u1",
  userName: "Ada",
  userEmail: "ada@example.com",
  action: "update",
  entryId: "doc-1",
  metadata: null,
  createdAt: "2026-03-01T12:00:00Z",
  identityErasedAt: null,
};

async function headed(entry: Record<string, unknown>) {
  answer.activities = [{ ...row, ...entry }];
  const { result } = renderHook(() => useRecentActivity(5), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const activity = result.current.data?.activities[0];
  return {
    target: activity?.target,
    entryTitle: activity?.entryTitle,
    collectionLabel: activity?.collectionLabel,
  };
}

beforeEach(() => {
  answer.activities = [];
});

describe("a feed row's heading", () => {
  it("names a Single by its label alone, never its slug", async () => {
    expect(
      await headed({
        collection: "site-settings",
        entryTitle: "Site Settings",
        subjectKind: "single",
      })
    ).toEqual({
      target: "Site Settings",
      entryTitle: "Site Settings",
      collectionLabel: undefined,
    });
  });

  it("names a collection's entry with its collection", async () => {
    expect(
      await headed({
        collection: "posts",
        entryTitle: "Hello",
        subjectKind: "collection",
      })
    ).toEqual({
      target: "Hello in posts",
      entryTitle: "Hello",
      collectionLabel: "posts",
    });
  });

  it("reads a row that states no kind as a collection's", async () => {
    expect(await headed({ collection: "posts", entryTitle: "Hello" })).toEqual({
      target: "Hello in posts",
      entryTitle: "Hello",
      collectionLabel: "posts",
    });
  });
});

describe("a feed row's count", () => {
  async function counted(entry: Record<string, unknown>) {
    answer.activities = [{ ...row, collection: "posts", ...entry }];
    const { result } = renderHook(() => useRecentActivity(5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const activity = result.current.data?.activities[0];
    return [activity?.count, activity?.countAtLeast];
  }

  it("carries how many saves the row stands for, and whether that is a floor", async () => {
    expect(await counted({ count: 12, countAtLeast: false })).toEqual([
      12,
      false,
    ]);
    expect(await counted({ count: 1000, countAtLeast: true })).toEqual([
      1000,
      true,
    ]);
  });

  it("reads a row from a server that sends no count as one save", async () => {
    expect(await counted({})).toEqual([1, false]);
  });
});
