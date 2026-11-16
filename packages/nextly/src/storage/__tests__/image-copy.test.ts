/**
 * A resized copy made by the real image library: the width it comes out at,
 * the format it is written in, upright whatever its camera wrote, and never
 * made from an original past the pixel limit.
 */
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
