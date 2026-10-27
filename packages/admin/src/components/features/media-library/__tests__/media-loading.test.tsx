/**
 * The media page asks the server only for what it shows. Before, the folder
 * tree sent two requests per folder on every visit, one of them downloading
 * every file in the folder to draw a count it then got wrong, and the root's
 * contents were fetched just to read a folder name the root doesn't have.
 * These pin the request counts, and the file count the delete dialog shows,
 * which read a key the server never sends and so always said 0.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listRootFolders: vi.fn(),
  listSubfolders: vi.fn(),
  getFolderContents: vi.fn(),
  fetchMedia: vi.fn(),
  updateMedia: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  listRootFolders: (...a: unknown[]) => api.listRootFolders(...a),
  listSubfolders: (...a: unknown[]) => api.listSubfolders(...a),
  getFolderContents: (...a: unknown[]) => api.getFolderContents(...a),
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  updateMedia: (...a: unknown[]) => api.updateMedia(...a),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  uploadMedia: vi.fn(),
  createFolder: vi.fn(),
  getFolderById: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveMediaToFolder: vi.fn(),
}));

import {
  useFolderContents,
  useMedia,
  useUpdateMedia,
} from "@admin/hooks/queries/useMedia";

import { DeleteFolderDialog } from "../DeleteFolderDialog";
import { FolderTreeView } from "../FolderTreeView";

let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function folder(id: string, name: string) {
  return {
    id,
    name,
    parentId: null,
    createdBy: "u1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("folder tree", () => {
  const props = {
    activeFolderId: null,
    onFolderSelect: vi.fn(),
    onCreateFolder: vi.fn(),
    onEditFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  };

  it("lists the folders without asking for any folder's subfolders or contents", async () => {
    api.listRootFolders.mockResolvedValue([
      folder("f1", "Blog"),
      folder("f2", "Products"),
      folder("f3", "Team"),
    ]);

    render(<FolderTreeView {...props} />, { wrapper: Wrapper });
    await screen.findByText("Team");

    expect(api.listSubfolders).not.toHaveBeenCalled();
    expect(api.getFolderContents).not.toHaveBeenCalled();
  });

  it("asks for a folder's subfolders when it is opened, and only that folder's", async () => {
    api.listRootFolders.mockResolvedValue([
      folder("f1", "Blog"),
      folder("f2", "Products"),
    ]);
    api.listSubfolders.mockResolvedValue([folder("f9", "2026")]);

    render(<FolderTreeView {...props} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByText("Blog"));

    expect(await screen.findByText("2026")).toBeInTheDocument();
    expect(api.listSubfolders).toHaveBeenCalledTimes(1);
    expect(api.listSubfolders).toHaveBeenCalledWith("f1");
    expect(api.getFolderContents).not.toHaveBeenCalled();
  });

  it("closes an opened folder that turns out to have no subfolders", async () => {
    api.listRootFolders.mockResolvedValue([folder("f1", "Blog")]);
    api.listSubfolders.mockResolvedValue([]);

    render(<FolderTreeView {...props} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByText("Blog"));
    expect(await screen.findByText("No subfolders")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Blog"));

    expect(screen.queryByText("No subfolders")).not.toBeInTheDocument();
  });

  it("says when a folder's subfolders could not load, and asks again on retry", async () => {
    api.listRootFolders.mockResolvedValue([folder("f1", "Blog")]);
    api.listSubfolders
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([folder("f9", "2026")]);

    render(<FolderTreeView {...props} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByText("Blog"));

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("2026")).toBeInTheDocument();
    expect(api.listSubfolders).toHaveBeenCalledTimes(2);
  });
});

describe("folder contents", () => {
  it("asks nothing for the root", async () => {
    const { result } = renderHook(() => useFolderContents(null), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.getFolderContents).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("the delete dialog counts the folder's files from the key the server sends", async () => {
    api.getFolderContents.mockResolvedValue({
      folder: folder("f1", "Blog"),
      subfolders: [],
      files: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      breadcrumbs: [],
    });

    render(
      <DeleteFolderDialog
        open
        onOpenChange={vi.fn()}
        folderId="f1"
        folderName="Blog"
      />,
      { wrapper: Wrapper }
    );

    expect(await screen.findByText(/3 media files/)).toBeInTheDocument();
  });
});

describe("media list", () => {
  it("keeps showing the current page while the next one loads", async () => {
    api.fetchMedia
      .mockResolvedValueOnce({ data: [{ id: "page-1" }] })
      .mockReturnValueOnce(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useMedia({ page, limit: 24 }),
      { wrapper: Wrapper, initialProps: { page: 1 } }
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ data: [{ id: "page-1" }] })
    );

    rerender({ page: 2 });

    expect(result.current.isFetching).toBe(true);
    expect(result.current.data).toEqual({ data: [{ id: "page-1" }] });
  });

  it("shows nothing from the folder it left while another folder loads", async () => {
    api.fetchMedia
      .mockResolvedValueOnce({ data: [{ id: "in-blog" }] })
      .mockReturnValueOnce(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ folderId }: { folderId: string }) =>
        useMedia({ page: 1, limit: 24, folderId }),
      { wrapper: Wrapper, initialProps: { folderId: "blog" } }
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ data: [{ id: "in-blog" }] })
    );

    rerender({ folderId: "team" });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("keeps the list on screen after an edit, refetching it rather than dropping it", async () => {
    api.fetchMedia.mockResolvedValue({ data: [{ id: "m1" }] });
    api.updateMedia.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => ({
        list: useMedia({ page: 1 }),
        update: useUpdateMedia(),
      }),
      { wrapper: Wrapper }
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    await act(async () => {
      await result.current.update.mutateAsync({
        mediaId: "m1",
        updates: { altText: "A hill" },
      });
    });

    expect(client.getQueryData(["media", { page: 1 }])).toEqual({
      data: [{ id: "m1" }],
    });
    await waitFor(() => expect(api.fetchMedia).toHaveBeenCalledTimes(2));
  });
});
