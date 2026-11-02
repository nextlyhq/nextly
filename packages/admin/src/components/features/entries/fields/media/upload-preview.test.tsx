/**
 * The upload field's preview draws the image's thumbnail whole, fitted inside
 * its square on a neutral backdrop, as the media library's tiles and the
 * picker do. A fitted thumbnail and an older square one both show whole; a
 * fill would crop a wide or tall picture's edges away.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UploadPreview } from "./UploadPreview";

describe("the upload field's preview", () => {
  it("draws the thumbnail whole, fitted inside the square on a neutral backdrop", () => {
    render(
      <UploadPreview
        file={{
          id: "m1",
          filename: "coast.jpg",
          url: "/uploads/coast.jpg",
          thumbnailUrl: "/uploads/thumb_coast.jpg",
          mimeType: "image/jpeg",
        }}
        onRemove={vi.fn()}
      />
    );
    const image = screen.getByRole("img", { name: "coast.jpg" });

    expect(image).toHaveAttribute("src", "/uploads/thumb_coast.jpg");
    expect(image).toHaveClass("object-contain", "h-full", "w-full");
    expect(image).not.toHaveClass("object-cover");
    expect(image.parentElement).toHaveClass("bg-muted");
  });
});
