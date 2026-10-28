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
import userEvent from "@testing-library/user-event";
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

describe("the media library toolbar on a narrow row", () => {
  it("offers type, sort and, in the list view, Columns from one View options menu", async () => {
    window.localStorage.setItem("nextly:admin:media:view-mode", "list");
    renderLibrary();
    const toolbar = await screen.findByRole("group", {
      name: "Library controls",
    });

    await userEvent.click(
      within(toolbar).getByRole("button", { name: "View options" })
    );
    expect(
      screen.getByRole("menuitemradio", { name: "All types" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "Newest First" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Dimensions" })
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "Images" })
    );
    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "image" })
      )
    );
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

/** The element in the list view that stands for an item: its row or card. */
const listEntry = (name: string) => {
  const entry = screen.getAllByText(name)[0].closest("[role='button']");
  if (!(entry instanceof HTMLElement)) throw new Error(`no entry for ${name}`);
  return entry;
};

describe("an item's details in the list view", () => {
  beforeEach(() => {
    window.localStorage.setItem("nextly:admin:media:view-mode", "list");
  });

  it("returns focus on close to the entry of the item on screen, not the one that opened it", async () => {
    renderLibrary();
    await screen.findAllByText("photo-1.jpg");

    const opener = listEntry("photo-1.jpg");
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole("complementary", { name: "Media details" });
    fireEvent.click(within(panel).getByRole("button", { name: "Next file" }));
    // POSITIVE CONTROL: the panel moved on, so the two entries differ.
    expect(
      within(panel).getByRole("heading", { name: "photo-2.jpg" })
    ).toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole("button", { name: "Close details" })
    );

    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("photo-2.jpg")
    );
  });

  it("draws each thumbnail from the same choice the grid's tiles make", async () => {
    api.fetchMedia.mockResolvedValue({
      data: [
        item(1, {
          thumbnailUrl: "/uploads/thumb_photo-1.jpg",
          sizes: {
            small: {
              url: "/uploads/photo-1-small.jpg",
              width: 320,
              height: 180,
            },
          },
        }),
      ],
      meta: { total: 1, page: 1, limit: 24, totalPages: 1 },
    });
    renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );

    const thumbnails = await screen.findAllByRole("img", { name: "Photo 1" });
    // POSITIVE CONTROL: the list did draw the thumbnail.
    expect(thumbnails.length).toBeGreaterThan(0);
    for (const thumbnail of thumbnails) {
      // The whole-image size, not the square thumbnail cut from the middle.
      expect(thumbnail).toHaveAttribute("src", "/uploads/photo-1-small.jpg");
    }
  });
});

describe("the library with nothing in it", () => {
  function renderEmpty() {
    api.fetchMedia.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 24, totalPages: 0 },
    });
    return renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );
  }

  for (const view of ["grid", "list"] as const) {
    it(`points an uploader at Upload in the ${view} view`, async () => {
      window.localStorage.setItem("nextly:admin:media:view-mode", view);
      renderEmpty();
      const empty = await screen.findByRole("status", {
        name: "No media files",
      });
      expect(empty).toHaveTextContent(/Upload files/);
    });

    it(`doesn't tell a reader to upload in the ${view} view`, async () => {
      window.localStorage.setItem("nextly:admin:media:view-mode", view);
      held.slugs = new Set(["read-media"]);
      renderEmpty();
      const empty = await screen.findByRole("status", {
        name: "No media files",
      });
      // POSITIVE CONTROL: the empty state says something.
      expect(empty).toHaveTextContent(/No media files found/);
      expect(empty).not.toHaveTextContent(/upload/i);
    });
  }
});
