/**
 * The media library's views, Used in, delete with Undo, and Replace, on the
 * whole page with the network stubbed:
 *
 * - a view lists its items across every folder through the same list
 *   request, with the same search, sort and paging, and Unused says the
 *   usage record is still being built rather than listing items;
 * - an item's details list where it is used, each a link, and count what
 *   the reader cannot open;
 * - Delete asks first with the uses, then offers Undo for what is left of
 *   the server's window, none once it has ended, one Undo for a bulk delete
 *   too, and says each in a polite live region;
 * - switching views never shows the previous view's items while the new
 *   ones load;
 * - Replace swaps the file at once for the same kind, and asks first for
 *   another kind, for an avatar or a logo keeping the address, and while the
 *   usage record is still being built;
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

import {
  createTestQueryClient,
  renderWithProviders,
} from "@admin/__tests__/utils";

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
  total: 3,
  hasNext: false,
  heldByAddress: 0,
  usageRecorded: true,
};

/** The uses by address, as `fetchMediaUsage` reads them. */
function byAddress(
  items: unknown[],
  hidden: number,
  extra: { heldByAddress?: number; usageRecorded?: boolean } = {}
) {
  return {
    items,
    hidden,
    total: items.length + hidden,
    hasNext: false,
    heldByAddress: extra.heldByAddress ?? 0,
    usageRecorded: extra.usageRecorded ?? true,
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
      Promise.resolve(options?.byAddress ? byAddress([], 0) : USED)
  );
  library.fetchMediaLibraryCounts.mockResolvedValue({
    all: 3,
    missingAltText: 1,
    unused: 1,
    usageRecorded: true,
    root: 3,
    folders: {},
  });
  // The server's window, from the moment it answers.
  library.deleteMediaLater.mockImplementation((ids: string[]) =>
    Promise.resolve({
      ids,
      marked: ids,
      deleteAfter: new Date(Date.now() + 10_000).toISOString(),
      markedDeleteAfter: new Date(Date.now() + 10_000).toISOString(),
    })
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

  it("never shows the previous view's items while the new view loads", async () => {
    renderLibrary();
    await waitFor(() => tile(1));
    // The new view's request is held: nothing answers it.
    api.fetchMedia.mockImplementation(() => new Promise(() => undefined));

    act(() => setMediaLibraryView("missing-alt"));

    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ view: "missing-alt" })
      )
    );
    expect(screen.queryByRole("button", { name: /^photo-1\.jpg/ })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Select photo-1.jpg" })
    ).toBeNull();
  });

  /** The list's answer, saying `usageRecorded` when given. */
  function listAnswer(usageRecorded?: boolean) {
    return {
      data: [item(1), item(2), item(3)],
      meta: {
        total: 3,
        page: 1,
        limit: 24,
        totalPages: 1,
        ...(usageRecorded === undefined ? {} : { usageRecorded }),
      },
    };
  }

  /** Unused picked, with its list answered by `list`. */
  async function unusedListing(list: () => Promise<unknown>) {
    api.fetchMedia.mockImplementation(list);
    act(() => setMediaLibraryView("unused"));
    renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );
    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenCalledWith(
        expect.objectContaining({ view: "unused" })
      )
    );
  }

  /** No item of the list is on screen, nor any control acting on one. */
  function noUnusedItemsShown() {
    expect(screen.queryByRole("button", { name: /^photo-1\.jpg/ })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Select photo-1.jpg" })
    ).toBeNull();
  }

  it("says Unused is still being built, rather than listing items content may use", async () => {
    await unusedListing(() => Promise.resolve(listAnswer(false)));

    expect(await screen.findByText(/still being recorded/)).toBeInTheDocument();
    noUnusedItemsShown();
  });

  // The list answers for the build it read itself. The counts are another
  // request, read at another moment: a rebuild between the two would let
  // their word open a list read while the record was being rebuilt.
  it("lists nothing in Unused when its own list says the record was being rebuilt, whatever the counts say", async () => {
    // The counts say built (the default); the list itself does not.
    await unusedListing(() => Promise.resolve(listAnswer(false)));

    expect(await screen.findByText(/still being recorded/)).toBeInTheDocument();
    noUnusedItemsShown();
  });

  it("lists nothing in Unused when its list says nothing of the record", async () => {
    await unusedListing(() => Promise.resolve(listAnswer()));

    expect(await screen.findByText(/still being recorded/)).toBeInTheDocument();
    noUnusedItemsShown();
  });

  it("lists Unused once its own list says the usage record is built, though the counts never answer", async () => {
    // POSITIVE CONTROL for the cases above: the list's word alone opens it.
    library.fetchMediaLibraryCounts.mockReturnValue(
      new Promise(() => undefined)
    );
    await unusedListing(() => Promise.resolve(listAnswer(true)));

    expect(await waitFor(() => tile(1))).toBeInTheDocument();
  });

  describe("once its list has said the record is built", () => {
    /**
     * Unused open on a built answer, then its list asked again, answered by
     * `next` (made when asked, so a refusal is never left unhandled).
     */
    async function askedAgain(next: () => Promise<unknown>) {
      const queryClient = createTestQueryClient();
      api.fetchMedia.mockResolvedValue(listAnswer(true));
      act(() => setMediaLibraryView("unused"));
      renderWithProviders(
        <MediaProvider>
          <MediaLibrary />
        </MediaProvider>,
        { queryClient }
      );
      // POSITIVE CONTROL: the built answer opens the view.
      expect(await waitFor(() => tile(1))).toBeInTheDocument();
      api.fetchMedia.mockImplementation(next);
      act(() => {
        void queryClient
          .refetchQueries({ queryKey: ["media"] })
          .catch(() => undefined);
      });
    }

    it("lists nothing while its list is asked again", async () => {
      await askedAgain(() => new Promise(() => undefined));

      expect(
        await screen.findByText(/still counting where items are used/i)
      ).toBeInTheDocument();
      noUnusedItemsShown();
    });

    it("lists nothing when its list asked again says the record is being rebuilt", async () => {
      await askedAgain(() => Promise.resolve(listAnswer(false)));

      expect(
        await screen.findByText(/still being recorded/)
      ).toBeInTheDocument();
      noUnusedItemsShown();
    });

    it("lists nothing when asking its list again fails", async () => {
      await askedAgain(() => Promise.reject(new Error("list failed")));

      // The page shows the failure in place of the list.
      expect(await screen.findByText("list failed")).toBeInTheDocument();
      noUnusedItemsShown();
    });
  });
});

