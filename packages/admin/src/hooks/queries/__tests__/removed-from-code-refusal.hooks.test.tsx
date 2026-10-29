/**
 * Every admin write hook, refused because its entity was removed from code.
 *
 * Two promises, asked of each hook separately because each builds its own
 * error handling:
 *
 * - The author reads the server's sentence as it is: it names the entity,
 *   says it was removed from code and gives both ways out. A hook that shows
 *   a toast of its own words instead ("Couldn't publish all languages.") or
 *   puts words in front of it hides that.
 * - The entity's schema is read again. A screen opened before the removal
 *   holds a schema that says it may be edited; read again, it carries the mark
 *   and the screen turns read-only. The last two cases watch that happen.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteByIDs: vi.fn(),
  updateByIDs: vi.fn(),
  publishAllEntryLocales: vi.fn(),
  publishAllSingleLocales: vi.fn(),
  updateDocument: vi.fn(),
  getSingleSchema: vi.fn(),
  getCollectionSchema: vi.fn(),
  discardWorkingDraft: vi.fn(),
  restore: vi.fn(),
  setLabel: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      create: api.create,
      update: api.update,
      delete: api.delete,
      deleteByIDs: api.deleteByIDs,
      updateByIDs: api.updateByIDs,
      publishAllLocales: api.publishAllEntryLocales,
    },
  };
});

vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: {
      ...actual.singleApi,
      publishAllLocales: api.publishAllSingleLocales,
      updateDocument: api.updateDocument,
      getSchema: api.getSingleSchema,
    },
  };
});

vi.mock("@admin/services/collectionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/collectionApi")>();
  return {
    ...actual,
    collectionApi: {
      ...actual.collectionApi,
      getSchema: api.getCollectionSchema,
    },
  };
});

vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return {
    ...actual,
    versionApi: {
      ...actual.versionApi,
      discardWorkingDraft: api.discardWorkingDraft,
      restore: api.restore,
      setLabel: api.setLabel,
    },
  };
});

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
}));

vi.mock("@admin/components/ui", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: api.toastError,
  },
}));

import { parseApiError } from "@admin/lib/api/parseApiError";

import { useBulkDeleteEntries, useBulkUpdateEntries } from "../useBulkEntries";
import { collectionKeys, useCollectionSchema } from "../useCollections";
import { useCreateEntry } from "../useCreateEntry";
import { useDeleteEntry } from "../useDeleteEntry";
import { useDiscardSingleWorkingDraft } from "../useDiscardSingleWorkingDraft";
import { useDiscardWorkingDraft } from "../useDiscardWorkingDraft";
import { usePublishAllLocales } from "../usePublishAllLocales";
import { usePublishAllSingleLocales } from "../usePublishAllSingleLocales";
import {
  singleKeys,
  useSingleSchema,
  useUpdateSingleDocument,
} from "../useSingles";
import { useUpdateEntry } from "../useUpdateEntry";
import { useRestoreVersion, useSetVersionLabel } from "../useVersions";

function sentence(kind: "collection" | "single", slug: string) {
  const thing = kind === "single" ? "Single" : "collection";
  const its = kind === "single" ? "it" : "its entries";
  return (
    `The ${thing} "${slug}" was removed from code, so ${its} can't be ` +
    "changed. To retire it, run `nextly migrate:create` and then " +
    "`nextly migrate`. To keep it, declare it again in nextly.config.ts."
  );
}

/** The refusal as the client raises it: the server's envelope, parsed. */
function refusal(kind: "collection" | "single", slug: string) {
  return parseApiError(
    {
      error: {
        code: "ENTITY_REMOVED_FROM_CODE",
        message: sentence(kind, slug),
        data: { kind, slug },
        requestId: "req-1",
      },
    },
    409
  );
}

/** Only the part of a mutation result these cases drive. */
interface MutationLike {
  mutateAsync: (variables?: unknown) => Promise<unknown>;
}

const COLLECTION_SCOPE = {
  kind: "collection" as const,
  slug: "posts",
  entryId: "e1",
};
const SINGLE_SCOPE = {
  kind: "single" as const,
  slug: "home",
  documentId: "d1",
};

interface HookCase {
  name: string;
  kind: "collection" | "single";
  spy: ReturnType<typeof vi.fn>;
  use: () => MutationLike;
  variables?: unknown;
  /** Whether the hook shows the failure itself, or leaves it to its caller. */
  toasts: boolean;
}

