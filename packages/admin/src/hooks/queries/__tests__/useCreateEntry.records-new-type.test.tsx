/**
 * A type becomes the reader's most recent for the dashboard's New button when
 * an entry of it is created, wherever in the admin that happens, and only then.
 *
 * Recorded on the create itself rather than on the controls that open a form:
 * a form opened and left creates nothing, and an entry created from its
 * collection's own list is as much a creation as one started from New.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSpy, postSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  postSpy: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...actual, entryApi: { ...actual.entryApi, create: createSpy } };
});
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: postSpy, get: vi.fn() },
}));
vi.mock("@admin/components/ui", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { useCreateEntry } from "../useCreateEntry";

function renderCreate() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(() => useCreateEntry({ collectionSlug: "posts" }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  postSpy.mockResolvedValue({ recent: ["posts"] });
});

describe("creating an entry", () => {
  it("records its type as the most recent", async () => {
    createSpy.mockResolvedValue({ item: { id: "e1" } });
    const { result } = renderCreate();
    await result.current.mutateAsync({ title: "Hello" });
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith("/dashboard/new-types", {
        slug: "posts",
      })
    );
  });

  it("records nothing when the create is refused", async () => {
    createSpy.mockRejectedValue(new Error("refused"));
    const { result } = renderCreate();
    await expect(
      result.current.mutateAsync({ title: "Hello" })
    ).rejects.toThrow("refused");
    expect(postSpy).not.toHaveBeenCalled();
  });
});
