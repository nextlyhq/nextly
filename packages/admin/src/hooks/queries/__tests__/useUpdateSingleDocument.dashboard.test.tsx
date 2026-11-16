/**
 * A Single's update hook, asked as each update is sent whether it must
 * outlive the page, and passing the answer to the request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateDocument = vi.hoisted(() =>
  vi.fn<
    (
      slug: string,
      data: Record<string, unknown>,
      options?: { locale?: string; keepalive?: boolean }
    ) => Promise<{ id: string }>
  >(async () => ({ id: "s1" }))
);

vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: { ...actual.singleApi, updateDocument },
  };
});

import { useUpdateSingleDocument } from "../useSingles";

/**
 * Saving a Single refreshes what the dashboard reads, the Content overview's
 * "last edited" and "edited by" among them.
 */
describe("useUpdateSingleDocument, the dashboard's reads", () => {
  beforeEach(() => updateDocument.mockClear());

  it("are asked again once a Single is saved", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => useUpdateSingleDocument("site-settings"),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );
    await act(async () => {
      await result.current.mutateAsync({ tagline: "New" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });
});
