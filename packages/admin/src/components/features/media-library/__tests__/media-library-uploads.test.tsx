/**
 * Uploads in the media library: files dropped anywhere on the page, or chosen
 * with Upload, go into the folder on screen through one queue, and the tray
 * lists each with its progress.
 *
 * These render the whole page with the network stubbed and every upload
 * HELD, answered one at a time by the test, because the properties are about
 * timing: no more than three requests are open at once, a fourth starts only
 * when one of those finishes, and a failure or a refusal leaves the rest
 * moving. A queue that sent everything at once, or one at a time, would show
 * the same eight rows; only the count of open requests tells them apart.
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
import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

const MB = 1024 * 1024;

/** An upload the test answers: its file, folder and progress callback. */
interface HeldUpload {
  file: File;
  folderId: string | null | undefined;
  onProgress?: (progress: number) => void;
  resolve: (media: unknown) => void;
  reject: (error: Error) => void;
}

const api = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  uploadMedia: vi.fn(),
  listRootFolders: vi.fn(),
  getFolderContents: vi.fn(),
  getFolderById: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  listRootFolders: (...a: unknown[]) => api.listRootFolders(...a),
  listSubfolders: vi.fn(() => Promise.resolve([])),
  getFolderContents: (...a: unknown[]) => api.getFolderContents(...a),
  updateMedia: vi.fn(),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  uploadMedia: (...a: unknown[]) => api.uploadMedia(...a),
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
const READER = ["read-media"];

const BRAND = {
  id: "f1",
  name: "Brand",
  parentId: null,
  createdBy: "u1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

let uploads: HeldUpload[] = [];
// The most requests that were open at the same moment.
let open = 0;
let mostOpen = 0;

function holdUploads(): void {
  uploads = [];
  open = 0;
  mostOpen = 0;
  api.uploadMedia.mockImplementation(
    (
      file: File,
      onProgress?: (progress: number) => void,
      folderId?: string | null
    ) =>
      new Promise((resolve, reject) => {
        open += 1;
        mostOpen = Math.max(mostOpen, open);
        const settle =
          <T,>(fn: (value: T) => void) =>
          (value: T) => {
            open -= 1;
            fn(value);
          };
        uploads.push({
          file,
          folderId,
          onProgress,
          resolve: settle(resolve),
          reject: settle(reject),
        });
      })
  );
}

function png(name: string, size = 1000): File {
  const file = new File(["x"], name, { type: "image/png" });
  // The size is what the limit reads; the content doesn't matter here.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function media(file: File) {
  return {
    id: `id-${file.name}`,
    filename: file.name,
    originalFilename: file.name,
    mimeType: file.type,
    size: file.size,
    url: `/uploads/${file.name}`,
    folderId: null,
    uploadedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    uploadedBy: "u1",
  };
}

function renderLibrary() {
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

/** A drag carrying files from outside the page, as the browser reports it. */
function filesDrag(files: File[]) {
  return { dataTransfer: { files, types: ["Files"] } };
}

/** Drops `files` on `target`, which is somewhere on the library's page. */
async function dropOn(target: HTMLElement, files: File[]): Promise<void> {
  // React Dropzone reads a drag's files asynchronously, so the drop waits for
  // the overlay, as a person's drop always comes after it is drawn.
  fireEvent.dragEnter(target, filesDrag(files));
  await screen.findByText(/^Drop to upload to/);
  fireEvent.drop(target, filesDrag(files));
  await waitFor(() => expect(screen.getByLabelText("Uploads")).toBeVisible());
}

const tray = () => screen.getByRole("region", { name: "Uploads" });
const row = (name: string) =>
  within(tray())
    .getAllByRole("listitem")
    .find(item => within(item).queryByText(name) !== null) as HTMLElement;
const liveRegion = () =>
  screen
    .getAllByRole("status")
    .find(element => element.getAttribute("aria-live") === "polite")!;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  held.slugs = new Set(EDITOR);
  api.listRootFolders.mockResolvedValue([]);
  holdUploads();
});

