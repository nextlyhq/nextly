/**
 * The full-screen viewer an item's details expand to.
 *
 * The arrow keys and the buttons move through the items, Escape closes it
 * back to the panel, and focus goes back to the control that opened it. The
 * viewer is opened by state rather than by a trigger of its own, so the
 * dialog primitive has no trigger to return focus to: without the viewer
 * doing it, focus fell to the page.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Media } from "@admin/types/media";

import { MediaViewer } from "../MediaViewer";

const item: Media = {
  id: "m1",
  filename: "coast.jpg",
  originalFilename: "coast.jpg",
  mimeType: "image/jpeg",
  size: 2048,
  width: 1920,
  height: 800,
  url: "/uploads/coast.jpg",
  altText: "Coastline at dusk",
  uploadedBy: "u1",
  uploadedAt: new Date(0),
  updatedAt: new Date(0),
};

/** A page with the Expand button the panel would have. */
function Harness(props: { onPrevious?: () => void; onNext?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Expand to full screen
      </button>
      <MediaViewer
        open={open}
        media={item}
        folderName={null}
        readOnly={false}
        onSave={() => Promise.resolve()}
        onCopyUrl={vi.fn()}
        onDownload={vi.fn()}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function openViewer(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  const expand = screen.getByRole("button", { name: "Expand to full screen" });
  expand.focus();
  fireEvent.click(expand);
  return { expand, viewer: screen.getByRole("dialog", { name: "coast.jpg" }) };
}

describe("the media viewer", () => {
  it("shows the whole image with the details beside it", () => {
    const { viewer } = openViewer();
    expect(
      within(viewer).getByRole("img", { name: "Coastline at dusk" })
    ).toHaveAttribute("src", "/uploads/coast.jpg");
    expect(
      within(viewer).getByRole("complementary", { name: "Media details" })
    ).toBeInTheDocument();

    fireEvent.click(within(viewer).getByRole("button", { name: /Info/ }));
    expect(
      within(viewer).queryByRole("complementary", { name: "Media details" })
    ).toBeNull();
  });

  it("opens with Info closed on a phone, where the details would stack under the image", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        ...matchMedia(query),
        matches: query.includes("max-width"),
      }) as MediaQueryList;
    try {
      const { viewer } = openViewer();
      // POSITIVE CONTROL: the viewer and its image are there.
      expect(
        within(viewer).getByRole("img", { name: "Coastline at dusk" })
      ).toBeInTheDocument();
      expect(
        within(viewer).queryByRole("complementary", { name: "Media details" })
      ).toBeNull();
      expect(
        within(viewer).getByRole("button", { name: /Info/ })
      ).toHaveAttribute("aria-pressed", "false");
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("moves to the previous and next item with the arrow keys and the buttons", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const { viewer } = openViewer({ onPrevious, onNext });

    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    fireEvent.click(within(viewer).getByRole("button", { name: "Next file" }));
    fireEvent.click(
      within(viewer).getByRole("button", { name: "Previous file" })
    );

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and returns focus to Expand", async () => {
    const { expand, viewer } = openViewer();
    // POSITIVE CONTROL: focus really left Expand while the viewer was open.
    await vi.waitFor(() =>
      expect(viewer.contains(document.activeElement)).toBe(true)
    );

    fireEvent.keyDown(viewer, { key: "Escape" });

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "coast.jpg" })).toBeNull()
    );
    await vi.waitFor(() => expect(expand).toHaveFocus());
  });
});
