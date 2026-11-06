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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useUpdateSingleDocument — keepalive", () => {
  beforeEach(() => updateDocument.mockClear());

  it("asks at each send, so an update made as the page is hidden outlives it", async () => {
    let hidden = false;
    const { result } = renderHook(
      () =>
        useUpdateSingleDocument("site-style", undefined, {
          keepalive: () => hidden,
        }),
      { wrapper }
    );
    await act(async () => {
      await result.current.mutateAsync({ tokens: null });
    });
    hidden = true;
    await act(async () => {
      await result.current.mutateAsync({ tokens: null });
    });
    expect(updateDocument.mock.calls.map(call => call[2])).toEqual([
      { locale: undefined, keepalive: false },
      { locale: undefined, keepalive: true },
    ]);
  });

  it("sends an ordinary request when not asked", async () => {
    const { result } = renderHook(() => useUpdateSingleDocument("site-style"), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ tokens: null });
    });
    expect(updateDocument.mock.calls[0]?.[2]).toEqual({
      locale: undefined,
      keepalive: false,
    });
  });
});
