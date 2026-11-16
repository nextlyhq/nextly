/**
 * The fixed rules a resized copy is made by: which widths exist, which format
 * a browser is sent, and which stored key each copy lives at. Every copy's
 * key is derived from these alone, so these are what keep a request from
 * writing anywhere else in storage.
 */
import { describe, expect, it } from "vitest";

import {
  copyFormatsOf,
  copyPathOf,
  copyPathsOf,
  copyVersionOf,
  MEDIA_COPY_WIDTHS,
  mediaCopyAddress,
  mediaIdOfCopyableAddress,
  nearestMediaCopyWidth,
  negotiateCopyFormat,
  parseCopyWidth,
} from "../copies/copy-rules";

describe("the widths a copy can have", () => {
  it("is the fixed set, narrowest first", () => {
    expect(MEDIA_COPY_WIDTHS).toEqual([
      96, 160, 240, 320, 640, 960, 1280, 1920,
    ]);
  });

  it("answers an allowed width with itself", () => {
    for (const width of MEDIA_COPY_WIDTHS) {
      expect(nearestMediaCopyWidth(width)).toBe(width);
    }
  });

  it("snaps any other width to the nearest allowed one", () => {
    expect(nearestMediaCopyWidth(700)).toBe(640);
    expect(nearestMediaCopyWidth(1000)).toBe(960);
    expect(nearestMediaCopyWidth(103)).toBe(96);
    expect(nearestMediaCopyWidth(206)).toBe(240);
  });

  it("takes the wider of two equally near widths, so a copy is never too soft", () => {
    // 800 is 160 from both 640 and 960.
    expect(nearestMediaCopyWidth(800)).toBe(960);
  });

  it("clamps below the narrowest and above the widest", () => {
    expect(nearestMediaCopyWidth(1)).toBe(96);
    expect(nearestMediaCopyWidth(10_000)).toBe(1920);
  });

  it("refuses a width that is not a positive finite number", () => {
    for (const width of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nearestMediaCopyWidth(width)).toThrow();
    }
  });

  it("reads a route segment only when it is plain digits", () => {
    expect(parseCopyWidth("700")).toBe(640);
    expect(parseCopyWidth("1920")).toBe(1920);
    for (const segment of [
      "",
      "0",
      "640.webp",
      "640/../x",
      "..",
      "-640",
      "6e2",
      " 640",
      "0640",
      "1".repeat(7),
    ]) {
      expect(parseCopyWidth(segment)).toBeUndefined();
    }
  });
});

describe("the formats a copy can have", () => {
  it("offers AVIF, WebP or the original's own format for JPEG and PNG", () => {
    expect(copyFormatsOf("image/jpeg").map(format => format.ext)).toEqual([
      "avif",
      "webp",
      "jpg",
    ]);
    expect(copyFormatsOf("image/png").map(format => format.ext)).toEqual([
      "avif",
      "webp",
      "png",
    ]);
  });

  it("keeps WebP and AVIF originals in their own format", () => {
    expect(copyFormatsOf("image/webp").map(format => format.ext)).toEqual([
      "webp",
    ]);
    expect(copyFormatsOf("image/avif").map(format => format.ext)).toEqual([
      "avif",
    ]);
  });

  it("offers nothing for a type it does not resize", () => {
    for (const mimeType of [
      "image/gif",
      "image/svg+xml",
      "application/pdf",
      "video/mp4",
      "font/woff2",
      "",
    ]) {
      expect(copyFormatsOf(mimeType)).toEqual([]);
    }
  });

  it("reads the type as the upload check does, whatever its case", () => {
    expect(copyFormatsOf("Image/JPEG").map(format => format.ext)).toContain(
      "jpg"
    );
  });

  it("sends AVIF to a browser that names it, else WebP, else the original format", () => {
    const chrome =
      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
    expect(negotiateCopyFormat("image/jpeg", chrome)?.ext).toBe("avif");
    expect(negotiateCopyFormat("image/png", "image/webp,*/*")?.ext).toBe(
      "webp"
    );
    expect(negotiateCopyFormat("image/jpeg", "image/*,*/*;q=0.8")?.ext).toBe(
      "jpg"
    );
    expect(negotiateCopyFormat("image/png", null)?.ext).toBe("png");
  });

  it("does not read a wildcard as a promise to decode AVIF or WebP", () => {
    expect(negotiateCopyFormat("image/jpeg", "*/*")?.ext).toBe("jpg");
  });

  it("honours q=0 as a refusal", () => {
    expect(
      negotiateCopyFormat("image/jpeg", "image/avif;q=0, image/webp")?.ext
    ).toBe("webp");
    expect(
      negotiateCopyFormat("image/jpeg", "image/avif; q=0.0,image/webp;q=0")?.ext
    ).toBe("jpg");
  });

  it("answers a WebP original in WebP whatever the browser asks", () => {
    expect(negotiateCopyFormat("image/webp", "image/avif")?.ext).toBe("webp");
  });

  it("answers nothing for a type it does not resize", () => {
    expect(
      negotiateCopyFormat("image/gif", "image/avif,image/webp")
    ).toBeNull();
  });
});

