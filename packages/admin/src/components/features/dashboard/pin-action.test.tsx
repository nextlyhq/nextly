/**
 * The pin a document offers: no item until the reader's pins are known, the
 * verb they call for, a choice that writes and then reads the pins again, a
 * confirmation that says where the pin went only when the dashboard shows it,
 * and a refusal shown in the server's own words (the limit, with "View all
 * pins", or the command to run).
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

beforeEach(() => {
  closeAllPins();
});

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, post, delete: del },
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

import { closeAllPins, useAllPinsOpen } from "./all-pins";
import { usePinAction } from "./pin-action";

const PINNED_SHOWN = "Pinned to your dashboard.";
const PINNED_NOT_SHOWN =
  "Pinned. Add “Continue where you left off” to your dashboard to see your pins.";

/** A placement of a card on the reader's layout. */
const placed = (widgetId: string, removed = false) => ({
  id: widgetId,
  widgetId,
  w: 6,
  h: 5,
  removed,
});

/**
 * The reader's pins at each read, in turn (the last repeated), and their
 * layout: the two reads a pin makes, answered by path.
 */
function answers(
  pins: { items: unknown[] }[],
  layout: { placements: unknown[] } | Error = {
    placements: [placed("core/continue")],
  }
) {
  let read = 0;
  get.mockImplementation(async (path: string) => {
    if (path.startsWith("/dashboard/layout")) {
      if (layout instanceof Error) throw layout;
      return layout;
    }
    const answer = pins[Math.min(read, pins.length - 1)];
    read += 1;
    return answer;
  });
}

/** Pin the target from an unpinned start, and answer with the confirmation's words. */
async function pinAndConfirm(): Promise<unknown> {
  post.mockResolvedValue({ message: "Pinned.", pinned: true });
  const { result } = renderHook(() => usePinAction(target), { wrapper });
  await waitFor(() => expect(result.current).not.toBeNull());
  act(() => result.current!.binding.onSelect({ values: {} }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  return toast.success.mock.calls[0]![0];
}

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
  vi.resetAllMocks();
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
    answers([{ items: [] }, { items: [pinOfTarget] }]);
    post.mockResolvedValue({ message: "Pinned.", pinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect({ values: {} }));
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
    answers([{ items: [pinOfTarget] }]);
    del.mockResolvedValue({ message: "Unpinned.", unpinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() =>
      expect(result.current?.action.label).toBe("Unpin from dashboard")
    );
    act(() => result.current!.binding.onSelect({ values: {} }));
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
    answers([{ items: [] }, { items: [pinOfTarget] }]);
    post.mockResolvedValue({ message: "Pinned.", pinned: true });
    del.mockResolvedValue({ message: "Unpinned.", unpinned: true });
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect({ values: {} }));
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
    answers([{ items: [] }]);
    post.mockRejectedValue(
      Object.assign(
        new Error(
          "Pins are not available yet. Run `nextly migrate` to create the table they are kept in."
        ),
        { status: 503, code: "SERVICE_UNAVAILABLE" }
      )
    );
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect({ values: {} }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Pins are not available yet. Run `nextly migrate` to create the table they are kept in."
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses at the limit in plain words, with View all pins, which opens every pin", async () => {
    answers([{ items: [] }]);
    post.mockRejectedValue(
      Object.assign(new Error("You can keep up to 20 pins. Unpin one first."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    const open = renderHook(() => useAllPinsOpen());
    const { result } = renderHook(() => usePinAction(target), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.binding.onSelect({ values: {} }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can keep up to 20 pins. Unpin one first.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "View all pins" }),
        })
      )
    );
    expect(open.result.current).toBe(false);
    const { action } = toast.error.mock.calls[0]![1] as {
      action: { onClick: (event: { preventDefault(): void }) => void };
    };
    const event = { preventDefault: vi.fn() };
    act(() => action.onClick(event));
    expect(open.result.current).toBe(true);
    // The toast stays, so focus has somewhere to come back to.
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("the confirmation a pin gets", () => {
  it("says it is on the dashboard while a Continue card is placed there", async () => {
    answers([{ items: [] }, { items: [pinOfTarget] }], {
      placements: [placed("core/team"), placed("core/continue")],
    });
    await expect(pinAndConfirm()).resolves.toBe(PINNED_SHOWN);
  });

  it("says how to see it when no Continue card is on the dashboard", async () => {
    answers([{ items: [] }, { items: [pinOfTarget] }], {
      placements: [placed("core/team")],
    });
    await expect(pinAndConfirm()).resolves.toBe(PINNED_NOT_SHOWN);
  });

  it("says how to see it when the Continue card was removed", async () => {
    answers([{ items: [] }, { items: [pinOfTarget] }], {
      placements: [placed("core/continue", true)],
    });
    await expect(pinAndConfirm()).resolves.toBe(PINNED_NOT_SHOWN);
  });

  it("never claims the card when the layout cannot be read", async () => {
    answers(
      [{ items: [] }, { items: [pinOfTarget] }],
      new Error("layout unavailable")
    );
    await expect(pinAndConfirm()).resolves.toBe(PINNED_NOT_SHOWN);
  });

  it("offers Undo with either confirmation", async () => {
    answers([{ items: [] }, { items: [pinOfTarget] }], { placements: [] });
    await pinAndConfirm();
    expect(toast.success.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      })
    );
  });
});
