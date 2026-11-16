/**
 * A media update keeps the focus point it is given.
 *
 * The request schema accepts `focalX` and `focalY`, and the stored row has a
 * column for each, but the update between them passed on only alt text,
 * caption, tags and folder: the point a person set in the admin was dropped
 * without a word. These run the service against a store that keeps what it is
 * handed, so a later read shows exactly what the update passed through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors";
import { UploadValidator } from "../../../services/upload-validation";
import type { RequestContext } from "../../../shared/types";
import { MediaService } from "../services/media-service";

// No user: the update attributes its write to the system, which these don't
// look at.
const context: RequestContext = {};

function storedRow() {
  return {
    id: "m1",
    filename: "coast.jpg",
    originalFilename: "coast.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    width: 1920,
    height: 800,
    url: "/uploads/coast.jpg",
    thumbnailUrl: null,
    sizes: null,
    focalX: null as number | null,
    focalY: null as number | null,
    altText: "Coastline" as string | null,
    caption: null as string | null,
    tags: null,
    folderId: null,
    uploadedBy: "user-001",
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("updating a media item's focus point", () => {
  let row: ReturnType<typeof storedRow>;
  let service: MediaService;
  let updateMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    row = storedRow();
    // The store: it applies whatever changes it receives, as the row does.
    updateMedia = vi.fn(async (_id: string, changes: Partial<typeof row>) => {
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined)
      );
      row = { ...row, ...defined };
      return { success: true, statusCode: 200, message: "OK", data: row };
    });
    const legacy = {
      updateMedia,
      getMediaById: vi.fn(async () => ({
        success: true,
        statusCode: 200,
        message: "OK",
        data: row,
      })),
      // The after-commit work (webhook drain, retention) is not what these
      // test, and running it reads the process-wide webhook state.
      whenCommitted: vi.fn(async () => undefined),
    };
    service = new MediaService(
      legacy as never,
      {} as never,
      { getType: () => "local" } as never,
      {} as never,
      new UploadValidator(undefined),
      true,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
  });

  it("stores focalX and focalY, and a later read returns them", async () => {
    const updated = await service.update(
      "m1",
      { focalX: 25, focalY: 70 },
      context
    );

    expect(updated.focalX).toBe(25);
    expect(updated.focalY).toBe(70);
    const read = await service.findById("m1", context);
    expect(read.focalX).toBe(25);
    expect(read.focalY).toBe(70);
  });

  it("leaves the point alone when an update doesn't name it", async () => {
    await service.update("m1", { focalX: 10, focalY: 20 }, context);
    await service.update("m1", { altText: "Coast at dusk" }, context);

    const read = await service.findById("m1", context);
    // POSITIVE CONTROL: the second update did reach the store.
    expect(read.altText).toBe("Coast at dusk");
    expect(read.focalX).toBe(10);
    expect(read.focalY).toBe(20);
  });

  it("refuses a point outside 0 to 100, or not a whole number, and stores nothing", async () => {
    await expect(
      service.update("m1", { focalX: 101, focalY: 50 }, context)
    ).rejects.toBeInstanceOf(NextlyError);
    await expect(
      service.update("m1", { focalX: 50, focalY: 12.5 }, context)
    ).rejects.toBeInstanceOf(NextlyError);

    expect(updateMedia).not.toHaveBeenCalled();
    expect((await service.findById("m1", context)).focalX).toBeNull();
  });
});
