/**
 * The edit dialog an upload field opens places the focus point the same way
 * the library does: one dot on the whole image. Unlike the library, Done
 * only places it: the dialog's `onSave` runs once, from "Save changes", with
 * the point and the text together, which is what callers of this exported
 * dialog were written against.
 *
 * It used to place the point on the square thumbnail, a crop of the image,
 * and draw a crosshair, the coordinates, the image again at three ratios and
 * a message about sizes being regenerated.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Media } from "@admin/types/media";

import { MediaEditDialog } from "../MediaEditDialog";

const item: Media = {
  id: "m1",
  filename: "coast.jpg",
  originalFilename: "coast.jpg",
  mimeType: "image/jpeg",
  size: 2048,
  width: 1920,
  height: 800,
  url: "/uploads/coast.jpg",
  thumbnailUrl: "/uploads/thumb_coast.jpg",
  focalX: 30,
  focalY: 40,
  altText: "Coastline at dusk",
  uploadedBy: "u1",
  uploadedAt: new Date(0),
  updatedAt: new Date(0),
};

function renderDialog() {
  const onSave = vi.fn(() => Promise.resolve());
  const onOpenChange = vi.fn();
  render(
    <MediaEditDialog
      open
      media={item}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
  return { onSave, onOpenChange };
}

/** Moves the point one step right with the keyboard and presses Done. */
function placePointOneRight() {
  fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
  fireEvent.keyDown(screen.getByRole("slider", { name: "Focus point" }), {
    key: "ArrowRight",
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
}

describe("the media edit dialog's focus point", () => {
  it("is one dot on the whole image, placed by Done without saving", async () => {
    const { onSave } = renderDialog();

    expect(
      screen.getByRole("img", { name: "Coastline at dusk" })
    ).toHaveAttribute("src", "/uploads/coast.jpg");
    expect(screen.queryByText(/1:1|16:9|4:3/)).toBeNull();
    expect(screen.queryByText(/\(\s*30\s*,\s*40\s*\)/)).toBeNull();

    placePointOneRight();

    // POSITIVE CONTROL: Done finished placing, and the dot stayed put.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Set focus point" })
      ).toBeInTheDocument()
    );
    const dot = document.querySelector<HTMLElement>("[data-focal-dot]");
    expect(dot?.style.left).toBe("31%");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("sends the point with the text in one save from Save changes", async () => {
    const { onSave } = renderDialog();
    placePointOneRight();
    fireEvent.change(screen.getByLabelText(/Alt text/), {
      target: { value: "Coast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      altText: "Coast",
      caption: undefined,
      focalX: 31,
      focalY: 40,
    });
    expect(screen.queryByText(/regenerat/i)).toBeNull();
  });

  it("sends no point from Save changes when it wasn't moved", async () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      altText: "Coastline at dusk",
      caption: undefined,
    });
  });

  it("stays open, and stops placing the point, when Escape is pressed on Done", () => {
    const { onOpenChange, onSave } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();

    fireEvent.keyDown(done, { key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set focus point" })
    ).toBeInTheDocument();
  });
});
