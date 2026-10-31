/**
 * The media library's views, Used in, delete with Undo, and Replace, on the
 * whole page with the network stubbed:
 *
 * - a view lists its items across every folder through the same list
 *   request, with the same search, sort and paging, and Unused says the
 *   usage record is still being built rather than listing items;
 * - an item's details list where it is used, each a link, and count what
 *   the reader cannot open;
 * - Delete asks first with the uses, then offers Undo for ten seconds, one
 *   Undo for a bulk delete too, and says each in a polite live region;
 * - Replace swaps the file at once for the same kind, and asks first for
 *   another kind;
 * - a reader is offered neither Replace nor Delete.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  getFolderById: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  listRootFolders: vi.fn(() => Promise.resolve([])),
  listSubfolders: vi.fn(() => Promise.resolve([])),
  getFolderContents: vi.fn(),
  updateMedia: vi.fn(),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  uploadMedia: vi.fn(),
  createFolder: vi.fn(),
  getFolderById: (...a: unknown[]) => api.getFolderById(...a),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveMediaToFolder: vi.fn(),
  mediaFetchJson: vi.fn(),
}));

const library = vi.hoisted(() => ({
  fetchMediaLibraryCounts: vi.fn(),
  fetchMediaUsage: vi.fn(),
  deleteMediaLater: vi.fn(),
  undoMediaDelete: vi.fn(),
  replaceMediaFile: vi.fn(),
}));
vi.mock("../media-library-api", () => library);

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: toasts.toast,
}));

// The permissions the page is rendered with, by slug.
const held = vi.hoisted(() => ({ slugs: new Set<string>() }));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => held.slugs.has(slug),
}));

import { MediaProvider } from "@admin/context/providers/MediaProvider";

import { MediaLibrary } from "..";
import { setMediaLibraryView } from "../media-library-view";

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

const USED = {
  items: [
    {
      kind: "collection",
      slug: "posts",
      documentId: "p1",
      title: "Launch",
      owner: "Posts",
      fields: [
        {
          path: "cover",
          locales: [],
          byAddress: false,
          showsPreviousFile: false,
        },
        {
          path: "body",
          locales: ["en"],
          byAddress: true,
          showsPreviousFile: true,
        },
      ],
    },
    {
      kind: "single",
      slug: "site",
      documentId: "",
      title: "Site settings",
      owner: "Site settings",
      fields: [
        {
          path: "logo",
          locales: [],
          byAddress: false,
          showsPreviousFile: false,
        },
      ],
    },
  ],
  hidden: 1,
};

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

const announcer = () => screen.getByTestId("media-library-announcer");

async function openItem(n: number) {
  fireEvent.click(await waitFor(() => tile(n)));
  return screen.findByRole("complementary", { name: "Media details" });
}

/** The Undo of the toast a delete showed, pressed. */
function pressUndo(call = 0) {
  const [, options] = toasts.toast.mock.calls[call] as [
    string,
    { action: { onClick: () => void } },
  ];
  act(() => options.action.onClick());
}

beforeEach(() => {
  vi.clearAllMocks();
  held.slugs = new Set(EDITOR);
  window.localStorage.setItem("nextly:admin:media:view-mode", "grid");
  // Every use, or only the address uses, as the request asks; by default
  // nothing names the item by address.
  library.fetchMediaUsage.mockImplementation(
    (_id: string, options?: { byAddress?: boolean }) =>
      Promise.resolve(options?.byAddress ? { items: [], hidden: 0 } : USED)
  );
  library.fetchMediaLibraryCounts.mockResolvedValue({
    all: 3,
    missingAltText: 1,
    unused: 1,
    usageRecorded: true,
    root: 3,
    folders: {},
  });
  library.deleteMediaLater.mockImplementation((ids: string[]) =>
    Promise.resolve({ ids, deleteAfter: new Date().toISOString() })
  );
  library.undoMediaDelete.mockImplementation((ids: string[]) =>
    Promise.resolve({ restored: ids, gone: [] })
  );
  library.replaceMediaFile.mockResolvedValue(item(1));
});