const HOOKS: HookCase[] = [
  {
    name: "useCreateEntry",
    kind: "collection",
    spy: api.create,
    use: () => useCreateEntry({ collectionSlug: "posts" }) as MutationLike,
    variables: { title: "Hello" },
    toasts: true,
  },
  {
    name: "useUpdateEntry",
    kind: "collection",
    spy: api.update,
    use: () =>
      useUpdateEntry({
        collectionSlug: "posts",
        entryId: "e1",
      }) as MutationLike,
    variables: { title: "Hello" },
    toasts: true,
  },
  {
    name: "useDeleteEntry",
    kind: "collection",
    spy: api.delete,
    use: () => useDeleteEntry({ collectionSlug: "posts" }) as MutationLike,
    variables: "e1",
    toasts: true,
  },
  {
    name: "useBulkDeleteEntries",
    kind: "collection",
    spy: api.deleteByIDs,
    use: () =>
      useBulkDeleteEntries({ collectionSlug: "posts" }) as MutationLike,
    variables: ["e1", "e2"],
    toasts: true,
  },
  {
    name: "useBulkUpdateEntries",
    kind: "collection",
    spy: api.updateByIDs,
    use: () =>
      useBulkUpdateEntries({ collectionSlug: "posts" }) as MutationLike,
    variables: { ids: ["e1"], data: { status: "published" } },
    toasts: true,
  },
  {
    name: "usePublishAllLocales",
    kind: "collection",
    spy: api.publishAllEntryLocales,
    use: () =>
      usePublishAllLocales({ collectionSlug: "posts" }) as MutationLike,
    variables: "e1",
    toasts: true,
  },
  {
    name: "useDiscardWorkingDraft",
    kind: "collection",
    spy: api.discardWorkingDraft,
    use: () =>
      useDiscardWorkingDraft({
        collectionSlug: "posts",
        entryId: "e1",
      }) as MutationLike,
    toasts: true,
  },
  {
    name: "useRestoreVersion (an entry)",
    kind: "collection",
    spy: api.restore,
    use: () => useRestoreVersion({ scope: COLLECTION_SCOPE }) as MutationLike,
    variables: 2,
    toasts: false,
  },
  {
    name: "useSetVersionLabel (an entry)",
    kind: "collection",
    spy: api.setLabel,
    use: () => useSetVersionLabel({ scope: COLLECTION_SCOPE }) as MutationLike,
    variables: { versionNo: 2, label: "Launch" },
    toasts: false,
  },
  {
    name: "usePublishAllSingleLocales",
    kind: "single",
    spy: api.publishAllSingleLocales,
    use: () => usePublishAllSingleLocales({ slug: "home" }) as MutationLike,
    toasts: true,
  },
  {
    name: "useDiscardSingleWorkingDraft",
    kind: "single",
    spy: api.discardWorkingDraft,
    use: () =>
      useDiscardSingleWorkingDraft({
        slug: "home",
        documentId: "d1",
      }) as MutationLike,
    toasts: true,
  },
  {
    name: "useUpdateSingleDocument",
    kind: "single",
    spy: api.updateDocument,
    use: () => useUpdateSingleDocument("home") as MutationLike,
    variables: { title: "Hello" },
    toasts: false,
  },
  {
    name: "useRestoreVersion (a Single)",
    kind: "single",
    spy: api.restore,
    use: () => useRestoreVersion({ scope: SINGLE_SCOPE }) as MutationLike,
    variables: 2,
    toasts: false,
  },
  {
    name: "useSetVersionLabel (a Single)",
    kind: "single",
    spy: api.setLabel,
    use: () => useSetVersionLabel({ scope: SINGLE_SCOPE }) as MutationLike,
    variables: { versionNo: 2, label: "Launch" },
    toasts: false,
  },
];

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => vi.clearAllMocks());

describe.each(HOOKS)(
  "$name, refused for an entity removed from code",
  ({ kind, spy, use, variables, toasts }) => {
    const slug = kind === "single" ? "home" : "posts";

    it("reads the entity's schema again", async () => {
      spy.mockRejectedValue(refusal(kind, slug));
      const client = makeClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");

      const { result } = renderHook(() => use(), {
        wrapper: makeWrapper(client),
      });
      await expect(result.current.mutateAsync(variables)).rejects.toThrow();

      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: kind === "single" ? singleKeys.all() : collectionKeys.all(),
        })
      );
    });

    it.runIf(toasts)("shows the server's sentence as it is", async () => {
      spy.mockRejectedValue(refusal(kind, slug));
      const client = makeClient();

      const { result } = renderHook(() => use(), {
        wrapper: makeWrapper(client),
      });
      await expect(result.current.mutateAsync(variables)).rejects.toThrow();

      await waitFor(() => expect(api.toastError).toHaveBeenCalledOnce());
      expect(api.toastError.mock.calls[0]?.[0]).toBe(sentence(kind, slug));
    });
  }
);

describe("a screen opened before the removal", () => {
  it("turns a collection's editor read-only once a write is refused", async () => {
    // The schema the screen opened with carries no mark; the server's next
    // answer does, as it would once the configuration stopped declaring it.
    api.getCollectionSchema
      .mockResolvedValueOnce({ slug: "posts" })
      .mockResolvedValue({
        slug: "posts",
        removedFromCode: true,
        removedFromCodeState: { state: "not-dropped" },
      });
    api.publishAllEntryLocales.mockRejectedValue(
      refusal("collection", "posts")
    );
    const client = makeClient();

    const { result } = renderHook(
      () => ({
        schema: useCollectionSchema("posts"),
        publishAll: usePublishAllLocales({ collectionSlug: "posts" }),
      }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(result.current.schema.data).toBeDefined());
    expect(result.current.schema.data?.removedFromCode).toBeUndefined();

    await expect(result.current.publishAll.mutateAsync("e1")).rejects.toThrow();

    await waitFor(() =>
      expect(result.current.schema.data?.removedFromCode).toBe(true)
    );
  });

  it("turns a Single's editor read-only once a write is refused", async () => {
    api.getSingleSchema
      .mockResolvedValueOnce({ slug: "home" })
      .mockResolvedValue({
        slug: "home",
        removedFromCode: true,
        removedFromCodeState: { state: "not-dropped" },
      });
    api.updateDocument.mockRejectedValue(refusal("single", "home"));
    const client = makeClient();

    const { result } = renderHook(
      () => ({
        schema: useSingleSchema("home"),
        save: useUpdateSingleDocument("home"),
      }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(result.current.schema.data).toBeDefined());
    expect(result.current.schema.data?.removedFromCode).toBeUndefined();

    await expect(
      result.current.save.mutateAsync({ title: "Hello" })
    ).rejects.toThrow();

    await waitFor(() =>
      expect(result.current.schema.data?.removedFromCode).toBe(true)
    );
  });
});
