/**
 * The media library picker's tiles: a click anywhere on a picture's tile
 * chooses it, not only its corner checkbox; in a single pick a double-click
 * picks it and closes; in a multiple pick a click adds and removes, and the
 * checkbox still does as it did.
 *
 * The library's reads are stand-ins: what is asked here is what a press on a
 * tile does, not how the library is read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Media } from "@admin/types/media";

function media(id: string, name: string): Media {
  return {
    id,
    filename: name,
    originalFilename: name,
    mimeType: "image/png",
    size: 2048,
    width: 640,
    height: 480,
    url: `/uploads/${name}`,
    thumbnailUrl: null,
    altText: "Described",
    uploadedBy: "u1",
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const LIBRARY = [media("m1", "coast.png"), media("m2", "harbour.png")];

vi.mock("@admin/hooks/queries/useMedia", () => ({
  useInfiniteMedia: () => ({
    data: {
      pages: [{ data: LIBRARY, meta: { total: LIBRARY.length } }],
    },
    isLoading: false,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(() => Promise.resolve()),
  }),
  useRootFolders: () => ({ data: [] }),
  useSubfolders: () => ({ data: [] }),
  useFolderContents: () => ({ data: undefined }),
  useCreateFolder: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("../MediaUploadDropzone", () => ({
  MediaUploadDropzone: () => null,
}));

const { MediaPickerDialog } = await import(".");

function open(mode: "single" | "multi") {
  const onSelect = vi.fn<(chosen: Media[]) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MediaPickerDialog
        mode={mode}
        open
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        accept="image/*"
      />
    </QueryClientProvider>
  );
  return { onSelect, onOpenChange };
}

/** A tile by the file it shows. */
function tile(name: string): HTMLElement {
  return screen.getByRole("button", { name: `${name} - image/png` });
}

function selectButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Select/ });
}

describe("the media picker's tiles, picking one", () => {
  it("chooses a picture by a click anywhere on its tile", () => {
    const { onSelect } = open("single");
    expect(selectButton()).toBeDisabled();
    fireEvent.click(tile("coast.png"));
    expect(tile("coast.png")).toHaveAttribute("aria-selected", "true");
    expect(selectButton()).toHaveTextContent("Select (1)");
    // A click on another moves the choice: one picture at a time.
    fireEvent.click(tile("harbour.png"));
    expect(tile("coast.png")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(selectButton());
    expect(onSelect).toHaveBeenCalledWith([LIBRARY[1]]);
  });

  it("picks the picture and closes on a double-click", () => {
    const { onSelect, onOpenChange } = open("single");
    fireEvent.click(tile("harbour.png"));
    fireEvent.click(tile("harbour.png"));
    fireEvent.doubleClick(tile("harbour.png"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith([LIBRARY[1]]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("chooses from the keyboard as from a click", () => {
    open("single");
    fireEvent.keyDown(tile("coast.png"), { key: "Enter" });
    expect(tile("coast.png")).toHaveAttribute("aria-selected", "true");
  });
});

describe("the media picker's tiles, picking several", () => {
  it("adds and removes a picture by a click on its tile", () => {
    const { onSelect } = open("multi");
    fireEvent.click(tile("coast.png"));
    fireEvent.click(tile("harbour.png"));
    expect(selectButton()).toHaveTextContent("Select (2)");
    fireEvent.click(tile("coast.png"));
    expect(selectButton()).toHaveTextContent("Select (1)");
    fireEvent.click(selectButton());
    expect(onSelect).toHaveBeenCalledWith([LIBRARY[1]]);
  });

  it("keeps the checkbox, which chooses once and not twice", () => {
    open("multi");
    const checkbox = within(tile("coast.png")).getByRole("checkbox", {
      name: "Select coast.png",
    });
    fireEvent.click(checkbox);
    expect(selectButton()).toHaveTextContent("Select (1)");
  });

  it("does not pick on a double-click, where several are picked", () => {
    const { onSelect, onOpenChange } = open("multi");
    fireEvent.doubleClick(tile("coast.png"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