describe("Used in", () => {
  it("lists each document using the item as a link, and counts what the reader cannot open", async () => {
    renderLibrary();
    const panel = await openItem(1);

    const usedIn = await within(panel).findByRole("region", {
      name: "Used in 3",
    });
    expect(library.fetchMediaUsage).toHaveBeenCalledWith("m1", { page: 1 });
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

describe("Used in, before the usage record is built", () => {
  /** Item 1's Used in, its uses answered with none and `usageRecorded`. */
  async function usedInWithNoUses(usageRecorded: boolean) {
    library.fetchMediaUsage.mockResolvedValue(
      byAddress([], 0, { usageRecorded })
    );
    renderLibrary();
    const panel = await openItem(1);
    return within(panel).findByRole("region", { name: /^Used in/ });
  }

  it("says an item listing no use may still be used while the record is being built", async () => {
    const usedIn = await usedInWithNoUses(false);

    expect(
      await within(usedIn).findByText(
        "The usage record is still being built, so this may still be used."
      )
    ).toBeInTheDocument();
    expect(within(usedIn).queryByText(/Not used anywhere/)).toBeNull();
  });

  it("says an item listing no use is not used once the record is built", async () => {
    // POSITIVE CONTROL for the one above.
    const usedIn = await usedInWithNoUses(true);

    expect(
      await within(usedIn).findByText("Not used anywhere yet.")
    ).toBeInTheDocument();
  });
});

describe("delete with Undo", () => {
  it("asks first with where the item is used, then offers Undo until the server's deadline", async () => {
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
    // Offered until the server's deadline, ten seconds after it answered.
    expect(toasts.toast).toHaveBeenCalledWith(
      '"photo-1.jpg" deleted',
      expect.objectContaining({
        duration: expect.closeTo(10_000, -3),
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

  /** Delete item 1 through its details, answered `lateBy` after marking. */
  async function deleteAnsweredLate(lateBy: number) {
    library.deleteMediaLater.mockImplementation((ids: string[]) => {
      const deleteAfter = new Date(Date.now() + 10_000).toISOString();
      // The answer reaches the page `lateBy` after the server marked it.
      vi.setSystemTime(Date.now() + lateBy);
      return Promise.resolve({
        ids,
        marked: ids,
        deleteAfter,
        markedDeleteAfter: deleteAfter,
      });
    });
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(within(panel).getByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalled());
  }

  it("offers Undo for only what is left of the server's window when the answer is slow", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await deleteAnsweredLate(6_000);

      expect(toasts.toast).toHaveBeenCalledWith(
        '"photo-1.jpg" deleted',
        expect.objectContaining({
          duration: 4_000,
          action: expect.objectContaining({ label: "Undo" }),
        })
      );
      expect(announcer()).toHaveTextContent(
        '"photo-1.jpg" deleted. You can undo this for 4 seconds.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no Undo once the server's window has already ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await deleteAnsweredLate(11_000);

      const [title, options] = toasts.toast.mock.calls[0] as [
        string,
        { action?: unknown } | undefined,
      ];
      expect(title).toBe('"photo-1.jpg" deleted');
      expect(options?.action).toBeUndefined();
      expect(announcer().textContent).toBe('"photo-1.jpg" deleted.');
    } finally {
      vi.useRealTimers();
    }
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

  // An item an earlier delete marked goes at that delete's deadline, which
  // is what `deleteAfter` answers for the whole request. Undo here takes back
  // only this delete's own items, whose window began with this delete.
  it("offers Undo for this delete's own items until their own deadline, though an item already waiting goes sooner", async () => {
    library.deleteMediaLater.mockImplementation((ids: string[]) =>
      Promise.resolve({
        ids,
        // m1 was marked by an earlier delete whose window has just ended.
        marked: ids.filter(id => id !== "m1"),
        deleteAfter: new Date(Date.now() - 1_000).toISOString(),
        markedDeleteAfter: new Date(Date.now() + 10_000).toISOString(),
      })
    );
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalled());

    expect(toasts.toast).toHaveBeenCalledWith(
      "2 files deleted",
      expect.objectContaining({
        duration: expect.closeTo(10_000, -3),
        action: expect.objectContaining({ label: "Undo" }),
      })
    );
    pressUndo();
    await waitFor(() =>
      expect(library.undoMediaDelete).toHaveBeenCalledWith(["m2"])
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
          options?.byAddress ? byAddress([USED.items[0]], 1) : USED
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

describe("Replace with an avatar or a logo keeping the address", () => {
  /** Choose a file of the same kind for item 1. */
  async function replaceItemOne() {
    renderLibrary();
    const panel = await openItem(1);
    fireEvent.click(
      within(panel).getByRole("button", { name: /Replace file/ })
    );
    const file = new File(["x"], "new-photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByTestId("media-replace-input"), file);
    return file;
  }

  it("counts them among the places keeping the previous image", async () => {
    library.fetchMediaUsage.mockImplementation(
      (_id: string, options?: { byAddress?: boolean }) =>
        Promise.resolve(
          options?.byAddress ? byAddress([], 0, { heldByAddress: 1 }) : USED
        )
    );
    const file = await replaceItemOne();

    const ask = await screen.findByRole("alertdialog", {
      name: "Replace photo-1.jpg?",
    });
    expect(ask).toHaveTextContent(
      "1 place shows this image by its address (avatars and logos) and keeps the previous image until it's edited."
    );
    expect(library.replaceMediaFile).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(library.replaceMediaFile).toHaveBeenCalledWith("m1", file)
    );
  });

  it("names every kind when content and an avatar both keep it", async () => {
    library.fetchMediaUsage.mockImplementation(
      (_id: string, options?: { byAddress?: boolean }) =>
        Promise.resolve(
          options?.byAddress
            ? byAddress([USED.items[0]], 0, { heldByAddress: 2 })
            : USED
        )
    );
    await replaceItemOne();

    expect(
      await screen.findByRole("alertdialog", { name: "Replace photo-1.jpg?" })
    ).toHaveTextContent(
      "3 places show this image by its address (rich text, email templates, avatars and logos) and keep the previous image until they're edited."
    );
  });

  it("says the previous file is kept while the usage record is still being built", async () => {
    library.fetchMediaUsage.mockImplementation(
      (_id: string, options?: { byAddress?: boolean }) =>
        Promise.resolve(
          options?.byAddress ? byAddress([], 0, { usageRecorded: false }) : USED
        )
    );
    await replaceItemOne();

    const ask = await screen.findByRole("alertdialog", {
      name: "Replace photo-1.jpg?",
    });
    expect(ask).toHaveTextContent(
      "The usage record is still being built, so the previous file is kept."
    );
    expect(library.replaceMediaFile).not.toHaveBeenCalled();
  });
});

describe("Replace when the uses by address cannot be read", () => {
  it("asks first, saying it could not check, and keeps nothing from the person", async () => {
    library.fetchMediaUsage.mockImplementation(
      (_id: string, options?: { byAddress?: boolean }) =>
        options?.byAddress
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(USED)
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
    expect(ask).toHaveTextContent(
      "Couldn't check whether rich text or email templates show this image by its address. Any that do keep the previous image until they're edited."
    );
    expect(ask).not.toHaveTextContent("usage record is still being built");
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
