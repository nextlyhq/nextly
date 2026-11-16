/**
 * A booted site offers its page route copies of an image at the widths its
 * media keeps, through the page builder's `pageBuilderImageCopies`.
 *
 * Booted with the page builder and a real media library, so the copies come
 * from core media the way a published page asks for them: by the image's id,
 * and by its address on the site's media route.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { deflateSync } from "node:zlib";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import { pageBuilderImageCopies } from "../plugin-definition/image-copies";

/** CRC-32 of a PNG chunk's type and data. */
function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A grey PNG `width` pixels wide. */
function png(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 3, 128);
  row[0] = 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe.each(getConfiguredTestDialects())(
  "a site's image copies for its page route (%s)",
  (dialect: TestDialect) => {
    const plugin = pageBuilder();
    let t: TestNextly;
    let id = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      const file = png(2000, 100);
      const item = await t.nextly.media.upload({
        file: {
          data: file,
          name: "wide.png",
          mimetype: "image/png",
          size: file.length,
        },
      });
      id = item.id;
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("offers every kept width up to the one asked for, by id and by address", async () => {
      const copies = pageBuilderImageCopies(plugin);
      const byId = await copies({ id }, 1280);
      expect(byId.map(copy => copy.width)).toEqual([
        96, 160, 240, 320, 640, 960, 1280,
      ]);
      expect(byId[0]?.url).toMatch(new RegExp(`^/api/media/${id}/copy/96`));
      const byAddress = await copies({ url: `/api/media/${id}/raw` }, 640);
      expect(byAddress.map(copy => copy.width)).toEqual([
        96, 160, 240, 320, 640,
      ]);
    });

    it("offers no copy wider than the upload", async () => {
      const widths = (await pageBuilderImageCopies(plugin)({ id }, 3840)).map(
        copy => copy.width
      );
      expect(widths.at(-1)).toBe(1920);
    });
  }
);
