/**
 * A library tile: the image fitted inside a neutral backdrop, drawn from the
 * smallest stored copy that shows the whole picture, and marked when an image
 * has no alt text.
 *
 * Which copy is chosen is pinned in `lib/media-utils.test.ts`; these check the
 * tile draws what that choice gives, fitted rather than filled.
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
  it("draws a wide image from its smallest whole-image size, fitted inside the square", () => {
    render(
      <MediaCard
        media={media({
          sizes: {
            small: {
              url: "/uploads/coast-480.jpg",
              path: "coast-480.jpg",
              width: 480,
              height: 200,
              filesize: 900,
              mimeType: "image/jpeg",
              filename: "coast-480.jpg",
            },
          },
        })}
      />
    );
    const image = screen.getByRole("img", { name: "Coastline at dusk" });

    expect(image).toHaveAttribute("src", "/uploads/coast-480.jpg");
    // Fitted, not filled: the whole picture inside the tile's square.
    expect(image).toHaveClass("object-contain", "h-full", "w-full");
  });

  it("draws the light thumbnail rather than the original when no whole-image size exists", () => {
    render(<MediaCard media={media()} />);
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

  it("is named by the file's own name, as it shows it, not by where it is stored", () => {
    // An upload is stored under a path of the storage's making; the tile
    // shows the name the file was uploaded with, and a screen reader, voice
    // control or a search by name must find it by that same name.
    render(
      <MediaCard
        media={media({ filename: "uploads/2026/10/f81d4fae-coast.jpg" })}
        onSelectionChange={vi.fn()}
      />
    );

    // POSITIVE CONTROL: the tile shows the uploaded name.
    expect(screen.getByText("coast.jpg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^coast\.jpg/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select coast.jpg" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /f81d4fae/ })).toBeNull();
  });
});
