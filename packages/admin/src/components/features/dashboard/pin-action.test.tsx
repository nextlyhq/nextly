/**
 * The pin a document offers: no item until the reader's pins are known, the
 * verb they call for, a choice that writes and then reads the pins again, and
 * a refusal shown in the server's own words (the limit, or the command to run).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post, del, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, post, delete: del },
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

import { usePinAction } from "./pin-action";

const target = {
  targetType: "collection" as const,
  targetSlug: "posts",
  entryId: "p1",
};
const pinOfTarget = {
  ...target,
  title: "First post",
  pinnedAt: "2026-10-29T00:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the pin a document offers", () => {
  it("offers nothing until the reader's pins are read, then the verb they call for", async () => {
    let answer: (value: { items: unknown[] }) => void = () => {};
    get.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    // 🔴 Never the wrong verb while the answer is pending.
    expect(result.current).toBeNull();
    await act(async () => answer({ items: [] }));
    await waitFor(() =>
      expect(result.current?.action.label).toBe("Pin to dashboard")
    );
  });

  it("pins, reads the pins again, and then offers to unpin", async () => {
    get.mockResolvedValueOnce({ items: [] });
    get.mockResolvedValue({ items: [pinOfTarget] });
    post.mockResolvedValue({ message: "Pinned.", pinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect());
    await waitFor(() =>
      expect(result.current?.action.label).toBe("Unpin from dashboard")
    );
    expect(post).toHaveBeenCalledWith("/dashboard/pins", target);
    // Confirmed once saved, since the menu closes and nothing else changes.
    expect(toast.success).toHaveBeenCalledWith(
      "Pinned to your dashboard.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      })
    );
  });

  it("unpins a pinned target with the same body", async () => {
    get.mockResolvedValue({ items: [pinOfTarget] });
    del.mockResolvedValue({ message: "Unpinned.", unpinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() =>
      expect(result.current?.action.label).toBe("Unpin from dashboard")
    );
    act(() => result.current!.binding.onSelect());
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/dashboard/pins", target)
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Unpinned from your dashboard.",
        expect.anything()
      )
    );
  });

  it("undoes a pin from its confirmation, back to the state before it", async () => {
    get.mockResolvedValueOnce({ items: [] });
    get.mockResolvedValue({ items: [pinOfTarget] });
    post.mockResolvedValue({ message: "Pinned.", pinned: true });
    del.mockResolvedValue({ message: "Unpinned.", unpinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const options = toast.success.mock.calls[0]![1] as {
      action: { onClick: () => void };
    };
    // 🔴 Undo unpins, the state before the choice; it does not pin again.
    act(() => options.action.onClick());
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/dashboard/pins", target)
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal in the server's own words", async () => {
    get.mockResolvedValue({ items: [] });
    post.mockRejectedValue(
      new Error(
        "You can pin at most 20 entries and Singles. Unpin one to pin another."
      )
    );
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can pin at most 20 entries and Singles. Unpin one to pin another."
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
