/**
 * The reader's pins they may no longer read: counted on a read, with no
 * target named, and removed on the server, each one asked again at removal
 * whether the reader may read it, and only the reader's own.
 *
 * The repository, the existence read and the access read are the test's, so
 * each case says exactly which pins exist and which the reader may read at
 * the moment the service asks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardPin } from "../../../domains/dashboard/dashboard-pins";
import type { DocumentRef } from "../readable-headings";
import type { ReadCaller } from "../readable-resources";

const { listPins, unpin, readableHeadings } = vi.hoisted(() => ({
  listPins: vi.fn(),
  unpin: vi.fn(),
  readableHeadings: vi.fn(),
}));

vi.mock("../../../di/container", () => ({
  container: { get: () => ({}) },
}));
vi.mock("../../../domains/dashboard/dashboard-pins", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/dashboard/dashboard-pins")
  >()),
  DashboardPins: class {
    list = listPins;
    unpin = unpin;
  },
}));
// Every pinned document still exists, so no pin is an orphan here.
vi.mock("../../lib/readable-documents", () => ({
  existingDocumentIds: async (_slug: string, ids: string[]) => ids,
}));
// The real `headingKey`, so the service and this test key a document alike;
// the access read itself is the test's.
vi.mock("../readable-headings", async importOriginal => ({
  ...(await importOriginal<typeof import("../readable-headings")>()),
  bootedHeadingRegistries: () => ({
    getCollectionBySlug: async () => ({}),
    getSingleBySlug: async () => ({}),
  }),
  readableHeadings: (...args: unknown[]) =>
    readableHeadings(...args) as unknown,
}));

import { dashboardPinsService } from "../dashboard-pins-service";
import { headingKey } from "../readable-headings";

const ana = { user: { id: "ana" } } as ReadCaller;

function stored(entryId: string, minutesAgo: number): DashboardPin {
  return {
    id: `pin-${entryId}`,
    userId: "ana",
    targetType: "collection",
    targetSlug: "notes",
    entryId,
    pinnedAt: new Date(Date.now() - minutesAgo * 60_000),
  };
}

/** The reader may read exactly the entries named, as the service asks now. */
let readable = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  readable = new Set();
  unpin.mockResolvedValue(true);
  readableHeadings.mockImplementation(async (refs: DocumentRef[]) => {
    const headings = new Map<string, { title: string }>();
    for (const ref of refs) {
      if (readable.has(ref.entryId)) {
        headings.set(headingKey(ref), { title: `Title ${ref.entryId}` });
      }
    }
    return headings;
  });
});

describe("a reader's pins they may no longer read", () => {
  it("are counted on a read, and no target of them is named", async () => {
    listPins.mockResolvedValue([
      stored("open", 1),
      stored("secret-1", 2),
      stored("secret-2", 3),
    ]);
    readable.add("open");

    const pins = await dashboardPinsService().read(ana);

    expect(pins.shown.map(pin => pin.entryId)).toEqual(["open"]);
    expect(pins.unreadableCount).toBe(2);
    // 🔴 Nothing a closed pin names leaves the service.
    expect(JSON.stringify(pins)).not.toContain("secret");
  });

  it("are removed, the reader's own alone, and the pins they may read are kept", async () => {
    listPins.mockResolvedValue([
      stored("open", 1),
      stored("secret-1", 2),
      stored("secret-2", 3),
    ]);
    readable.add("open");

    const removed = await dashboardPinsService().removeUnreadable(ana);

    expect(removed).toBe(2);
    // The reader's own pins are the only ones read, and the only ones removed.
    expect(listPins).toHaveBeenCalledWith("ana");
    expect(unpin.mock.calls).toEqual([
      [
        "ana",
        { targetType: "collection", targetSlug: "notes", entryId: "secret-1" },
      ],
      [
        "ana",
        { targetType: "collection", targetSlug: "notes", entryId: "secret-2" },
      ],
    ]);
    // Asked as the reader, for every pin they hold.
    expect(readableHeadings).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ entryId: "open" }),
        expect.objectContaining({ entryId: "secret-1" }),
        expect.objectContaining({ entryId: "secret-2" }),
      ]),
      ana,
      expect.anything()
    );
  });

  it("asks again at removal: a pin the reader may read again by then is kept", async () => {
    listPins.mockResolvedValue([stored("secret-1", 1), stored("back", 2)]);
    const service = dashboardPinsService();
    // Both closed when the dialog read them.
    expect((await service.read(ana)).unreadableCount).toBe(2);

    // Access to one returns before "Remove them" is pressed.
    readable.add("back");
    const removed = await service.removeUnreadable(ana);

    expect(removed).toBe(1);
    expect(unpin).toHaveBeenCalledTimes(1);
    expect(unpin).toHaveBeenCalledWith("ana", {
      targetType: "collection",
      targetSlug: "notes",
      entryId: "secret-1",
    });
  });

  it("removes nothing, and asks nothing, when the reader has no pins", async () => {
    listPins.mockResolvedValue([]);

    await expect(dashboardPinsService().removeUnreadable(ana)).resolves.toBe(0);
    expect(readableHeadings).not.toHaveBeenCalled();
    expect(unpin).not.toHaveBeenCalled();
  });

  it("counts only the pins it really removed", async () => {
    listPins.mockResolvedValue([stored("secret-1", 1), stored("secret-2", 2)]);
    // One was already gone by the time its delete ran.
    unpin.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(dashboardPinsService().removeUnreadable(ana)).resolves.toBe(1);
  });
  it("fails when a removal fails, only once every removal has settled", async () => {
    listPins.mockResolvedValue([stored("secret-1", 1), stored("secret-2", 2)]);
    let finishSecond: (removed: boolean) => void = () => {};
    unpin
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(
        () => new Promise<boolean>(resolve => (finishSecond = resolve))
      );
    let settled = false;
    const removal = dashboardPinsService()
      .removeUnreadable(ana)
      .finally(() => (settled = true));
    await vi.waitFor(() => expect(unpin).toHaveBeenCalledTimes(2));

    // The first failed at once; the second is still being written.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finishSecond(true);
    await expect(removal).rejects.toThrow("connection lost");
  });
});
