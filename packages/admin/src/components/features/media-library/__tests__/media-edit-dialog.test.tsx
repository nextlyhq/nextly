/**
 * The edit dialog an upload field opens places the focus point the same way
 * the library does: one dot on the whole image, saved by Done.
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

describe("the media edit dialog's focus point", () => {
  it("is one dot on the whole image, saved by Done", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <MediaEditDialog
        open
        media={item}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />
    );

    expect(
      screen.getByRole("img", { name: "Coastline at dusk" })
    ).toHaveAttribute("src", "/uploads/coast.jpg");
    expect(screen.queryByText(/1:1|16:9|4:3/)).toBeNull();
    expect(screen.queryByText(/\(\s*30\s*,\s*40\s*\)/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Focus point" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 31, focalY: 40 })
    );
    // The field keeps the item it opened with, so the dot has to stay where
    // Done put it rather than snap back to the item's old point.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Set focus point" })
      ).toBeInTheDocument()
    );
    const dot = document.querySelector<HTMLElement>("[data-focal-dot]");
    expect(dot?.style.left).toBe("31%");
  });

  it("saves the text on its own once the point is saved, and says nothing about regenerating sizes", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <MediaEditDialog
        open
        media={item}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Focus point" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 30, focalY: 41 })
    );

    fireEvent.change(screen.getByLabelText(/Alt text/), {
      target: { value: "Coast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith({
        altText: "Coast",
        caption: undefined,
      })
    );
    expect(screen.queryByText(/regenerat/i)).toBeNull();
  });
});
