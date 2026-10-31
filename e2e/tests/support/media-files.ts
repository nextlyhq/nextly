/**
 * Media files for the browser tests: real image bytes, and the admin's own
 * way of uploading them.
 */
import { deflateSync } from "node:zlib";

import type { Page } from "@playwright/test";

/**
 * A minimal valid grayscale PNG. Real image bytes, not a fixture on disk: the
 * server decodes uploads for dimensions, so the content has to parse, and
 * generating it keeps the suite free of binary files.
 */
export function pngBuffer(shade: number, padToBytes = 0): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };

  const size = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((size + 1) * size, shade);
  for (let y = 0; y < size; y++) raw[y * (size + 1)] = 0; // filter byte per row

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  // Decoders ignore trailing bytes after IEND, so padding inflates the file
  // size (to trip the client's max-size check) while staying a valid image.
  if (padToBytes > png.length) {
    return Buffer.concat([png, Buffer.alloc(padToBytes - png.length)]);
  }
  return png;
}

/**
 * Adds files to the library through its Upload button, which opens the
 * browser's file chooser; what is chosen joins the upload tray, as a drop
 * anywhere on the page does.
 */
export async function dropFiles(
  page: Page,
  files: { name: string; buffer: Buffer }[]
) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).click();
  const chooser = await chooserPromise;

  await chooser.setFiles(
    files.map(f => ({ name: f.name, mimeType: "image/png", buffer: f.buffer }))
  );
}
