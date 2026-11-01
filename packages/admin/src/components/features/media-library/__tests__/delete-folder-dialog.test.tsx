/**
 * A folder delete the server refuses is said in the dialog, which stays open:
 * the server's own reason, such as a folder holding items deleted moments
 * ago that can still be brought back, rather than a dialog that does nothing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

const api = vi.hoisted(() => ({
  getFolderContents: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  getFolderContents: (...a: unknown[]) => api.getFolderContents(...a),
  deleteFolder: (...a: unknown[]) => api.deleteFolder(...a),
}));

import { DeleteFolderDialog } from "../DeleteFolderDialog";

const WAITING =
  "This folder holds items deleted moments ago that can still be brought back. Try again once their Undo has passed.";

let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.getFolderContents.mockResolvedValue({
    folder: { id: "f1", name: "Blog", parentId: null },
    subfolders: [],
    files: [{ id: "m1" }],
    breadcrumbs: [],
    meta: { total: 1, page: 1, limit: 24, totalPages: 1 },
  });
});

/** The dialog for the folder, open, and its Delete pressed. */
async function pressDelete(onOpenChange: (open: boolean) => void) {
  render(
    <DeleteFolderDialog
      open
      onOpenChange={onOpenChange}
      folderId="f1"
      folderName="Blog"
    />,
    { wrapper: Wrapper }
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete Everything" })
  );
}

describe("deleting a folder the server refuses", () => {
  it("says the server's reason in the dialog, and keeps it open", async () => {
    api.deleteFolder.mockRejectedValue(
      parseApiError(
        { error: { code: "CONFLICT", message: WAITING, requestId: "r1" } },
        409
      )
    );
    const onOpenChange = vi.fn();

    await pressDelete(onOpenChange);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't delete the folder");
    expect(alert).toHaveTextContent(WAITING);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes once the delete is done, saying nothing", async () => {
    // POSITIVE CONTROL: the same dialog, the delete allowed.
    api.deleteFolder.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    await pressDelete(onOpenChange);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
