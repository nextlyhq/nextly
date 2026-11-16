/**
 * Copies of stored images, made on request and kept beside the original: one
 * made at a requested width and kept, the same one read back on the next ask,
 * one resize for many asks at once, and the original wherever no copy can be
 * had.
 */
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { ImageProcessor } from "../../../storage/image-processor";
import type { UploadResult } from "../../../storage/types";
import { copyPathsOf, mediaCopyAddress } from "../copies/copy-rules";
import {
  copyBytesOf,
  copyOfMedia,
  type CopyStorage,
} from "../copies/media-copies";

/** A storage holding files in memory, recording every key it is asked to write. */
function memoryStorage(files: Record<string, Buffer> = {}) {
  const held = new Map(Object.entries(files));
  const written: string[] = [];
  const storage: CopyStorage = {
    getPublicUrl: path => `/uploads/${path}`,
    read: async path => held.get(path) ?? null,
    uploadAt: async (path: string, buffer: Buffer): Promise<UploadResult> => {
      written.push(path);
      held.set(path, buffer);
      return { url: `/uploads/${path}`, path };
    },
  };
  return { storage, held, written };
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: "#cc6633" },
  })
    .jpeg()
    .toBuffer();
}

const ITEM = {
  id: "0b6f6c2e-3c3a-4b8e-9d2f-1f2e3d4c5b6a",
  filename: "media/2026/11/0b6f6c2e-photo.jpg",
  mimeType: "image/jpeg",
  url: "/uploads/media/2026/11/0b6f6c2e-photo.jpg",
};

async function itemWithPhoto() {
  const bytes = await jpeg(2200, 1100);
  return { item: { ...ITEM, size: bytes.byteLength }, bytes };
}

describe("copyBytesOf", () => {
  it("makes a copy at the snapped width, keeps it beside the original, and serves it", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();

    const served = await copyBytesOf(item, 700, "image/webp", {
      storage,
      processor,
    });

    expect(served.kind).toBe("copy");
    if (served.kind !== "copy") return;
    expect(served.mimeType).toBe("image/webp");
    const meta = await sharp(served.bytes).metadata();
    expect(meta.width).toBe(640);
    expect(meta.format).toBe("webp");
    expect(served.bytes.byteLength).toBeLessThan(bytes.byteLength);
    expect(written).toEqual([`${item.filename}.w640.webp`]);
  });

  it("reads the kept copy on a second ask, without resizing again", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();
    const resize = vi.spyOn(processor, "copyAtWidth");

    const first = await copyBytesOf(item, 640, null, { storage, processor });
    const second = await copyBytesOf(item, 640, null, { storage, processor });

    expect(resize).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("copy");
    expect(second).toEqual(first);
  });

  it("runs one resize for many asks for the same copy at once", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();
    const resize = vi.spyOn(processor, "copyAtWidth");

    const all = await Promise.all(
      Array.from({ length: 6 }, () =>
        copyBytesOf(item, 960, "image/avif", { storage, processor })
      )
    );

    expect(resize).toHaveBeenCalledTimes(1);
    expect(written).toEqual([`${item.filename}.w960.avif`]);
    expect(new Set(all.map(served => served.kind))).toEqual(new Set(["copy"]));
  });

  it("keeps each format apart, so a browser is never sent one it did not ask for", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();

    const avif = await copyBytesOf(item, 320, "image/avif,image/webp", {
      storage,
      processor,
    });
    const plain = await copyBytesOf(item, 320, "*/*", { storage, processor });

    expect(avif.kind === "copy" && avif.mimeType).toBe("image/avif");
    expect(plain.kind === "copy" && plain.mimeType).toBe("image/jpeg");
    expect(written).toEqual([
      `${item.filename}.w320.avif`,
      `${item.filename}.w320.jpg`,
    ]);
  });

  it("writes only keys derived from the original, whatever is asked", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();
    for (const width of [1, 97, 700, 5000]) {
      for (const accept of [null, "image/avif", "image/webp", "../../x"]) {
        await copyBytesOf(item, width, accept, { storage, processor });
      }
    }
    const derived = new Set(copyPathsOf(item));
    expect(written.length).toBeGreaterThan(0);
    for (const key of written) expect(derived.has(key)).toBe(true);
  });

  it("serves the original when the storage cannot keep copies", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage } = memoryStorage({ [item.filename]: bytes });
    const withoutWrite: CopyStorage = {
      getPublicUrl: storage.getPublicUrl,
      read: storage.read,
    };
    expect(
      await copyBytesOf(item, 640, null, {
        storage: withoutWrite,
        processor: new ImageProcessor(),
      })
    ).toEqual({ kind: "original" });
  });

  it("serves the original when the image library is not installed", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    expect(
      await copyBytesOf(item, 640, null, {
        storage,
        processor: new ImageProcessor({ loader: async () => null }),
      })
    ).toEqual({ kind: "original" });
    expect(written).toEqual([]);
  });

  it("serves the original for an original past the pixel limit, keeping nothing", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    expect(
      await copyBytesOf(item, 640, null, {
        storage,
        processor: new ImageProcessor({ copyPixelLimit: 1000 }),
      })
    ).toEqual({ kind: "original" });
    expect(written).toEqual([]);
  });

  it("serves the original for a type it does not resize", async () => {
    const { storage } = memoryStorage({ "media/a.gif": Buffer.from("GIF89a") });
    expect(
      await copyBytesOf(
        { ...ITEM, filename: "media/a.gif", mimeType: "image/gif", size: 6 },
        640,
        null,
        { storage, processor: new ImageProcessor() }
      )
    ).toEqual({ kind: "original" });
  });

  it("serves the original when its file is missing from storage", async () => {
    const { item } = await itemWithPhoto();
    const { storage, written } = memoryStorage();
    expect(
      await copyBytesOf(item, 640, null, {
        storage,
        processor: new ImageProcessor(),
      })
    ).toEqual({ kind: "original" });
    expect(written).toEqual([]);
  });

  it("still serves a copy it made when keeping it fails", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage } = memoryStorage({ [item.filename]: bytes });
    const failing: CopyStorage = {
      ...storage,
      uploadAt: async () => {
        throw new Error("bucket unavailable");
      },
    };
    const served = await copyBytesOf(item, 240, null, {
      storage: failing,
      processor: new ImageProcessor(),
    });
    expect(served.kind).toBe("copy");
  });
});

