/**
 * An item's details in a panel beside the grid.
 *
 * The panel shows what a person checks about an item and lets them correct
 * it where they are reading it: alt text and caption save when the field
 * loses focus, say "Saved", and keep the typed text with a Retry when the
 * server refuses. The arrow keys move through the items, and a reader sees
 * everything with nothing to change.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Media } from "@admin/types/media";

import { MediaDetailsPanel } from "../MediaDetailsPanel";

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: "m1",
    filename: "coast.jpg",
    originalFilename: "coast.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    width: 1920,
    height: 800,
    url: "/uploads/coast.jpg",
    thumbnailUrl: "/uploads/thumb_coast.jpg",
    altText: "Coastline at dusk",
    caption: "Taken in May",
    folderId: "f1",
    uploadedBy: "u1",
    uploadedAt: new Date("2026-05-04T10:00:00Z"),
    updatedAt: new Date("2026-05-04T10:00:00Z"),
    ...overrides,
  };
}

function renderPanel(
  props: Partial<ComponentProps<typeof MediaDetailsPanel>> = {}
) {
  const handlers = {
    onSave: vi.fn(() => Promise.resolve()),
    onCopyUrl: vi.fn(),
    onDownload: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onExpand: vi.fn(),
    onClose: vi.fn(),
  };
  const result = render(
    <MediaDetailsPanel
      media={media()}
      layout="beside"
      folderName="Blog"
      readOnly={false}
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, ...result };
}

describe("the details panel", () => {
  it("shows the item's preview, text, facts and actions", () => {
    renderPanel();
    const panel = screen.getByRole("complementary", { name: "Media details" });

    expect(
      within(panel).getByRole("heading", { name: "coast.jpg" })
    ).toBeInTheDocument();
    // The whole image, not the square thumbnail.
    expect(
      within(panel).getByRole("img", { name: "Coastline at dusk" })
    ).toHaveAttribute("src", "/uploads/coast.jpg");
    expect(within(panel).getByLabelText(/Alt text/)).toHaveValue(
      "Coastline at dusk"
    );
    expect(within(panel).getByLabelText("Caption")).toHaveValue("Taken in May");

    const facts = within(panel).getByRole("region", { name: "File" });
    for (const [term, value] of [
      ["Type", "image/jpeg"],
      ["Dimensions", "1920 × 800"],
      ["Size", "2 KB"],
      ["Folder", "Blog"],
      ["Uploaded", "May 4, 2026"],
    ]) {
      const dt = within(facts).getByText(term);
      expect(dt.nextElementSibling).toHaveTextContent(value);
    }

    for (const name of [/Copy URL/, /Download/, /Move to/, /Delete/]) {
      expect(within(panel).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("moves focus to its title when it opens beside the grid", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "coast.jpg" })).toHaveFocus();
  });

  it("saves alt text when the field loses focus, and keeps it with a Retry when the save fails once", async () => {
    const onSave = vi
      .fn<(id: string, updates: object) => Promise<void>>()
      .mockRejectedValueOnce(new Error("server down"))
      .mockResolvedValue(undefined);
    renderPanel({ onSave });
    const alt = screen.getByLabelText(/Alt text/);

    fireEvent.change(alt, {
      target: { value: "Coast at dusk, from the pier" },
    });
    fireEvent.blur(alt);

    expect(onSave).toHaveBeenCalledWith("m1", {
      altText: "Coast at dusk, from the pier",
    });
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
    // The typed words survive the failure.
    expect(alt).toHaveValue("Coast at dusk, from the pier");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("m1", {
      altText: "Coast at dusk, from the pier",
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("announces the save in a polite live region", async () => {
    renderPanel();
    const caption = screen.getByLabelText("Caption");
    fireEvent.change(caption, { target: { value: "Taken in June" } });
    fireEvent.blur(caption);

    const status = await screen.findByText("Saved");
    expect(status).toHaveAttribute("role", "status");
  });

  it("doesn't save a field that lost focus unchanged", () => {
    const { onSave } = renderPanel();
    const alt = screen.getByLabelText(/Alt text/);
    fireEvent.focus(alt);
    fireEvent.blur(alt);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves typed text on the way to the next item, for the item it was typed on", () => {
    const { onSave, rerender, onNext } = renderPanel();
    fireEvent.change(screen.getByLabelText(/Alt text/), {
      target: { value: "Edited, not yet blurred" },
    });

    rerender(
      <MediaDetailsPanel
        media={media({ id: "m2", originalFilename: "hills.jpg", altText: "" })}
        layout="beside"
        folderName="Blog"
        readOnly={false}
        onSave={onSave}
        onCopyUrl={vi.fn()}
        onDownload={vi.fn()}
        onNext={onNext}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(onSave).toHaveBeenCalledWith("m1", {
      altText: "Edited, not yet blurred",
    });
    // The next item shows its own text, not the previous item's draft.
    expect(screen.getByLabelText(/Alt text/)).toHaveValue("");
  });

  it("sends a blurred field's save once, when Next follows before it finishes", async () => {
    let finishSave: () => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishSave = resolve;
        })
    );
    const { rerender } = renderPanel({ onSave });
    const alt = screen.getByLabelText(/Alt text/);
    fireEvent.change(alt, {
      target: { value: "Coast at dusk, from the pier" },
    });
    fireEvent.blur(alt);
    // POSITIVE CONTROL: the blur did send the save, and it is still pending.
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(
      <MediaDetailsPanel
        media={media({ id: "m2", originalFilename: "hills.jpg", altText: "" })}
        layout="beside"
        folderName="Blog"
        readOnly={false}
        onSave={onSave}
        onCopyUrl={vi.fn()}
        onDownload={vi.fn()}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />
    );
    finishSave();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("m1", {
      altText: "Coast at dusk, from the pier",
    });
  });

  it("fits its height to the window below where it sits, so its actions stay on screen", () => {
    const realTop = HTMLElement.prototype.getBoundingClientRect;
    // Laid out under the breadcrumbs and the toolbar, on a page not yet
    // scrolled: 212px down a 900px window.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = realTop.call(this);
      return this.matches("[data-media-details-panel]")
        ? ({
            x: 0,
            y: 212,
            left: 0,
            top: 212,
            width: 380,
            height: 600,
            right: 380,
            bottom: 812,
            toJSON: () => ({}),
          } as DOMRect)
        : rect;
    };
    const innerHeight = window.innerHeight;
    window.innerHeight = 900;
    try {
      renderPanel();
      const panel = screen.getByRole("complementary", {
        name: "Media details",
      });
      // 900 - 212, less the 16px kept below it.
      expect(panel.style.maxHeight).toBe("672px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = realTop;
      window.innerHeight = innerHeight;
    }
  });

  it("sends one save at a time for a field, then the latest text, and says Saved only for what was stored", async () => {
    const finish: Array<() => void> = [];
    const onSave = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish.push(resolve);
        })
    );
    renderPanel({ onSave });
    const alt = screen.getByLabelText(/Alt text/);

    fireEvent.change(alt, { target: { value: "First" } });
    fireEvent.blur(alt);
    fireEvent.change(alt, { target: { value: "Second" } });
    fireEvent.blur(alt);
    fireEvent.change(alt, { target: { value: "Third" } });
    fireEvent.blur(alt);

    // POSITIVE CONTROL: the first blur did send.
    expect(onSave).toHaveBeenCalledWith("m1", { altText: "First" });
    // The rest wait for it, so an older request can't land after a newer one.
    expect(onSave).toHaveBeenCalledTimes(1);

    finish[0]();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    // Only the latest text waited; "Second" was never sent.
    expect(onSave).toHaveBeenLastCalledWith("m1", { altText: "Third" });
    expect(screen.queryByText("Saved")).toBeNull();

    finish[1]();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("holds alt text and caption to the edit dialog's limits, and refuses to save past them", () => {
    const { onSave } = renderPanel();
    const alt = screen.getByLabelText(/Alt text/);
    const caption = screen.getByLabelText("Caption");
    expect(alt).toHaveAttribute("maxLength", "500");
    expect(caption).toHaveAttribute("maxLength", "1000");

    // A value set past the limit (a script, or an old browser) isn't saved.
    fireEvent.change(alt, { target: { value: "a".repeat(501) } });
    fireEvent.blur(alt);

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Alt text can be at most 500 characters/)
    ).toBeInTheDocument();
  });

  it("moves to the previous and next item with the arrow keys and the buttons", () => {
    const { onPrevious, onNext } = renderPanel();
    const title = screen.getByRole("heading", { name: "coast.jpg" });

    fireEvent.keyDown(title, { key: "ArrowRight" });
    fireEvent.keyDown(title, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Next file" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous file" }));

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
  });

  it("leaves the arrow keys to a text field being typed in", () => {
    const { onPrevious, onNext } = renderPanel();
    fireEvent.keyDown(screen.getByLabelText(/Alt text/), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByLabelText("Caption"), { key: "ArrowRight" });
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("disables Previous at the first item rather than wrapping round", () => {
    renderPanel({ onPrevious: undefined });
    expect(
      screen.getByRole("button", { name: "Previous file" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next file" })).toBeEnabled();
  });

  it("opens the viewer from Expand", () => {
    const { onExpand } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand to full screen" })
    );
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows a reader the details with nothing to change", () => {
    renderPanel({ readOnly: true, onMove: undefined, onDelete: undefined });
    const panel = screen.getByRole("complementary", { name: "Media details" });

    // POSITIVE CONTROL: the details themselves are there.
    expect(within(panel).getByText("Coastline at dusk")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /Copy URL/ })
    ).toBeInTheDocument();

    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: "Set focus point" })
    ).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Move to/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Delete/ })).toBeNull();
  });
});

describe("the details panel over a narrow library", () => {
  it("is a dialog with its own close button, and Escape closes it", () => {
    const { onClose } = renderPanel({ layout: "over" });
    const dialog = screen.getByRole("dialog", { name: "coast.jpg" });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close details" })
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the sheet open when Escape only stops placing the focus point", () => {
    const { onClose } = renderPanel({ layout: "over" });
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    fireEvent.keyDown(screen.getByRole("slider", { name: "Focus point" }), {
      key: "Escape",
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set focus point" })
    ).toBeInTheDocument();
  });

  it("keeps the sheet open, and stops placing the point, when Escape is pressed on Done", () => {
    const { onClose, onSave } = renderPanel({ layout: "over" });
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();

    fireEvent.keyDown(done, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set focus point" })
    ).toBeInTheDocument();
  });
});
