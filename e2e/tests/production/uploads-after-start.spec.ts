import { expect, test } from "@playwright/test";

import { dropFiles, pngBuffer } from "../support/media-files";

/**
 * A file uploaded to a PRODUCTION server is served at once, at its URL.
 *
 * `next start` reads `public/` once, when it starts, and serves only the
 * files that were there, so a file the default local storage writes into
 * `public/uploads` afterwards is one it does not know about. `next dev` reads
 * the folder on every request, which is why only this suite can see the
 * difference: the same upload served under `next dev` proves nothing about
 * a deployment.
 *
 * Every upload here is made after the server started, which is the case
 * that matters, and the file is fetched by a visitor with no session, as a
 * page's image is.
 *
 * @module tests/production/uploads-after-start
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

test("an image uploaded after the server started is served at its URL straight away", async ({
  page,
  request,
}) => {
  // Signed in through the real form: dev auto-login is blocked here.
  await page.goto("/admin");
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  // By role, because a label match also finds the "Show password" toggle.
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });

  await page.goto("/admin/media");
  // The upload's own answer carries the URL the file was given, so the
  // file is asked for at that URL whether or not the library shows it.
  const uploaded = page.waitForResponse(
    response =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/admin/api/media"
  );
  await dropFiles(page, [{ name: "after-start.png", buffer: pngBuffer(140) }]);
  const answer = await uploaded;
  expect(answer.status()).toBe(201);
  const { item } = (await answer.json()) as { item: { url: string } };
  expect(item.url).toMatch(/^\/uploads\//);

  // A visitor's request, without the editor's session, for the stored file.
  const served = await request.get(item.url, { headers: { cookie: "" } });
  expect(served.status(), `GET ${item.url}`).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");

  // And the library shows it: an image that failed to load has no natural
  // width.
  const image = page.getByRole("img", { name: "after-start.png" }).first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});
