/**
 * "View all pins": drawn by its host only once opened, every pin newest first
 * opening where its document opens, each with Unpin; the pins the reader may
 * no longer open counted, with "Remove them" asking the server to remove
 * them in one request and reading the pins again once it has answered; and
 * focus given back to what opened it, the Continue card's footer or a pin
 * toast's button.
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@admin/components/ui";
import { render, screen, waitFor, within } from "@admin/__tests__/utils";

const { get, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, post, delete: del },
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => ({
    widgetSources: [
      { collection: "posts", label: "Blog posts", lifecycle: true, fields: [] },
    ],
  }),
}));

import { closeAllPins, openAllPins } from "./all-pins";
import { AllPinsHost } from "./AllPinsHost";
import { unreadableText } from "./AllPinsDialog";
import { usePinAction } from "./pin-action";

/** A pin as the reader is shown it. */
function shown(n: number, minutesAgo: number) {
  return {
    targetType: "collection" as const,
    targetSlug: "posts",
    entryId: `p${n}`,
    title: `Post ${n}`,
    pinnedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

/** The reader's pins and layout, answered by path. */
function answer(pins: { items: unknown[]; unreadableCount?: number }) {
  get.mockImplementation(async (path: string) =>
    path.startsWith("/dashboard/layout") ? { placements: [] } : pins
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  del.mockResolvedValue({ message: "Unpinned.", unpinned: true });
});
afterEach(() => {
  closeAllPins();
});

describe("View all pins", () => {
  it("draws nothing, and reads nothing, until it is opened", async () => {
    answer({ items: [shown(1, 1)] });
    render(<AllPinsHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(get).not.toHaveBeenCalled();
    openAllPins();
    expect(await screen.findByRole("dialog")).toHaveTextContent("Your pins");
  });

  it("lists every pin newest first, each opening where its document opens, each with Unpin", async () => {
    const user = userEvent.setup();
    answer({
      items: [1, 2, 3, 4, 5, 6, 7].map(n => shown(n, n)),
      unreadableCount: 0,
    });
    render(<AllPinsHost />);
    openAllPins();
    const rows = await screen.findAllByTestId("all-pins-row");
    expect(
      rows.map(each => within(each).getByRole("link").textContent)
    ).toEqual([
      "Post 1",
      "Post 2",
      "Post 3",
      "Post 4",
      "Post 5",
      "Post 6",
      "Post 7",
    ]);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      "/admin/collections/posts/p1"
    );
    expect(rows[0]).toHaveTextContent("Blog posts · pinned");
    expect(screen.queryByTestId("all-pins-unreadable")).toBeNull();

    await user.click(
      within(rows[2]!).getByRole("button", { name: "Unpin Post 3" })
    );
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/dashboard/pins", {
        targetType: "collection",
        targetSlug: "posts",
        entryId: "p3",
      })
    );
  });

  it("says how many pins the reader can no longer open, and removes them on the server with Remove them", async () => {
    const user = userEvent.setup();
    answer({ items: [shown(1, 1)], unreadableCount: 2 });
    render(<AllPinsHost />);
    openAllPins();
    const notice = await screen.findByTestId("all-pins-unreadable");
    expect(notice).toHaveTextContent("2 pins you can no longer open");
    await user.click(
      within(notice).getByRole("button", { name: "Remove them" })
    );
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    // One request, naming no pin: the server finds and removes them.
    expect(del.mock.calls[0]).toEqual(["/dashboard/pins?unreadable=1"]);
  });

  it("says so when the pins could not be removed, and reads them again", async () => {
    const user = userEvent.setup();
    answer({ items: [], unreadableCount: 1 });
    del.mockRejectedValue(new Error("offline"));
    const pinReads = () =>
      get.mock.calls.filter(([path]) => path === "/dashboard/pins").length;
    render(
      <>
        <Toaster />
        <AllPinsHost />
      </>
    );
    openAllPins();
    const notice = await screen.findByTestId("all-pins-unreadable");
    const before = pinReads();
    await user.click(
      within(notice).getByRole("button", { name: "Remove them" })
    );
    expect(
      await screen.findByText("Some pins could not be removed. Try again.")
    ).toBeInTheDocument();
    // A failed removal may still have removed some, so the count is read again.
    await waitFor(() => expect(pinReads()).toBe(before + 1));
  });

  it("reads the pins again only once the removal has answered", async () => {
    const user = userEvent.setup();
    answer({ items: [], unreadableCount: 2 });
    let finish: () => void = () => {};
    del.mockImplementation(async () => {
      await new Promise<void>(resolve => (finish = resolve));
      return {
        message: "Removed 2 pins you could no longer open.",
        removed: 2,
      };
    });
    const pinReads = () =>
      get.mock.calls.filter(([path]) => path === "/dashboard/pins").length;
    render(<AllPinsHost />);
    openAllPins();
    const notice = await screen.findByTestId("all-pins-unreadable");
    const before = pinReads();
    await user.click(
      within(notice).getByRole("button", { name: "Remove them" })
    );
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    // Still on its way: no read yet, and the button waits.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(pinReads()).toBe(before);
    expect(
      within(notice).getByRole("button", { name: "Remove them" })
    ).toBeDisabled();
    answer({ items: [], unreadableCount: 0 });
    finish();
    await waitFor(() => expect(pinReads()).toBe(before + 1));
    await waitFor(() =>
      expect(screen.queryByTestId("all-pins-unreadable")).toBeNull()
    );
  });

  it("says one pin in the singular", () => {
    expect(unreadableText(1)).toBe("1 pin you can no longer open");
    expect(unreadableText(3)).toBe("3 pins you can no longer open");
  });

  it("gives focus back to the button that opened it", async () => {
    const user = userEvent.setup();
    answer({ items: [shown(1, 1)] });
    render(
      <>
        <button type="button" onClick={openAllPins}>
          View all pins (7)
        </button>
        <AllPinsHost />
      </>
    );
    const opener = screen.getByRole("button", { name: "View all pins (7)" });
    await user.click(opener);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("opens from the limit's toast on an entry page, and gives focus back to its button", async () => {
    const user = userEvent.setup();
    answer({ items: [] });
    post.mockRejectedValue(
      Object.assign(new Error("You can keep up to 20 pins. Unpin one first."), {
        status: 409,
        code: "CONFLICT",
      })
    );
    function EntryMenu() {
      const pin = usePinAction({
        targetType: "collection",
        targetSlug: "posts",
        entryId: "p9",
      });
      return pin === null ? null : (
        <button
          type="button"
          onClick={() => pin.binding.onSelect({ values: {} })}
        >
          {pin.action.label}
        </button>
      );
    }
    render(
      <>
        <EntryMenu />
        <Toaster />
        <AllPinsHost />
      </>
    );
    await user.click(
      await screen.findByRole("button", { name: "Pin to dashboard" })
    );
    const viewAll = await screen.findByRole("button", {
      name: "View all pins",
    });
    expect(
      screen.getByText("You can keep up to 20 pins. Unpin one first.")
    ).toBeInTheDocument();
    await user.click(viewAll);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Your pins");
    // Past the toast's own exit, so a toast that closed on the click is gone.
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(viewAll).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(viewAll).toHaveFocus();
  });
});