afterEach(() => {
  window.localStorage.clear();
  act(() => setMediaLibraryView(null));
});

describe("a view beside the folders", () => {
  it("lists its items across every folder through the list's own search, sort and paging", async () => {
    act(() => setMediaLibraryView("missing-alt"));
    renderLibrary();

    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          view: "missing-alt",
          page: 1,
          limit: 24,
          sortBy: "uploadedAt",
          sortOrder: "desc",
          folderId: null,
        })
      )
    );
    expect(
      await screen.findByText("3 files missing alt text")
    ).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "logo");
    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ view: "missing-alt", search: "logo" })
      )
    );
  });

  it("asks for every item when no view is picked", async () => {
    renderLibrary();
    await waitFor(() => expect(api.fetchMedia).toHaveBeenCalled());
    expect(api.fetchMedia.mock.calls[0]?.[0]).toMatchObject({
      view: undefined,
    });
  });

  it("says Unused is still being built, rather than listing items content may use", async () => {
    library.fetchMediaLibraryCounts.mockResolvedValue({
      all: 3,
      missingAltText: 0,
      unused: 3,
      usageRecorded: false,
      root: 3,
      folders: {},
    });
    act(() => setMediaLibraryView("unused"));
    renderLibrary();

    expect(await screen.findByText(/still being recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^photo-1\.jpg/ })).toBeNull();
  });
});

describe("Used in", () => {
  it("lists each document using the item as a link, and counts what the reader cannot open", async () => {
    renderLibrary();
    const panel = await openItem(1);

    const usedIn = await within(panel).findByRole("region", {
      name: "Used in 3",
    });
    expect(library.fetchMediaUsage).toHaveBeenCalledWith("m1");
    expect(
      within(usedIn).getByRole("link", { name: /Launch/ })
    ).toHaveAttribute("href", "/admin/collections/posts/p1");
    expect(
      within(usedIn).getByRole("link", { name: /Site settings/ })
    ).toHaveAttribute("href", "/admin/singles/site");
    // The language is named only where only some languages use it.
    expect(within(usedIn).getByText("cover, body (EN)")).toBeInTheDocument();
    expect(
      within(usedIn).getByText("And 1 more place you can't open.")
    ).toBeInTheDocument();
    // The post's rich text still names the file the item had before.
    expect(
      within(within(usedIn).getByRole("link", { name: /Launch/ })).getByText(
        "Shows the previous file until it is edited"
      )
    ).toBeInTheDocument();
    expect(
      within(
        within(usedIn).getByRole("link", { name: /Site settings/ })
      ).queryByText(/previous file/)
    ).toBeNull();
  });
});

describe("delete with Undo", () => {
  it("asks first with where the item is used, then offers Undo for ten seconds", async () => {
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(within(panel).getByRole("button", { name: /Delete/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByText(/It's used in 3 places/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/undo this for a\s+few seconds/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /Launch/ })
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(library.deleteMediaLater).toHaveBeenCalledWith(["m1"])
    );
    expect(toasts.toast).toHaveBeenCalledWith(
      '"photo-1.jpg" deleted',
      expect.objectContaining({
        duration: 10_000,
        action: expect.objectContaining({ label: "Undo" }),
      })
    );
    expect(announcer()).toHaveTextContent(
      '"photo-1.jpg" deleted. You can undo this for 10 seconds.'
    );

    pressUndo();

    await waitFor(() =>
      expect(library.undoMediaDelete).toHaveBeenCalledWith(["m1"])
    );
    await waitFor(() =>
      expect(announcer()).toHaveTextContent('"photo-1.jpg" restored.')
    );
    expect(toasts.toast.success).toHaveBeenCalledWith('"photo-1.jpg" restored');
  });

  it("says when Undo came too late", async () => {
    library.undoMediaDelete.mockResolvedValue({ restored: [], gone: ["m1"] });
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(within(panel).getByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalled());

    pressUndo();

    await waitFor(() =>
      expect(toasts.toast.error).toHaveBeenCalledWith(
        "Too late to undo",
        expect.anything()
      )
    );
  });

  it("deletes a selection as one batch, with one Undo for all of it", async () => {
    renderLibrary();
    await waitFor(() => tile(1));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select photo-1.jpg" })
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select photo-2.jpg" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 selected items" })
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/undo this for a\s+few seconds/)
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(library.deleteMediaLater).toHaveBeenCalledWith(["m1", "m2"])
    );
    expect(library.deleteMediaLater).toHaveBeenCalledTimes(1);
    expect(toasts.toast).toHaveBeenCalledTimes(1);
    expect(toasts.toast).toHaveBeenCalledWith(
      "2 files deleted",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      })
    );

    pressUndo();
    await waitFor(() =>
      expect(library.undoMediaDelete).toHaveBeenCalledWith(["m1", "m2"])
    );
  });
});

