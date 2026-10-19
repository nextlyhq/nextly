/**
 * An uploaded image shows on whatever port the app is served on.
 *
 * This suite serves the app on its own port (3100 by default), while the
 * public origin a generated project starts with is `http://localhost:3000`.
 * Local media URLs are paths on the storage's own base (`/uploads/...`), so
 * the browser resolves them on the port it is talking to. A URL rewritten
 * onto the public origin would point at a port nothing serves here, and the
 * image would not load.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { dropFiles, pngBuffer } from "./support/media-files";

test("an uploaded image loads in the media library on a port other than 3000", async ({
  page,
}) => {
  await gotoAdmin(page, "/media");
  await dropFiles(page, [{ name: "any-port.png", buffer: pngBuffer(90) }]);
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("1 uploaded", { timeout: 30_000 });

  // The library card drops its image when it fails to load, so a URL on a
  // port nothing serves leaves no image to find.
  const image = page.getByRole("img", { name: "any-port.png" }).first();
  await expect(image).toBeVisible();

  // The URL is a path, resolved on this page's own origin.
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/uploads\//);
  // And the browser really loaded it: an image that failed to load has no
  // natural width.
  await expect
    .poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});
