// @vitest-environment jsdom

/**
 * The Background section's image: picked from the library or uploaded and
 * written by its address, given by a pasted link, shown with Replace and
 * Remove once set, and Remove clears only the image.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import type { StyleValue } from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { BackgroundImageField } from "./background-image-control";
import type {
  ContentServices,
  MediaPickerProps,
  PickedMedia,
} from "./content-services";
import { ContentServicesContext } from "./content-services";

afterEach(cleanup);

/** What the field is handed to write with. */
type Commit = (value: StyleValue | null) => "applied" | "refused" | "unchanged";

const PICKED: PickedMedia = {
  id: "m1",
  url: "https://cdn.example.com/hero.jpg",
  filename: "hero.jpg",
};

/** A library that hands back `picked` as soon as it opens. */
function libraryReturning(picked: PickedMedia) {
  return function Library({ open, onSelect }: MediaPickerProps) {
    React.useEffect(() => {
      if (open) onSelect([picked]);
    }, [open, onSelect]);
    return null;
  };
}

function renderField({
  stored,
  services = {},
  onCommit = vi.fn<Commit>(() => "applied"),
}: {
  stored?: string;
  services?: Partial<ContentServices>;
  onCommit?: Mock<Commit>;
}) {
  render(
    <ContentServicesContext.Provider value={services as ContentServices}>
      <span id="label">Image</span>
      <BackgroundImageField
        id="bg-image"
        labelledBy="label"
        stored={stored}
        actionName="Set Image"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </ContentServicesContext.Provider>
  );
  return onCommit;
}

describe("choosing a background image", () => {
  it("writes the library file's address, not its id", async () => {
    const onCommit = renderField({
      services: { MediaPicker: libraryReturning(PICKED) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Background image" })
    );
    await vi.waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
  });

  it("says so, and writes nothing, for a library file with no address", async () => {
    const onCommit = renderField({
      services: { MediaPicker: libraryReturning({ id: "m2", url: null }) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Background image" })
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That file has no address to show it from."
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("uploads a file and writes its address", async () => {
    const uploadMedia = vi.fn(async () => PICKED);
    const onCommit = renderField({ services: { uploadMedia } });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "hero.jpg", { type: "image/jpeg" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    await vi.waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("https://cdn.example.com/hero.jpg")
    );
    expect(uploadMedia).toHaveBeenCalledWith(file);
  });

  it("writes a pasted link when the field is left, and on Enter", () => {
    const onCommit = renderField({});
    const link = screen.getByRole("textbox", { name: "Image link" });
    fireEvent.change(link, { target: { value: " https://x.test/a.png " } });
    fireEvent.blur(link);
    expect(onCommit).toHaveBeenLastCalledWith("https://x.test/a.png");
    fireEvent.change(link, { target: { value: "https://x.test/b.png" } });
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("https://x.test/b.png");
  });

  it("offers no library or upload when the host provides neither, only the link", () => {
    renderField({});
    expect(screen.queryByRole("button", { name: /Choose/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Image link" })).toBeDefined();
  });
});

describe("a set background image", () => {
  it("shows a thumbnail and its file name, with Replace and Remove", () => {
    renderField({
      stored: "https://cdn.example.com/hero.jpg",
      services: { MediaPicker: libraryReturning(PICKED), uploadMedia: vi.fn() },
    });
    expect(screen.getByText("hero.jpg")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Choose Background image" })
        .textContent
    ).toBe("Replace");
    expect(
      screen.getByRole("button", { name: "Remove background image" })
    ).toBeDefined();
    // Upload and the link are for choosing; Replace takes their place.
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Image link" })).toBeNull();
  });

  it("clears only the image on Remove", () => {
    const onCommit = renderField({ stored: "https://x.test/a.png" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove background image" })
    );
    expect(onCommit).toHaveBeenCalledWith(null);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("treats the `none` keyword as no image", () => {
    renderField({ stored: "none" });
    expect(screen.getByRole("textbox", { name: "Image link" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Remove background image" })
    ).toBeNull();
  });
});
