/**
 * The media library page: one toolbar row, and an item's details beside the
 * grid instead of in a modal over it.
 *
 * These render the whole page with the network stubbed, because what they
 * pin is how the parts meet: a tile opens the panel, a second tile replaces
 * what the panel shows without the first being closed, Expand opens the
 * viewer and Escape walks back out one layer at a time, and focus lands on
 * the tile of the item on screen when the panel closes.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  updateMedia: vi.fn(),
  getFolderById: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  listRootFolders: vi.fn(() => Promise.resolve([])),
  listSubfolders: vi.fn(() => Promise.resolve([])),
  getFolderContents: vi.fn(),
  updateMedia: (...a: unknown[]) => api.updateMedia(...a),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  uploadMedia: vi.fn(),
  createFolder: vi.fn(),
  getFolderById: (...a: unknown[]) => api.getFolderById(...a),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveMediaToFolder: vi.fn(),
}));

// The permissions the page is rendered with, by slug.
const held = vi.hoisted(() => ({ slugs: new Set<string>() }));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => held.slugs.has(slug),
}));

import { MediaProvider } from "@admin/context/providers/MediaProvider";

import { MediaLibrary } from "..";

const EDITOR = ["read-media", "create-media", "update-media", "delete-media"];

function item(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `m${n}`,
    filename: `photo-${n}.jpg`,
    originalFilename: `photo-${n}.jpg`,
    mimeType: "image/jpeg",
    size: 1000,
    width: 1600,
    height: 900,
    url: `/uploads/photo-${n}.jpg`,
    altText: `Photo ${n}`,
    folderId: null,
    uploadedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    uploadedBy: "u1",
    ...overrides,
  };
}

function renderLibrary() {
  api.fetchMedia.mockResolvedValue({
    data: [item(1), item(2), item(3)],
    meta: { total: 3, page: 1, limit: 24, totalPages: 1 },
  });
  return renderWithProviders(
    <MediaProvider>
      <MediaLibrary />
    </MediaProvider>
  );
}

const tile = (n: number) =>
  screen.getByRole("button", { name: new RegExp(`^photo-${n}\\.jpg`) });

beforeEach(() => {
  vi.clearAllMocks();
  held.slugs = new Set(EDITOR);
  // Grid view: the tiles are what these open.
  window.localStorage.setItem("nextly:admin:media:view-mode", "grid");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the media library toolbar", () => {
  it("holds search, type, sort, grid or list, and Upload in one row", async () => {
    renderLibrary();
    const toolbar = await screen.findByRole("group", {
      name: "Library controls",
    });

    expect(within(toolbar).getByRole("searchbox")).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("combobox", { name: "File type" })
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("combobox", { name: "Sort" })
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", { name: "Grid view" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(toolbar).getByRole("button", { name: "List view" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(toolbar).getByRole("button", { name: /Upload/ })
    ).toBeInTheDocument();
    // The page's title shares the row rather than taking one of its own.
    expect(
      within(toolbar).getByRole("heading", { name: "Media Library" })
    ).toBeInTheDocument();
  });

  it("offers no Upload to a reader", async () => {
    held.slugs = new Set(["read-media"]);
    renderLibrary();
    const toolbar = await screen.findByRole("group", {
      name: "Library controls",
    });
    // POSITIVE CONTROL: the row itself rendered.
    expect(within(toolbar).getByRole("searchbox")).toBeInTheDocument();
    expect(
      within(toolbar).queryByRole("button", { name: /Upload/ })
    ).toBeNull();
  });
});

describe("an item's details in the library", () => {
  it("opens beside the grid, and shows another item without the first being closed", async () => {
    renderLibrary();
    await screen.findByText("photo-1.jpg");

    fireEvent.click(tile(1));
    const panel = screen.getByRole("complementary", { name: "Media details" });
    expect(
      within(panel).getByRole("heading", { name: "photo-1.jpg" })
    ).toBeInTheDocument();
    // Beside the grid, not over it: the page is not hidden behind a modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tile(1)).toHaveAttribute("aria-current", "true");

    fireEvent.click(tile(2));
    expect(
      screen.getAllByRole("complementary", { name: "Media details" })
    ).toHaveLength(1);
    expect(
      within(panel).getByRole("heading", { name: "photo-2.jpg" })
    ).toBeInTheDocument();
    expect(tile(2)).toHaveAttribute("aria-current", "true");
    expect(tile(1)).not.toHaveAttribute("aria-current");
  });

  it("opens from the keyboard, moves with the arrows, and returns focus to the tile on Escape", async () => {
    renderLibrary();
    await screen.findByText("photo-1.jpg");

    tile(1).focus();
    fireEvent.keyDown(tile(1), { key: "Enter" });
    const heading = screen.getByRole("heading", { name: "photo-1.jpg" });
    expect(heading).toHaveFocus();

    fireEvent.keyDown(heading, { key: "ArrowRight" });
    expect(
      screen.getByRole("heading", { name: "photo-2.jpg" })
    ).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(
      screen.queryByRole("complementary", { name: "Media details" })
    ).toBeNull();
    // The tile of the item that was on screen, not the one that opened it.
    await waitFor(() => expect(tile(2)).toHaveFocus());
  });

  it("expands to the viewer, and Escape goes back to the panel with focus on Expand", async () => {
    renderLibrary();
    await screen.findByText("photo-1.jpg");
    fireEvent.click(tile(1));

    const expand = screen.getByRole("button", {
      name: "Expand to full screen",
    });
    expand.focus();
    fireEvent.click(expand);
    const viewer = screen.getByRole("dialog", { name: "photo-1.jpg" });

    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(
      screen.getByRole("dialog", { name: "photo-2.jpg" })
    ).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Back to the panel, following the viewer to the item it ended on.
    expect(
      screen.getByRole("heading", { name: "photo-2.jpg" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Expand to full screen" })
      ).toHaveFocus()
    );
  });

  it("saves the focus point to the item as percentages", async () => {
    api.updateMedia.mockResolvedValue(undefined);
    renderLibrary();
    await screen.findByText("photo-1.jpg");
    fireEvent.click(tile(1));

    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    const dot = screen.getByRole("slider", { name: "Focus point" });
    fireEvent.keyDown(dot, { key: "ArrowRight", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(api.updateMedia).toHaveBeenCalledWith("m1", {
        focalX: 60,
        focalY: 50,
      })
    );
  });

  it("shows a reader the details with nothing to edit, move or delete", async () => {
    held.slugs = new Set(["read-media"]);
    renderLibrary();
    await screen.findByText("photo-1.jpg");
    fireEvent.click(tile(1));
    const panel = screen.getByRole("complementary", { name: "Media details" });

    // POSITIVE CONTROL: the panel shows the item.
    expect(within(panel).getByText("Photo 1")).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: "Set focus point" })
    ).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Move to/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Delete/ })).toBeNull();
    // Nor can a reader tick tiles for the bulk actions.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
