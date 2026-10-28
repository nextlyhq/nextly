/**
 * Bulk upload against a real server: the failure classes here are exactly the
 * ones unit tests cannot see. A batch with one oversized file must upload the
 * valid files and report the bad one on its own row (the old dropzone painted
 * the whole zone red and let the successes vanish), and a batch of more than
 * ten files must upload every one: there is no cap on a drop, and the upload
 * queue sends three at a time.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { dropFiles, pngBuffer } from "./support/media-files";

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

  // Partial success is reported as such, never as a whole-batch error, and
  // the file refused before upload is counted apart from a failure. The
  // sr-only live region is the queue's single status source; the media
  // grid's loading skeleton also carries role=status, hence the filter. The
  // dev server compiles routes on first hit, so the settled summary can take
  // a while on a cold run.
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("3 uploaded, 1 refused", {
    timeout: 30_000,
  });

  // The failed row carries human copy with the limit, not raw byte counts.
  await expect(page.getByText("File is too large (max 10 MB)")).toBeVisible();
  await expect(page.getByText(/larger than \d+ bytes/)).toHaveCount(0);

  // The successes really landed: the grid shows the uploaded files.
  await expect(
    page.getByRole("button", { name: /ok-1\.png/ }).first()
  ).toBeVisible();
});

test("a batch of more than ten files uploads every one", async ({ page }) => {
  await gotoAdmin(page, "/media");

  await dropFiles(
    page,
    Array.from({ length: 12 }, (_, i) => ({
      name: `cap-${i + 1}.png`,
      buffer: pngBuffer((i * 20) % 255),
    }))
  );

  // Every file is taken and sent, three at a time: none is refused for the
  // size of the batch.
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("Upload finished. 12 uploaded.", {
    timeout: 60_000,
  });
  await expect(page.getByText(/^Skipped/)).toHaveCount(0);
  await expect(page.getByText("Too many files")).toHaveCount(0);
});