describe("Replace", () => {
  it("replaces a file of the same kind at once, keeping the item", async () => {
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(
      within(panel).getByRole("button", { name: /Replace file/ })
    );

    const file = new File(["x"], "new-photo.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("media-replace-input"), file);

    await waitFor(() =>
      expect(library.replaceMediaFile).toHaveBeenCalledWith("m1", file)
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Replaced the file of photo-1.jpg.")
    );
  });

  it("asks before an image is replaced by another kind of file", async () => {
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(
      within(panel).getByRole("button", { name: /Replace file/ })
    );

    const pdf = new File(["%PDF"], "brochure.pdf", {
      type: "application/pdf",
    });
    await userEvent.upload(screen.getByTestId("media-replace-input"), pdf);

    const ask = await screen.findByRole("alertdialog", {
      name: "Replace an image with a document?",
    });
    expect(
      within(ask).getByText(/alt text and focus point/)
    ).toBeInTheDocument();
    expect(library.replaceMediaFile).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(library.replaceMediaFile).toHaveBeenCalledWith("m1", pdf)
    );
  });
});

describe("Replace with pages naming the item by address", () => {
  it("says which keep the previous image, before replacing", async () => {
    library.fetchMediaUsage.mockImplementation(
      (_id: string, options?: { byAddress?: boolean }) =>
        Promise.resolve(
          options?.byAddress ? { items: [USED.items[0]], hidden: 1 } : USED
        )
    );
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(
      within(panel).getByRole("button", { name: /Replace file/ })
    );
    const file = new File(["x"], "new-photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByTestId("media-replace-input"), file);

    const ask = await screen.findByRole("alertdialog", {
      name: "Replace photo-1.jpg?",
    });
    expect(library.fetchMediaUsage).toHaveBeenCalledWith("m1", {
      byAddress: true,
    });
    expect(ask).toHaveTextContent(
      "2 places show this image by its address (rich text and email templates) and keep the previous image until they're edited."
    );
    // Listed as Used in lists them: the readable one named, the other counted.
    expect(
      within(ask).getByRole("link", { name: /Launch/ })
    ).toBeInTheDocument();
    expect(
      within(ask).getByText("And 1 more place you can't open.")
    ).toBeInTheDocument();
    expect(library.replaceMediaFile).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(library.replaceMediaFile).toHaveBeenCalledWith("m1", file)
    );
  });
});

describe("a reader", () => {
  it("sees where an item is used, and is offered neither Replace nor Delete", async () => {
    held.slugs = new Set(["read-media"]);
    renderLibrary();
    const panel = await openItem(1);

    // POSITIVE CONTROL: the details and their read-only actions rendered.
    expect(
      await within(panel).findByRole("region", { name: "Used in 3" })
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /Copy URL/ })
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /Replace file/ })
    ).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByTestId("media-replace-input")).toBeNull();
  });
});