describe("the drop overlay", () => {
  it("covers the page while files are dragged over it, saying where they go and what it takes", async () => {
    renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });
    expect(screen.queryByText(/^Drop to upload to/)).toBeNull();

    fireEvent.dragEnter(heading, filesDrag([png("a.png")]));
    expect(
      await screen.findByText("Drop to upload to Media Library")
    ).toBeVisible();
    // The size the server takes is stated before anything is sent.
    expect(screen.getByText(/up to 10 MB$/)).toBeVisible();

    fireEvent.dragLeave(heading, filesDrag([png("a.png")]));
    await waitFor(() =>
      expect(screen.queryByText(/^Drop to upload to/)).toBeNull()
    );
  });

  it("uploads what is dropped into the folder on screen", async () => {
    api.listRootFolders.mockResolvedValue([BRAND]);
    api.getFolderContents.mockResolvedValue({
      folder: BRAND,
      subfolders: [],
      files: [],
      breadcrumbs: [{ id: "f1", name: "Brand" }],
    });
    api.getFolderById.mockResolvedValue(BRAND);
    renderLibrary();
    await userEvent.click(
      await screen.findByRole("button", { name: /^Brand/ })
    );
    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ folderId: "f1" })
      )
    );

    const heading = screen.getByRole("heading", { name: "Media Library" });
    fireEvent.dragEnter(heading, filesDrag([png("logo.png")]));
    expect(await screen.findByText("Drop to upload to Brand")).toBeVisible();

    await dropOn(heading, [png("logo.png")]);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].file.name).toBe("logo.png");
    expect(uploads[0].folderId).toBe("f1");
    // The overlay is gone once the files have landed.
    expect(screen.queryByText(/^Drop to upload to/)).toBeNull();
  });

  it("ignores a drag that carries no files, such as one from inside the page", async () => {
    renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });

    // Text or a link dragged across the page: no files in it.
    fireEvent.dragEnter(heading, {
      dataTransfer: { files: [], types: ["text/plain", "text/uri-list"] },
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(screen.queryByText(/^Drop to upload to/)).toBeNull();
    // An image dragged off this page, which a browser may offer as a file:
    // the drag started here, so it is not an upload.
    fireEvent.dragStart(heading);
    fireEvent.dragEnter(heading, filesDrag([png("tile.png")]));
    fireEvent.drop(heading, filesDrag([png("tile.png")]));

    // POSITIVE CONTROL: the same files from outside the page are taken once
    // the page's own drag has ended.
    fireEvent.dragEnd(heading);
    fireEvent.dragEnter(heading, filesDrag([png("outside.png")]));
    expect(
      await screen.findByText("Drop to upload to Media Library")
    ).toBeVisible();
    fireEvent.drop(heading, filesDrag([png("outside.png")]));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].file.name).toBe("outside.png");
  });

  it("gives a reader no drop target and no Upload", async () => {
    held.slugs = new Set(READER);
    const { container } = renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });

    fireEvent.dragEnter(heading, filesDrag([png("a.png")]));
    fireEvent.drop(heading, filesDrag([png("a.png")]));
    // Give a drop the turn React Dropzone needs to read its files.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByText(/^Drop to upload to/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
  });
});

