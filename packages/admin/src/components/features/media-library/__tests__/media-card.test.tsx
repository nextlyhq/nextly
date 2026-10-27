/**
 * A library tile shows the whole image.
 *
 * The stored thumbnail is a square cut from the middle of the image, so a tile
 * drawn from it showed a crop of anything that isn't square, however the tile
 * fitted it. A tile now draws the image whole, fitted inside a neutral
 * backdrop, and marks an image that has no alt text.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Media } from "@admin/types/media";

import { MediaCard } from "../MediaCard";

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
    uploadedBy: "u1",
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("a library tile", () => {
  it("draws a wide image whole, from the image rather than its square thumbnail", () => {
    render(<MediaCard media={media()} />);
    const image = screen.getByRole("img", { name: "Coastline at dusk" });

    expect(image).toHaveAttribute("src", "/uploads/coast.jpg");
    // Fitted, not filled: the whole picture inside the tile's square.
    expect(image).toHaveClass("object-contain", "h-full", "w-full");
  });

  it("uses the thumbnail for a square image, which the thumbnail shows whole", () => {
    render(<MediaCard media={media({ width: 1200, height: 1200 })} />);
    expect(
      screen.getByRole("img", { name: "Coastline at dusk" })
    ).toHaveAttribute("src", "/uploads/thumb_coast.jpg");
  });

  it("marks an image that has no alt text", () => {
    render(<MediaCard media={media({ altText: null })} />);
    expect(screen.getByText("No alt text")).toBeInTheDocument();
  });

  it("leaves the mark off an image with alt text, and off a document", () => {
    const { rerender } = render(<MediaCard media={media()} />);
    // POSITIVE CONTROL: the tile has rendered, so absence is not an empty tree.
    expect(screen.getByText("coast.jpg")).toBeInTheDocument();
    expect(screen.queryByText("No alt text")).toBeNull();

    rerender(
      <MediaCard
        media={media({
          mimeType: "application/pdf",
          originalFilename: "pricing.pdf",
          altText: null,
          width: null,
          height: null,
        })}
      />
    );
    expect(screen.getByText("pricing.pdf")).toBeInTheDocument();
    expect(screen.queryByText("No alt text")).toBeNull();
  });

  it("says which tile's details are open", () => {
    const { rerender } = render(<MediaCard media={media()} />);
    const tile = screen.getByRole("button", { name: /coast\.jpg/ });
    expect(tile).not.toHaveAttribute("aria-current");

    rerender(<MediaCard media={media()} isCurrent />);
    expect(tile).toHaveAttribute("aria-current", "true");
  });

  it("opens with Enter and with Space", () => {
    const onClick = vi.fn();
    render(<MediaCard media={media()} onClick={onClick} />);
    const tile = screen.getByRole("button", { name: /coast\.jpg/ });

    fireEvent.keyDown(tile, { key: "Enter" });
    fireEvent.keyDown(tile, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