describe("copyOfMedia", () => {
  it("gives the copy's address at the snapped width", async () => {
    const { storage } = memoryStorage();
    expect(
      await copyOfMedia(ITEM, 700, { storage, processor: new ImageProcessor() })
    ).toEqual({ url: mediaCopyAddress(ITEM, 640), width: 640 });
  });

  it("answers no copy where none can be had", async () => {
    const { storage } = memoryStorage();
    const processor = new ImageProcessor();
    expect(
      await copyOfMedia({ ...ITEM, mimeType: "image/svg+xml" }, 640, {
        storage,
        processor,
      })
    ).toBeNull();
    expect(
      await copyOfMedia(ITEM, 640, {
        storage: { getPublicUrl: storage.getPublicUrl, read: storage.read },
        processor,
      })
    ).toBeNull();
    expect(
      await copyOfMedia(ITEM, 640, { storage: null, processor })
    ).toBeNull();
    expect(
      await copyOfMedia(ITEM, 640, {
        storage,
        processor: new ImageProcessor({ loader: async () => null }),
      })
    ).toBeNull();
  });
});

describe("copyOfMedia past the original's width", () => {
  it("answers no copy, so the original is used at its own width", async () => {
    const { storage } = memoryStorage();
    const processor = new ImageProcessor();
    const narrow = { ...ITEM, width: 500 };
    expect(await copyOfMedia(narrow, 1920, { storage, processor })).toBeNull();
    // 640 is past 500, even when asked for nearer 500.
    expect(await copyOfMedia(narrow, 600, { storage, processor })).toBeNull();
    expect(await copyOfMedia(narrow, 400, { storage, processor })).toEqual({
      url: mediaCopyAddress(narrow, 320),
      width: 320,
    });
  });
});

describe("copyBytesOf when storage fails", () => {
  it("serves the original rather than an error when a read fails", async () => {
    const { item } = await itemWithPhoto();
    const failing: CopyStorage = {
      getPublicUrl: path => `/uploads/${path}`,
      read: async () => {
        throw new Error("storage unreachable");
      },
      uploadAt: async (path: string) => ({ url: path, path }),
    };
    expect(
      await copyBytesOf(item, 640, null, {
        storage: failing,
        processor: new ImageProcessor(),
      })
    ).toEqual({ kind: "original" });
  });
});

describe("copyBytesOf under load", () => {
  it("makes at most two different copies at once, and the rest wait their turn", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, written } = memoryStorage({ [item.filename]: bytes });
    const processor = new ImageProcessor();
    const make = processor.copyAtWidth.bind(processor);
    let now = 0;
    let most = 0;
    vi.spyOn(processor, "copyAtWidth").mockImplementation(async (...args) => {
      now += 1;
      most = Math.max(most, now);
      try {
        return await make(...args);
      } finally {
        now -= 1;
      }
    });

    const all = await Promise.all(
      [96, 160, 240, 320, 640, 960].map(width =>
        copyBytesOf(item, width, null, { storage, processor })
      )
    );

    expect(most).toBe(2);
    expect(all.every(served => served.kind === "copy")).toBe(true);
    expect(written).toHaveLength(6);
  });
});

describe("a copy finished after its original went", () => {
  it("is removed again, since no delete will list it", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, held } = memoryStorage({ [item.filename]: bytes });
    const removed: string[] = [];
    const withDelete: CopyStorage = {
      ...storage,
      delete: async path => {
        removed.push(path);
        held.delete(path);
      },
    };

    const served = await copyBytesOf(item, 160, null, {
      storage: withDelete,
      processor: new ImageProcessor(),
      stillCurrent: async () => false,
    });

    expect(served.kind).toBe("copy");
    expect(removed).toEqual([`${item.filename}.w160.jpg`]);
    expect(held.has(`${item.filename}.w160.jpg`)).toBe(false);
  });

  it("is kept while its original is current", async () => {
    const { item, bytes } = await itemWithPhoto();
    const { storage, held } = memoryStorage({ [item.filename]: bytes });
    await copyBytesOf(item, 160, null, {
      storage: { ...storage, delete: async () => undefined },
      processor: new ImageProcessor(),
      stillCurrent: async () => true,
    });
    expect(held.has(`${item.filename}.w160.jpg`)).toBe(true);
  });
});
