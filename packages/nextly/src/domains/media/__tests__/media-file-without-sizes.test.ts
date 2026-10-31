/**
 * A media file read on its own carries its URLs and focus point, and no sizes.
 *
 * Image sizes are no longer made or offered. A row stored before then still
 * holds its `sizes`, as an object or, on SQLite, a JSON string, and the mapper
 * behind `media.findById()` and `GET /api/media/:id` leaves it out either way,
 * as the relationship and Single paths do.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The public origin points at another host and port than the one serving the
// request, as a generated project's `http://localhost:3000` does on any other
// port: a read that resolved URLs against it would show here.
vi.mock("../../../shared/lib/get-base-url", () => ({
  getBaseUrl: () => "http://elsewhere.example:4000",
  getPublicOrigin: () => "http://elsewhere.example:4000",
}));

import { UploadValidator } from "../../../services/upload-validation";
import type { RequestContext } from "../../../shared/types";
import { MediaService } from "../services/media-service";

const context: RequestContext = {
  user: {
    id: "user-001",
    email: "t@example.com",
    role: "admin",
    permissions: ["media:read"],
  },
  locale: "en",
};

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** A stored row as the legacy service hands it back. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "media-1",
  filename: "photo.jpg",
  originalFilename: "photo.jpg",
  mimeType: "image/jpeg",
  size: 4096,
  width: 3000,
  height: 2000,
  duration: null,
  url: "/uploads/2026/04/photo.jpg",
  thumbnailUrl: "/uploads/2026/04/photo-thumb.jpg",
  altText: null,
  caption: null,
  tags: null,
  folderId: null,
  uploadedBy: "user-001",
  uploadedAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
  ...overrides,
});

/** Sizes a row stored before image sizes were removed still holds. */
const variants = {
  thumbnail: {
    url: "/uploads/2026/04/photo-150x150.jpg",
    path: "2026/04/photo-150x150.jpg",
    width: 150,
    height: 150,
    filesize: 900,
    mimeType: "image/jpeg",
    filename: "photo-150x150.jpg",
  },
  large: {
    url: "/uploads/2026/04/photo-1200x800.jpg",
    path: "2026/04/photo-1200x800.jpg",
    width: 1200,
    height: 800,
    filesize: 40_000,
    mimeType: "image/jpeg",
    filename: "photo-1200x800.jpg",
  },
};

describe("a media file fetched on its own carries what the row holds", () => {
  let service: MediaService;
  let legacyMedia: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    legacyMedia = {
      uploadMedia: vi.fn(),
      getMediaById: vi.fn(),
      listMedia: vi.fn(),
      updateMedia: vi.fn(),
      deleteMedia: vi.fn(),
    };
    service = new MediaService(
      legacyMedia as never,
      {} as never,
      { getType: vi.fn().mockReturnValue("local") } as never,
      {} as never,
      new UploadValidator(undefined),
      true,
      silentLogger
    );
  });

  const answer = (data: unknown) => ({
    success: true,
    statusCode: 200,
    message: "OK",
    data,
  });

  it.each([
    ["an object", variants],
    ["a JSON string, as SQLite returns it", JSON.stringify(variants)],
  ])("leaves out stored sizes held as %s", async (_form, sizes) => {
    legacyMedia.getMediaById.mockResolvedValue(answer(row({ sizes })));

    const file = await service.findById("media-1", context);

    expect("sizes" in file).toBe(false);
    // The control: the row's own URLs still come through as the storage
    // wrote them, so the absence is the key being dropped, not the row.
    expect(file.url).toBe("/uploads/2026/04/photo.jpg");
    expect(file.thumbnailUrl).toBe("/uploads/2026/04/photo-thumb.jpg");
  });

  it("leaves a cloud adapter's absolute URLs alone", async () => {
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ url: "https://cdn.example.com/photo.jpg" }))
    );

    const file = await service.findById("media-1", context);

    expect(file.url).toBe("https://cdn.example.com/photo.jpg");
  });

  it("carries the focal point", async () => {
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ focalX: 30, focalY: 70, sizes: variants }))
    );

    const file = await service.findById("media-1", context);

    expect(file.focalX).toBe(30);
    expect(file.focalY).toBe(70);
  });
});
