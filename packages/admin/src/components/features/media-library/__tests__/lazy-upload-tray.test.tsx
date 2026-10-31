/**
 * The uploads' live region is in place before the tray's code has arrived.
 *
 * The tray comes in a chunk of its own. A screen reader does not reliably
 * announce what a live region already holds when it first appears, so the
 * region must be mounted before an upload can start, and must stay the same
 * element once the tray is drawn. The tray's module is held back here, so the
 * test sees the page as it stands on a slow connection.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UploadQueue, UploadRow } from "../UploadTray/useUploadQueue";

const chunk = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>(resolve => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock("../UploadTray/index", async importOriginal => {
  await chunk.arrived;
  return importOriginal();
});

const { LazyUploadTray } = await import("../UploadTray/LazyUploadTray");

function queueOf(rows: UploadRow[], isUploading: boolean): UploadQueue {
  return {
    rows,
    counts: {
      total: rows.length,
      waiting: 0,
      uploading: isUploading ? rows.length : 0,
      uploaded: isUploading ? 0 : rows.length,
      failed: 0,
      refused: 0,
    },
    isUploading,
    summary: rows.length === 0 ? "" : `Uploading ${rows.length} file`,
    add: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
  };
}

const photo: UploadRow = {
  id: "row-1",
  folderId: null,
  file: new File(["x"], "photo.jpg", { type: "image/jpeg" }),
  filename: "photo.jpg",
  status: "uploading",
  progress: 40,
};

const liveRegion = () =>
  screen
    .getAllByRole("status")
    .find(element => element.getAttribute("aria-live") === "polite");

describe("the uploads' live region", () => {
  it("is mounted before the tray's code arrives, announces then, and stays the same element", async () => {
    const view = render(
      <LazyUploadTray queue={queueOf([], false)} placement="floating" />
    );
    const region = liveRegion();
    expect(region).toBeDefined();
    expect(region).toBeEmptyDOMElement();

    // A file chosen while the tray's code is still on its way is announced.
    view.rerender(
      <LazyUploadTray queue={queueOf([photo], true)} placement="floating" />
    );
    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    expect(liveRegion()).toHaveTextContent("Uploading 1 file");

    chunk.release();
    expect(
      await screen.findByRole("region", { name: "Uploads" })
    ).toBeVisible();
    // One region, the one that was there from the start.
    expect(
      screen
        .getAllByRole("status")
        .filter(element => element.getAttribute("aria-live") === "polite")
    ).toHaveLength(1);
    expect(liveRegion()).toBe(region);
  });
});
