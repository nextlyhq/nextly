/**
 * A refused write is reported in the server's own words, on each of the three
 * entry write hooks.
 *
 * The server's refusal already says what was refused, in the site's words
 * ("You can't delete this post."). A toast that puts its own words in front of
 * it ("Failed to delete entry: You can't delete this post.") says it twice.
 * Each hook is asked separately because each builds its own toast.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSpy, updateSpy, deleteSpy, errorSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  updateSpy: vi.fn(),
  deleteSpy: vi.fn(),
  errorSpy: vi.fn(),
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
    error: errorSpy,
  },
}));

import { parseApiError } from "@admin/lib/api/parseApiError";

import { useCreateEntry } from "../useCreateEntry";
import { useDeleteEntry } from "../useDeleteEntry";
import { useUpdateEntry } from "../useUpdateEntry";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** A refusal as the client raises it: the server's envelope, parsed. */
function refusal(message: string) {
  return parseApiError(
    { error: { code: "FORBIDDEN", message, requestId: "req-1" } },
    403
  );
}

/** Only the part of the mutation result these cases drive. */
interface MutationLike {
  mutateAsync: (variables: unknown) => Promise<unknown>;
}

const HOOKS = [
  {
    name: "useDeleteEntry",
    spy: deleteSpy,
    use: () => useDeleteEntry({ collectionSlug: "posts" }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync("e1"),
    message: "You can't delete this post.",
  },
  {
    name: "useUpdateEntry",
    spy: updateSpy,
    use: () =>
      useUpdateEntry({
        collectionSlug: "posts",
        entryId: "e1",
      }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync({ title: "Hello" }),
    message: "You can't edit this post.",
  },
  {
    name: "useCreateEntry",
    spy: createSpy,
    use: () => useCreateEntry({ collectionSlug: "posts" }) as MutationLike,
    invoke: (m: MutationLike) => m.mutateAsync({ title: "Hello" }),
    message: "You can't create posts.",
  },
];

beforeEach(() => vi.clearAllMocks());

describe.each(HOOKS)("$name, refused", ({ spy, use, invoke, message }) => {
  it("shows the server's message as it is", async () => {
    spy.mockRejectedValue(refusal(message));
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    const { result } = renderHook(() => use(), {
      wrapper: makeWrapper(client),
    });
    await expect(invoke(result.current)).rejects.toThrow(message);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
    expect(errorSpy.mock.calls[0]?.[0]).toBe(message);
  });
});
