/**
 * A media file describes itself the same way however it is read.
 *
 * `sizes`, `focalX` and `focalY` are stored in every dialect, and the mapper
 * behind `media.findById()` and `GET /api/media/:id` used to drop all three, so
 * the same file carried its variants when populated as a relationship on
 * another collection and carried none when fetched on its own. These hold the
 * two paths to one answer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { getMediaVariant } from "../../../lib/media-variant";
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

  it("returns every generated variant, with each URL absolutized", async () => {
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ sizes: variants }))
    );

    const file = await service.findById("media-1", context);

    // The variant URLs get the same treatment as `url`, which is the whole
    // reason a caller can hand this object to `getMediaVariant` and put the
    // result straight into an <Image src>.
    expect(file.sizes?.large.url).toBe(
      "http://localhost:3000/uploads/2026/04/photo-1200x800.jpg"
    );
    expect(file.sizes?.thumbnail.url).toBe(
      "http://localhost:3000/uploads/2026/04/photo-150x150.jpg"
    );
    // The control: the fields that were already carried still are, so a mapper
    // that returned the raw row would not pass this.
    expect(file.url).toBe("http://localhost:3000/uploads/2026/04/photo.jpg");
    expect(file.sizes?.large.width).toBe(1200);
  });

  it("leaves a cloud adapter's absolute variant URLs alone", async () => {
    legacyMedia.getMediaById.mockResolvedValue(
      answer(
        row({
          url: "https://cdn.example.com/photo.jpg",
          sizes: {
            large: {
              ...variants.large,
              url: "https://cdn.example.com/photo-1200x800.jpg",
            },
          },
        })
      )
    );

    const file = await service.findById("media-1", context);

    expect(file.sizes?.large.url).toBe(
      "https://cdn.example.com/photo-1200x800.jpg"
    );
    expect(file.url).toBe("https://cdn.example.com/photo.jpg");
  });

  it("parses the JSON string SQLite returns, so every dialect answers alike", async () => {
    // SQLite stores the column as TEXT and the driver returns it as a string.
    // A mapper that assigned the column straight through would hand a caller a
    // string on one dialect and an object on the other two, and
    // `sizes.large.url` would be undefined on exactly one of them.
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ sizes: JSON.stringify(variants) }))
    );

    const file = await service.findById("media-1", context);

    expect(typeof file.sizes).toBe("object");
    expect(file.sizes?.large.url).toBe(
      "http://localhost:3000/uploads/2026/04/photo-1200x800.jpg"
    );
  });

  it("carries the focal point", async () => {
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ focalX: 30, focalY: 70 }))
    );

    const file = await service.findById("media-1", context);

    expect(file.focalX).toBe(30);
    expect(file.focalY).toBe(70);
  });

  it("answers null for a file that has no variants", async () => {
    // A non-image, or an image uploaded before any size was configured. Null
    // rather than a missing key, so a caller can branch on one shape.
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ mimeType: "application/pdf", sizes: null }))
    );

    const file = await service.findById("media-1", context);

    expect(file.sizes).toBeNull();
    expect(file.focalX ?? null).toBeNull();
  });

  it("can be handed straight to getMediaVariant", async () => {
    // The claim the guide makes. Before this, the helper called on a findById
    // result could only ever return the thumbnail or the original, because the
    // variants were not on the object to choose from.
    legacyMedia.getMediaById.mockResolvedValue(
      answer(row({ sizes: variants }))
    );

    const file = await service.findById("media-1", context);

    expect(getMediaVariant(file, "large", { fallback: "thumbnail" })).toBe(
      "http://localhost:3000/uploads/2026/04/photo-1200x800.jpg"
    );
    // The control: a name that exists in neither falls back to the thumbnail,
    // so the assertion above is reading the variant rather than the fallback.
    expect(getMediaVariant(file, "missing", { fallback: "alsoMissing" })).toBe(
      "http://localhost:3000/uploads/2026/04/photo-thumb.jpg"
    );
  });
});
