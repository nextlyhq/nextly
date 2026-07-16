/**
 * Bulk upload against a real server: the failure classes here are exactly the
 * ones unit tests cannot see. A batch with one oversized file must upload the
 * valid files and report the bad one per-file (the old dropzone painted the
 * whole zone red and let the successes vanish), and a batch over the 10-file
 * cap must upload the first 10 and mark the rest skipped (react-dropzone's
 * `maxFiles` used to reject the entire batch as "Too many files").
 */
import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/**
 * A minimal valid grayscale PNG. Real image bytes, not a fixture on disk: the
 * server decodes uploads for dimensions, so the content has to parse, and
 * generating it keeps the suite free of binary files.
 */
function pngBuffer(shade: number, padToBytes = 0): Buffer {
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

async function dropFiles(
  page: import("@playwright/test").Page,
  files: { name: string; buffer: Buffer }[]
) {
  await page.getByRole("button", { name: "Upload Files" }).click();

  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: /Upload files\. Drag and drop/ })
    .click();
  const chooser = await chooserPromise;

  await chooser.setFiles(
    files.map(f => ({ name: f.name, mimeType: "image/png", buffer: f.buffer }))
  );
}

test("a batch with one oversized file uploads the rest and reports the failure per file", async ({
  page,
}) => {
  await gotoAdmin(page, "/media");

  await dropFiles(page, [
    { name: "ok-1.png", buffer: pngBuffer(40) },
    { name: "ok-2.png", buffer: pngBuffer(80) },
    { name: "ok-3.png", buffer: pngBuffer(120) },
    // 11MB against the 10MB client limit
    { name: "huge.png", buffer: pngBuffer(160, 11 * 1024 * 1024) },
  ]);

  // Partial success is reported as such, never as a whole-batch error. The
  // summary is asserted via its status role because an sr-only live region
  // announces the same text. The dev server compiles routes on first hit, so
  // the settled summary can take a while on a cold run.
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toHaveText("3 uploaded, 1 failed", {
    timeout: 30_000,
  });

  // The failed row carries human copy with the limit, not raw byte counts.
  await expect(page.getByText("File is too large (max 10 MB)")).toBeVisible();
  await expect(page.getByText(/larger than \d+ bytes/)).toHaveCount(0);

  // The drop target auto-collapsed when the upload started; the queue is the
  // surviving surface.
  await expect(
    page.getByRole("button", { name: /Upload files\. Drag and drop/ })
  ).toHaveCount(0);

  // The successes really landed: the grid shows the uploaded files.
  await expect(
    page.getByRole("button", { name: /ok-1\.png/ }).first()
  ).toBeVisible();
});

test("a batch over the 10-file cap uploads the first 10 and marks the rest skipped", async ({
  page,
}) => {
  await gotoAdmin(page, "/media");

  await dropFiles(
    page,
    Array.from({ length: 12 }, (_, i) => ({
      name: `cap-${i + 1}.png`,
      buffer: pngBuffer((i * 20) % 255),
    }))
  );

  // Nothing valid is refused outright ("Too many files" is gone): the first
  // 10 upload, the overflow is skipped and says so.
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toHaveText("10 uploaded, 2 skipped", {
    timeout: 30_000,
  });
  await expect(
    page.getByText("Skipped: only 10 files can be uploaded at once")
  ).toHaveCount(2);
  await expect(page.getByText("Too many files")).toHaveCount(0);
});
