/**
 * The warnings the server sends reach the toast, on all three write hooks.
 *
 * `warnings` rides on every mutation envelope, and each API client returned
 * `result.item` — so the array was dropped one layer below the code that could
 * have shown it. A side effect that silently did not run looked exactly like a
 * clean save.
 *
 * Asserted per hook rather than once, because the drop was per client: covering
 * update alone would leave create and delete free to differ again.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createSpy,
  updateSpy,
  deleteSpy,
  bulkUpdateSpy,
  successSpy,
  warningSpy,
  infoSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  updateSpy: vi.fn(),
  deleteSpy: vi.fn(),
  bulkUpdateSpy: vi.fn(),
  successSpy: vi.fn(),
  warningSpy: vi.fn(),
  infoSpy: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      create: createSpy,
      update: updateSpy,
      delete: deleteSpy,
      updateByIDs: bulkUpdateSpy,
    },
  };
});

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
}));

vi.mock("@admin/components/ui", () => ({
  toast: {
    success: successSpy,
    warning: warningSpy,
    info: infoSpy,
    error: vi.fn(),
  },
}));

import { useCreateEntry } from "../useCreateEntry";
import { useDeleteEntry } from "../useDeleteEntry";
import { useBulkUpdateEntries } from "../useBulkEntries";
import { useUpdateEntry } from "../useUpdateEntry";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const entry = { id: "e1", title: "Hello" };

const warnings = [
  {
    phase: "afterUpdate",
    collection: "posts",
    code: "INTERNAL_ERROR",
    message: "The search index could not be updated.",
  },
];

/** Only the part of the mutation result these cases drive. */
interface MutationLike {
  mutateAsync: (variables: unknown) => Promise<unknown>;
}

/** Each hook, with the client it drops through and how it is invoked. */
const HOOKS = [
  {
    name: "useCreateEntry",
    spy: createSpy,
    use: (onSuccess?: (entry: unknown) => void) =>
      useCreateEntry({ collectionSlug: "posts", onSuccess }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync({ title: "Hello" }),
    successMessage: "Entry created successfully",
  },
  {
    name: "useUpdateEntry",
    spy: updateSpy,
    use: (onSuccess?: (entry: unknown) => void) =>
      useUpdateEntry({
        collectionSlug: "posts",
        entryId: "e1",
        onSuccess,
      }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync({ title: "Hello" }),
    successMessage: "Entry updated successfully",
  },
  {
    name: "useDeleteEntry",
    spy: deleteSpy,
    use: (onSuccess?: (entry: unknown) => void) =>
      useDeleteEntry({ collectionSlug: "posts", onSuccess }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync("e1"),
    successMessage: "Entry deleted successfully",
  },
];

beforeEach(() => vi.clearAllMocks());

describe.each(HOOKS)(
  "$name reports post-commit failures",
  ({ spy, use, invoke, successMessage }) => {
    it("shows a plain success when the server sent no warnings", async () => {
      spy.mockResolvedValue({ item: entry });
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });

      const { result } = renderHook(() => use(), {
        wrapper: makeWrapper(client),
      });
      await invoke(result.current);

      await waitFor(() =>
        expect(successSpy).toHaveBeenCalledWith(successMessage)
      );
      expect(warningSpy).not.toHaveBeenCalled();
    });

    it("names the follow-up failure the server reported", async () => {
      spy.mockResolvedValue({ item: entry, warnings });
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });

      const { result } = renderHook(() => use(), {
        wrapper: makeWrapper(client),
      });
      await invoke(result.current);

      await waitFor(() => expect(warningSpy).toHaveBeenCalledOnce());
      expect(warningSpy.mock.calls[0]?.[0]).toBe(
        `${successMessage}, but 1 follow-up action failed`
      );
      // Still not an error: the row committed before the hook ran.
      expect(successSpy).not.toHaveBeenCalled();
    });

    it("hands the entry, not the envelope, to onSuccess", async () => {
      // The envelope is an internal detail of the hook. A consumer asked for
      // the saved row, and widening that silently would break every caller.
      spy.mockResolvedValue({ item: entry, warnings });
      const onSuccess = vi.fn();
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });

      const { result } = renderHook(() => use(onSuccess), {
        wrapper: makeWrapper(client),
      });
      await invoke(result.current);

      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(entry));
    });
  }
);

describe("a BULK write", () => {
  it("shows the warnings the server sent", async () => {
    // The gap this file was written about, one layer over: `respondBulk` emits
    // the same array, and the bulk hook toasted its own message and dropped it.
    // An author publishing ten pages at once was told nothing that an author
    // publishing one of them would have been told.
    bulkUpdateSpy.mockResolvedValue({
      message: "Updated 2 entries.",
      items: [entry, { id: "e2", title: "Second" }],
      errors: [],
      warnings: [
        {
          severity: "notice",
          phase: "afterUpdate",
          collection: "posts",
          code: "COMPONENTS_NOT_PUBLISHED",
          message: "This page embeds 1 component that is not published.",
        },
      ],
    });

    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(
      () => useBulkUpdateEntries({ collectionSlug: "posts" }) as MutationLike,
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync({
      ids: ["e1", "e2"],
      data: { status: "published" },
    });

    await waitFor(() => {
      expect(infoSpy).toHaveBeenCalledTimes(1);
    });
    expect(infoSpy.mock.calls[0]?.[0]).toBe("Updated 2 entries.");
  });

  it("still reports a clean bulk write as a plain success", async () => {
    // The control. Without it, a hook that showed the advisory presenter
    // unconditionally would pass the case above while changing every ordinary
    // bulk toast.
    bulkUpdateSpy.mockResolvedValue({
      message: "Updated 2 entries.",
      items: [entry],
      errors: [],
    });

    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(
      () => useBulkUpdateEntries({ collectionSlug: "posts" }) as MutationLike,
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync({
      ids: ["e1"],
      data: { status: "published" },
    });

    await waitFor(() => {
      expect(successSpy).toHaveBeenCalledWith("Updated 2 entries.");
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("a bulk consumer that renders its own feedback", () => {
  it("receives the warnings in the callback payload", async () => {
    // With `showToast` off, the built-in presenter is the ONLY thing that was
    // reading `response.warnings` — so the surface that opted out in order to
    // handle them itself was the one surface that could not see them.
    bulkUpdateSpy.mockResolvedValue({
      message: "Updated 1 entry.",
      items: [entry],
      errors: [],
      warnings: [
        {
          severity: "notice",
          phase: "afterUpdate",
          collection: "posts",
          code: "COMPONENTS_NOT_PUBLISHED",
          message: "This page embeds 1 component that is not published.",
          entryId: "e1",
        },
      ],
    });

    let seen: unknown;
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useBulkUpdateEntries({
          collectionSlug: "posts",
          showToast: false,
          onComplete: (payload: unknown) => {
            seen = payload;
          },
        }) as MutationLike,
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync({
      ids: ["e1"],
      data: { status: "published" },
    });

    await waitFor(() => {
      expect(seen).toBeDefined();
    });
    expect((seen as { warnings?: unknown[] }).warnings).toHaveLength(1);
    // The control: the toast really was suppressed, so this asserts the
    // callback route rather than passing because both fired.
    expect(successSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
