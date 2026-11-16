/**
 * A made share image is the file the card needs: a JPEG of exactly 1200 ×
 * 630, under 600 KB, cut around the picture's focal point, whatever the
 * picture it is made from.
 */
import { randomBytes } from "node:crypto";

import { NextlyError } from "@nextlyhq/plugin-sdk";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { SHARE_IMAGE } from "../contract";
import { cardRegion, makeShareImage } from "../share-image";

/** A picture of one colour, as a PNG. */
function plain(
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha?: number }
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { alpha: 1, ...background },
    },
  })
    .png()
    .toBuffer();
}

/** A picture red on its left half and blue on its right, as a PNG. */
async function redThenBlue(width: number, height: number): Promise<Buffer> {
  const half = Math.floor(width / 2);
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .composite([
      {
        input: await plain(width - half, height, { r: 0, g: 0, b: 255 }),
        left: half,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}

/** The average colour of a made image. */
async function averageOf(data: Buffer) {
  const { channels } = await sharp(data).stats();
  const [r, g, b] = channels.map(channel => Math.round(channel.mean));
  return { r, g, b };
}

describe("makeShareImage", () => {
  it("makes an 800 × 600 picture into a 1200 × 630 JPEG under 600 KB", async () => {
    const made = await makeShareImage(
      await plain(800, 600, { r: 20, g: 90, b: 60 })
    );
    const file = await sharp(made.data).metadata();
    expect(file.format).toBe("jpeg");
    expect([file.width, file.height]).toEqual([1200, 630]);
    expect(made).toMatchObject({ width: 1200, height: 630 });
    expect(made.data.length).toBeLessThan(600_000);
  });

  it("stays under 600 KB for the hardest picture to compress", async () => {
    const noise = await sharp(randomBytes(3000 * 2000 * 3), {
      raw: { width: 3000, height: 2000, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const made = await makeShareImage(noise);
    expect(made.data.length).toBeLessThan(SHARE_IMAGE.maxBytes);
    const file = await sharp(made.data).metadata();
    expect([file.width, file.height]).toEqual([1200, 630]);
  });

  it("cuts around the focal point, keeping the subject in frame", async () => {
    const picture = await redThenBlue(2400, 630);
    const right = await averageOf(
      (await makeShareImage(picture, { x: 90, y: 50 })).data
    );
    const left = await averageOf(
      (await makeShareImage(picture, { x: 10, y: 50 })).data
    );
    expect(right.b).toBeGreaterThan(200);
    expect(right.r).toBeLessThan(50);
    expect(left.r).toBeGreaterThan(200);
    expect(left.b).toBeLessThan(50);
  });

  it("fills a transparent picture's background white, as a JPEG has none", async () => {
    const clear = await plain(1200, 630, { r: 0, g: 0, b: 0, alpha: 0 });
    const colour = await averageOf((await makeShareImage(clear)).data);
    expect(colour).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("refuses a file that is no picture as the caller's input", async () => {
    const refusal = await makeShareImage(Buffer.from("not a picture")).catch(
      (error: unknown) => error
    );
    expect(NextlyError.isCode(refusal, "INVALID_INPUT")).toBe(true);
  });
});

describe("cardRegion", () => {
  it("takes the widest part of a tall picture in the card's shape, at its middle", () => {
    expect(cardRegion(800, 600)).toEqual({
      left: 0,
      top: 90,
      width: 800,
      height: 420,
    });
  });

  it("takes the full height of a wide picture, around the focal point", () => {
    expect(cardRegion(2400, 630, { x: 100, y: 0 })).toEqual({
      left: 1200,
      top: 0,
      width: 1200,
      height: 630,
    });
    expect(cardRegion(2400, 630, { x: 50, y: 50 })).toEqual({
      left: 600,
      top: 0,
      width: 1200,
      height: 630,
    });
  });

  it("reads a focal point off the picture as its middle", () => {
    expect(cardRegion(800, 600, { x: Number.NaN, y: 500 })).toEqual({
      left: 0,
      top: 180,
      width: 800,
      height: 420,
    });
  });
});
