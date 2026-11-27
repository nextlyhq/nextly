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

import { documentAddress } from "@admin/lib/navigation/document-address";
import type { DocumentAddressOf } from "@admin/lib/navigation/useDocumentAddress";

import {
  activityFromRow,
  activityHref,
  useRecentActivity,
} from "./useRecentActivity";

/** The shared rule over a collection that opens its entries in a view. */
const addressOf: DocumentAddressOf = (document, options = {}) =>
  documentAddress(
    document,
    document.slug === "pages"
      ? {
          fields: [
            { name: "title", type: "text" },
            { name: "content", type: "blocks" },
          ],
          admin: { opensIn: "builder" },
        }
      : undefined,
    { canUpdate: true, defaultLocale: "en", ...options },
    [{ fieldType: "blocks", path: "builder", component: "@acme/x#Builder" }]
  );

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

describe("where a feed row leads", () => {
  const row = {
    collection: "posts",
    entryId: "42",
    action: "update",
    subjectKind: "collection",
  };

  it("opens the entry a change was made to", () => {
    expect(activityHref(row, addressOf)).toBe("/admin/collections/posts/42");
  });

  it("opens the entry where its collection opens entries, as every other link does", () => {
    expect(activityHref({ ...row, collection: "pages" }, addressOf)).toBe(
      "/admin/collections/pages/42/builder?field=content"
    );
  });

  it("opens the Single a change was made to, by its slug", () => {
    expect(
      activityHref(
        {
          ...row,
          collection: "site-settings",
          subjectKind: "single",
        },
        addressOf
      )
    ).toBe("/admin/singles/site-settings");
  });

  it("leads nowhere for a deletion, whose subject is gone", () => {
    expect(
      activityHref({ ...row, action: "delete" }, addressOf)
    ).toBeUndefined();
  });

  it("leads nowhere for a change to settings, or a row naming no entry", () => {
    expect(
      activityHref({ ...row, subjectKind: "settings" }, addressOf)
    ).toBeUndefined();
    expect(activityHref({ ...row, entryId: null }, addressOf)).toBeUndefined();
  });
});

describe("who a feed row names", () => {
  const byAgent = {
    ...row,
    collection: "posts",
    agentName: "Claude Code",
    door: "command",
    approvedVia: "phone",
  };

  it("keeps the person as the actor on an agent's row, and carries who stood behind them", () => {
    // `user` is read by every consumer of this hook as the person who acted;
    // an agent's row must not change what it says.
    const activity = activityFromRow(byAgent);
    expect(activity?.user).toMatchObject({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      deleted: false,
    });
    expect(activity?.attribution).toEqual({
      agentName: "Claude Code",
      door: "command",
      approvedVia: "phone",
      deploymentHost: null,
      deploymentCommit: null,
      actorIsKey: false,
    });
  });

  it("carries the same through the activity endpoint", async () => {
    answer.activities = [byAgent];
    const { result } = renderHook(() => useRecentActivity(5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const activity = result.current.data?.activities[0];
    expect(activity?.user.name).toBe("Ada");
    expect(activity?.attribution).toMatchObject({
      agentName: "Claude Code",
      approvedVia: "phone",
    });
  });

  it("says when the actor an agent used is a key", () => {
    expect(
      activityFromRow({
        ...byAgent,
        actorType: "apiKey",
        door: "rest-key",
      })?.attribution
    ).toMatchObject({ agentName: "Claude Code", actorIsKey: true });
  });

  it("carries nothing for a row nothing stood behind, or from an older server", () => {
    expect(activityFromRow({ ...row, collection: "posts" })).not.toHaveProperty(
      "attribution"
    );
    expect(
      activityFromRow({
        ...row,
        collection: "posts",
        agentName: null,
        door: null,
      })
    ).not.toHaveProperty("attribution");
  });
});

describe("a search of the email delivery log", () => {
  const search = {
    ...row,
    action: "read",
    collection: "email-deliveries",
    entryId: null,
  };

  it("is drawn as a search, never dropped as an action this build can't read", () => {
    const activity = activityFromRow(search);
    expect(activity).toBeDefined();
    expect(activity?.type).toBe("read");
    expect(activity?.action).toBe("searched");
    expect(activity?.target).toBe("email deliveries");
    expect(activity?.collectionLabel).toBeUndefined();
    expect(activity?.category).toBe("info");
  });

  it("leads nowhere, since a search opens no one document", () => {
    expect(
      activityHref({ ...search, entryId: "doc-1" }, addressOf)
    ).toBeUndefined();
  });
});
