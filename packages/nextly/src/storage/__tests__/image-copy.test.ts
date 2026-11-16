/**
 * A resized copy made by the real image library: the width it comes out at,
 * the format it is written in, upright whatever its camera wrote, and never
 * made from an original past the pixel limit.
 */
import { crc32 } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageProcessor } from "../image-processor";

async function photo(
  width: number,
  height: number,
  options: { orientation?: number } = {}
): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: "#3366cc" },
  }).jpeg();
  return options.orientation === undefined
    ? await image.toBuffer()
    : await image.withMetadata({ orientation: options.orientation }).toBuffer();
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** One PNG chunk: its length, type, data and checksum. */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, sum]);
}

/** The chunks of a PNG, in order. */
function pngChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.toString("latin1", at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

/** An APNG frame control: frame `sequence`, the whole 40 by 10 canvas. */
function frameControl(sequence: number): Buffer {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(40, 4);
  data.writeUInt32BE(10, 8);
  data.writeUInt16BE(1, 20);
  data.writeUInt16BE(10, 22);
  return data;
}

/**
 * A real two-frame animated PNG, red then blue: the first frame is the PNG's
 * own image data, the second follows as frame data, as every APNG encoder
 * writes them.
 */
async function animatedPng(): Promise<Buffer> {
  const frame = (background: string) =>
    sharp({ create: { width: 40, height: 10, channels: 4, background } })
      .png()
      .toBuffer();
  const first = pngChunks(await frame("#f00"));
  const second = pngChunks(await frame("#00f"));
  const header = first.find(chunk => chunk.type === "IHDR");
  if (!header) throw new Error("sharp wrote a PNG with no header");
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2, 0);
  let sequence = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header.data),
    pngChunk("acTL", control),
    pngChunk("fcTL", frameControl(0)),
    ...first
      .filter(chunk => chunk.type === "IDAT")
      .map(chunk => pngChunk("IDAT", chunk.data)),
    pngChunk("fcTL", frameControl(1)),
    ...second
      .filter(chunk => chunk.type === "IDAT")
      .map(chunk => {
        const number = Buffer.alloc(4);
        number.writeUInt32BE(sequence++, 0);
        return pngChunk("fdAT", Buffer.concat([number, chunk.data]));
      }),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("ImageProcessor.copyAtWidth", () => {
  const processor = new ImageProcessor();

  it("makes a copy at the width asked for, keeping the proportions", async () => {
    const result = await processor.copyAtWidth(
      await photo(2200, 1100),
      640,
      "webp"
    );
    expect(result.kind).toBe("made");
    if (result.kind !== "made") return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(320);
  });

  it("writes each format it is asked for", async () => {
    const original = await photo(800, 400);
    for (const [format, expected] of [
      ["avif", "heif"],
      ["webp", "webp"],
      ["jpeg", "jpeg"],
      ["png", "png"],
    ] as const) {
      const result = await processor.copyAtWidth(original, 320, format);
      expect(result.kind).toBe("made");
      if (result.kind !== "made") continue;
      expect((await sharp(result.bytes).metadata()).format).toBe(expected);
    }
  });

  it("never enlarges: a narrower original keeps its own width", async () => {
    const result = await processor.copyAtWidth(
      await photo(500, 250),
      1920,
      "jpeg"
    );
    expect(result.kind).toBe("made");
    if (result.kind !== "made") return;
    expect((await sharp(result.bytes).metadata()).width).toBe(500);
  });

  it("turns a photo upright as its camera recorded it", async () => {
    // Stored 400 wide by 200 high, with orientation 6: shown rotated a
    // quarter turn, so 200 wide by 400 high.
    const result = await processor.copyAtWidth(
      await photo(400, 200, { orientation: 6 }),
      160,
      "jpeg"
    );
    expect(result.kind).toBe("made");
    if (result.kind !== "made") return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(320);
    // The rotation is applied to the pixels, so no orientation is left for a
    // browser to apply a second time.
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("refuses an original past the pixel limit, without throwing", async () => {
    const limited = new ImageProcessor({ copyPixelLimit: 1000 * 1000 });
    const result = await limited.copyAtWidth(
      await photo(1200, 1000),
      640,
      "webp"
    );
    expect(result).toEqual({ kind: "refused" });
  });

  it("refuses bytes that are not an image, without throwing", async () => {
    const result = await processor.copyAtWidth(
      Buffer.from("not an image at all"),
      640,
      "webp"
    );
    expect(result).toEqual({ kind: "refused" });
  });

  it("says no copy can be made when the image library is not installed", async () => {
    const without = new ImageProcessor({ loader: async () => null });
    const result = await without.copyAtWidth(
      await photo(800, 400),
      640,
      "webp"
    );
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("sends an animated original as it is, rather than its first frame", async () => {
    // Two frames, joined into one animated WebP.
    const frame = (background: string) =>
      sharp({ create: { width: 40, height: 10, channels: 4, background } })
        .png()
        .toBuffer();
    const animated = await sharp([await frame("#f00"), await frame("#00f")], {
      join: { animated: true },
    })
      .webp({ loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await processor.copyAtWidth(animated, 96, "webp")).toEqual({
      kind: "refused",
    });
  });

  it("sends an animated PNG as it is, though the image library reads it as one frame", async () => {
    const animated = await animatedPng();
    // The library sees only the first frame, so its page count cannot tell.
    expect((await sharp(animated).metadata()).pages ?? 1).toBe(1);
    for (const format of ["avif", "webp", "png"] as const) {
      expect(await processor.copyAtWidth(animated, 96, format)).toEqual({
        kind: "refused",
      });
    }
  });

  it("still copies a PNG with one frame", async () => {
    const still = await sharp({
      create: { width: 400, height: 100, channels: 4, background: "#0a0" },
    })
      .png()
      .toBuffer();
    const result = await processor.copyAtWidth(still, 160, "png");
    expect(result.kind).toBe("made");
  });
});

describe("ImageProcessor.getDimensions", () => {
  it("answers a photo's size as it is shown, turned upright", async () => {
    // Stored 400 wide by 200 high, shown a quarter turn round.
    const dimensions = await new ImageProcessor().getDimensions(
      await photo(400, 200, { orientation: 6 })
    );
    expect(dimensions).toEqual({ width: 200, height: 400 });
  });

  it("answers an unturned photo's size as stored", async () => {
    expect(
      await new ImageProcessor().getDimensions(await photo(400, 200))
    ).toEqual({ width: 400, height: 200 });
  });
});