describe("the upload tray", () => {
  it("lists eight files, uploads three at a time and queues the rest", async () => {
    renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });
    const files = Array.from({ length: 8 }, (_, i) =>
      png(`photo-${i + 1}.png`)
    );

    await dropOn(heading, files);

    // Every file has a row at once; three are sent and five wait.
    expect(within(tray()).getAllByRole("listitem")).toHaveLength(8);
    await waitFor(() => expect(uploads).toHaveLength(3));
    expect(within(tray()).getAllByText("Waiting")).toHaveLength(5);
    expect(
      within(tray()).getByRole("heading", { name: "Uploading 0 of 8" })
    ).toBeVisible();
    expect(liveRegion()).toHaveTextContent("Uploading 0 of 8");

    // A file's progress shows on its own row.
    act(() => uploads[0].onProgress?.(40));
    expect(within(row("photo-1.png")).getByText("40%")).toBeVisible();
    expect(
      within(row("photo-1.png")).getByRole("progressbar", {
        name: "Uploading photo-1.png: 40%",
      })
    ).toBeVisible();

    // One finishing opens one slot, and the next waiting file takes it.
    act(() => uploads[0].resolve(media(uploads[0].file)));
    await waitFor(() => expect(uploads).toHaveLength(4));
    expect(uploads[3].file.name).toBe("photo-4.png");
    expect(within(row("photo-1.png")).getByText("Done")).toBeVisible();

    // Answer the rest as they are sent.
    for (let answered = 1; answered < 8; answered += 1) {
      await waitFor(() => expect(uploads.length).toBeGreaterThan(answered));
      const upload = uploads[answered];
      act(() => upload.resolve(media(upload.file)));
    }

    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent("Upload finished. 8 uploaded.")
    );
    expect(uploads).toHaveLength(8);
    expect(mostOpen).toBe(3);
    expect(
      within(tray()).getByRole("heading", { name: "8 uploaded" })
    ).toBeVisible();
  });

  it("shows a failure's reason with Retry and a refusal's reason without, and keeps the rest moving", async () => {
    renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });
    const tooLarge = png("poster.png", 11 * MB);
    const notAllowed = new File(["x"], "setup.exe", {
      type: "application/x-msdownload",
    });
    const files = [
      png("photo-1.png"),
      png("photo-2.png"),
      tooLarge,
      png("photo-3.png"),
      notAllowed,
      png("photo-4.png"),
      png("photo-5.png"),
      png("photo-6.png"),
    ];

    await dropOn(heading, files);

    // The refused files are never sent, and say why at once.
    expect(
      within(row("poster.png")).getByText("File is too large (max 10 MB)")
    ).toBeVisible();
    expect(
      within(row("setup.exe")).getByText("File type is not supported")
    ).toBeVisible();
    expect(
      within(row("poster.png")).queryByRole("button", { name: /Retry/ })
    ).toBeNull();

    // The first one sent fails at the server; the others carry on.
    await waitFor(() => expect(uploads).toHaveLength(3));
    act(() => uploads[0].reject(new Error("Storage is full.")));
    for (let answered = 1; answered < 6; answered += 1) {
      await waitFor(() => expect(uploads.length).toBeGreaterThan(answered));
      const upload = uploads[answered];
      act(() => upload.resolve(media(upload.file)));
    }

    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent(
        "Upload finished. 5 uploaded, 1 failed, 2 refused."
      )
    );
    const failed = row("photo-1.png");
    expect(within(failed).getByText("Storage is full.")).toBeVisible();
    expect(uploads.map(upload => upload.file.name)).not.toContain("poster.png");
    expect(uploads.map(upload => upload.file.name)).not.toContain("setup.exe");

    // Retry sends the same file again, on its own.
    await userEvent.click(
      within(failed).getByRole("button", { name: "Retry photo-1.png" })
    );
    await waitFor(() => expect(uploads).toHaveLength(7));
    expect(uploads[6].file).toBe(files[0]);
    act(() => uploads[6].resolve(media(uploads[6].file)));
    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent(
        "Upload finished. 6 uploaded, 2 refused."
      )
    );
    expect(within(row("photo-1.png")).getByText("Done")).toBeVisible();
  });

  it("stays until it is closed, by a Close the keyboard reaches, and lifts the toasts above it meanwhile", async () => {
    // A clock the test moves, installed before any timer a closing tray
    // could set; it still runs on its own, so the page's waits keep working.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLibrary();
    const heading = await screen.findByRole("heading", {
      name: "Media Library",
    });
    const toastOffset = () =>
      document.documentElement.style.getPropertyValue(
        TOAST_OFFSET_BOTTOM_PROPERTY
      );
    expect(toastOffset()).toBe("");

    await dropOn(heading, [png("a.png"), png("b.png")]);
    // While the tray is open the toaster's bottom edge clears it.
    expect(toastOffset()).toMatch(/^calc\(\d+(\.\d+)?px \+ 1\.5rem\)$/);
    await waitFor(() => expect(uploads).toHaveLength(2));
    for (const upload of uploads) {
      act(() => upload.resolve(media(upload.file)));
    }
    await waitFor(() =>
      expect(liveRegion()).toHaveTextContent("Upload finished. 2 uploaded.")
    );

    // Well past any moment a tray might close itself, it is still there,
    // saying how it went.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      within(tray()).getByRole("heading", { name: "2 uploaded" })
    ).toBeVisible();

    // Close is the last stop in the page's tab order: Shift+Tab from the
    // start of the document lands on it, and it carries the focus ring.
    const close = within(tray()).getByRole("button", { name: "Close uploads" });
    expect(close.className).toMatch(/focus-visible:ring/);
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    // Focus goes to the page's heading rather than being dropped, and the
    // toasts go back to their corner.
    expect(heading).toHaveFocus();
    expect(toastOffset()).toBe("");
  });

  it("takes files chosen with Upload the same way", async () => {
    const { container } = renderLibrary();
    // The chooser is the browser's own; what the page can show is that Upload
    // asked the file input to open it.
    const openChooser = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    await userEvent.click(
      await screen.findByRole("button", { name: "Upload files" })
    );
    expect(openChooser).toHaveBeenCalledTimes(1);
    openChooser.mockRestore();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [png("chosen.png")] } });

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].file.name).toBe("chosen.png");
    expect(uploads[0].folderId).toBeNull();
    expect(within(tray()).getAllByRole("listitem")).toHaveLength(1);
  });
});
