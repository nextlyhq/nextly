/**
 * The thumbnail shows the whole image.
 *
 * It is fitted inside a 480 pixel square, keeping the image's proportions and
 * never enlarging it, so a wide or tall picture keeps the edges a person
 * recognises it by. Read from real output, with the image library this install
 * uses, rather than from the arguments handed to it.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageProcessor } from "../image-processor";

const processor = new ImageProcessor({ loader: async () => sharp });

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#3a7" } })
    .png()
    .toBuffer();

async function thumbnailOf(width: number, height: number) {
  const thumbnail = await processor.generateThumbnail(
    await image(width, height)
  );
  if (!thumbnail) throw new Error("expected a thumbnail");
  // The bytes themselves, not the numbers the processor reports beside them.
  const { width: w, height: h } = await sharp(thumbnail.buffer).metadata();
  return { width: w, height: h, reported: thumbnail.metadata };
}

describe("an image's thumbnail", () => {
  it("fits a wide image inside 480 by 480, whole", async () => {
    const out = await thumbnailOf(2000, 500);
    expect([out.width, out.height]).toEqual([480, 120]);
    expect([out.reported.width, out.reported.height]).toEqual([480, 120]);
  });

  it("fits a tall image inside 480 by 480, whole", async () => {
    const out = await thumbnailOf(600, 2400);
    expect([out.width, out.height]).toEqual([120, 480]);
  });

  it("keeps a small image at its own size", async () => {
    const out = await thumbnailOf(100, 60);
    expect([out.width, out.height]).toEqual([100, 60]);
  });
});