describe("where a copy is stored", () => {
  const jpeg = {
    filename: "media/2026/11/0b6f6c2e-3c3a-4b8e-9d2f-1f2e3d4c5b6a-photo.jpg",
    mimeType: "image/jpeg",
  };

  it("is beside the original, named by width and format", () => {
    const [webp] = copyFormatsOf("image/webp");
    expect(copyPathOf(jpeg.filename, 640, webp)).toBe(
      `${jpeg.filename}.w640.webp`
    );
  });

  it("lists every copy an original can have: each width in each of its formats", () => {
    const paths = copyPathsOf(jpeg);
    expect(paths).toHaveLength(MEDIA_COPY_WIDTHS.length * 3);
    expect(paths).toContain(`${jpeg.filename}.w96.avif`);
    expect(paths).toContain(`${jpeg.filename}.w1920.jpg`);
    for (const path of paths) {
      expect(path.startsWith(`${jpeg.filename}.w`)).toBe(true);
    }
  });

  it("keeps every copy's name within 255 bytes, beside an original whose name is near it", () => {
    // 248 bytes: an original, and its thumbnail, fit; a suffix would not.
    const long = {
      filename: `media/2026/11/${"a".repeat(244)}.jpg`,
      mimeType: "image/jpeg",
    };
    const paths = copyPathsOf(long);
    expect(paths).toHaveLength(MEDIA_COPY_WIDTHS.length * 3);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("media/2026/11/")).toBe(true);
      expect(
        Buffer.byteLength(path.slice(path.lastIndexOf("/") + 1))
      ).toBeLessThanOrEqual(255);
    }
    // Worked out from the original's key alone, so it is the same each time.
    const [webp] = copyFormatsOf("image/webp");
    expect(copyPathOf(long.filename, 1920, webp)).toBe(
      copyPathOf(long.filename, 1920, webp)
    );
    expect(copyPathOf(long.filename, 1920, webp)).not.toBe(
      copyPathOf(`${long.filename.slice(0, -5)}b.jpg`, 1920, webp)
    );
  });

  it("counts a name's bytes, not its characters", () => {
    // 121 two-byte letters: 242 bytes in 121 characters, so the copy's name
    // is 257 bytes, past the limit, in 136 characters, well within it.
    const wide = `media/${"é".repeat(121)}.jpg`;
    const [avif] = copyFormatsOf("image/avif");
    const copy = copyPathOf(wide, 1280, avif);
    expect(
      Buffer.byteLength(copy.slice(copy.lastIndexOf("/") + 1))
    ).toBeLessThanOrEqual(255);
  });

  it("lists none for an original it never copies", () => {
    expect(
      copyPathsOf({ filename: "doc.pdf", mimeType: "application/pdf" })
    ).toEqual([]);
  });

  it("can only ever name a key in that list", () => {
    // Every width a request can give, and every format a browser can be
    // sent, lands on a listed key: nothing a request says reaches the key
    // except through the fixed sets.
    const listed = new Set(copyPathsOf(jpeg));
    const accepts = [null, "*/*", "image/webp", "image/avif", "image/png"];
    for (const segment of ["1", "97", "700", "999999", "1920"]) {
      const width = parseCopyWidth(segment);
      expect(width).toBeDefined();
      for (const accept of accepts) {
        const format = negotiateCopyFormat(jpeg.mimeType, accept);
        expect(format).not.toBeNull();
        expect(listed.has(copyPathOf(jpeg.filename, width!, format!))).toBe(
          true
        );
      }
    }
  });
});

describe("the address a copy is asked for at", () => {
  const item = {
    id: "0b6f6c2e-3c3a-4b8e-9d2f-1f2e3d4c5b6a",
    filename: "media/2026/11/x-photo.jpg",
  };

  it("names the item, the snapped width and the original's version", () => {
    expect(mediaCopyAddress(item, 640)).toBe(
      `/api/media/${item.id}/copy/640?v=${copyVersionOf(item.filename)}`
    );
  });

  it("changes version when the original's file changes", () => {
    expect(copyVersionOf("media/a.jpg")).not.toBe(copyVersionOf("media/b.jpg"));
    expect(copyVersionOf("media/a.jpg")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("finds the item a media library address names", () => {
    expect(mediaIdOfCopyableAddress(`/api/media/${item.id}/raw`)).toBe(item.id);
    expect(
      mediaIdOfCopyableAddress(`https://example.com/api/media/${item.id}`)
    ).toBe(item.id);
  });

  it("finds no item in an address outside the media library", () => {
    for (const url of [
      "https://images.example.com/photo.jpg",
      "/uploads/2026/11/photo.jpg",
      "/api/media/not-an-id/raw",
      "",
    ]) {
      expect(mediaIdOfCopyableAddress(url)).toBeUndefined();
    }
  });
});
