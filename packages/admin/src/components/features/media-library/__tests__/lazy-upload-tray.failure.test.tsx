/**
 * When the upload tray's code cannot be fetched while files are moving, the
 * library is not thrown into its error boundary: the tray's place says the
 * list could not be loaded, with Try again, and a retry that succeeds draws
 * the tray. The live region is there throughout.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UploadQueue, UploadRow } from "../UploadTray/useUploadQueue";

const fetches = vi.hoisted(() => ({ count: 0 }));

vi.mock("../UploadTray/index", async importOriginal => {
  fetches.count += 1;
  if (fetches.count === 1) throw new Error("chunk missing after a deploy");
  return importOriginal();
});

const { LazyUploadTray } = await import("../UploadTray/LazyUploadTray");

const photo: UploadRow = {
  id: "row-1",
  folderId: null,
  file: new File(["x"], "photo.jpg", { type: "image/jpeg" }),
  filename: "photo.jpg",
  status: "uploading",
  progress: 40,
};

const queue: UploadQueue = {
  rows: [photo],
  counts: {
    total: 1,
    waiting: 0,
    uploading: 1,
    uploaded: 0,
    failed: 0,
    refused: 0,
  },
  isUploading: true,
  summary: "Uploading 1 file",
  add: vi.fn(),
  retry: vi.fn(),
  dismiss: vi.fn(),
};

describe("the upload tray when its code cannot be fetched", () => {
  it("says so in the tray's place with Try again, and a retry draws the tray", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<LazyUploadTray queue={queue} placement="floating" />);

    const note = await screen.findByRole("region", { name: "Uploads" });
    expect(within(note).getByRole("alert")).toHaveTextContent(
      "The upload list could not be loaded"
    );
    expect(
      screen
        .getAllByRole("status")
        .find(element => element.getAttribute("aria-live") === "polite")
    ).toHaveTextContent("Uploading 1 file");

    await user.click(within(note).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("photo.jpg")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetches.count).toBe(2);
    consoleError.mockRestore();
  });
});
