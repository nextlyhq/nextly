/**
 * A published page keeps serving what was published while an edit waits as a
 * draft.
 *
 * Asked of the served page, as an anonymous visitor reads it, because that is
 * the only place the property exists. The form can offer "Publish changes"
 * over a save that went live anyway, and a test of the collection's
 * configuration cannot tell a draft that is stored from one that is served.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/**
 * The title the site serves for a page, read without the admin session.
 *
 * A request context of its own with no stored sign-in, so what comes back is
 * what a visitor receives rather than what an editor may preview.
 */
async function servedTitle(
  visitor: APIRequestContext,
  slug: string
): Promise<string | undefined> {
  // Generous: the first request compiles the public route on a dev server.
  const response = await visitor.get(`/${slug}`, { timeout: 60_000 });
  expect(response.status()).toBe(200);
  return /<title>([^<]*)<\/title>/.exec(await response.text())?.[1];
}

test("an edit saved to a published page waits as a draft until it is published", async ({
  page,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const visitor = await playwright.request.newContext({ baseURL });

  try {
    const stamp = Date.now();
    const published = `Drafts ${stamp}`;
    const revised = `Drafts ${stamp} revised`;
    // The slug the form derives from the title, which is where the site
    // serves the page.
    const slug = `drafts-${stamp}`;

    await gotoAdmin(page, "/collections/pages/create");
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill(published);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(/\/collections\/pages$/, { timeout: 30_000 });

    // The control for both readings below: the page IS served, under the
    // title it was published with, so they are about what the site serves and
    // not about a page that never went live.
    expect(await servedTitle(visitor, slug)).toBe(published);

    // The row's link rather than the title's text: this screen shows the same
    // title in a heading as well, and the link is what opens the page.
    await page.getByRole("link", { name: published }).click();
    await page.waitForURL(/\/collections\/pages\/(?!create$)[^/]+$/, {
      timeout: 30_000,
    });
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toHaveValue(published, { timeout: 30_000 });

    await title.fill(revised);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Saved as a draft: the form now offers to publish it, and the site still
    // serves what was published.
    const publishChanges = page.getByRole("button", {
      name: "Publish changes",
    });
    await expect(publishChanges).toBeVisible({ timeout: 30_000 });
    expect(await servedTitle(visitor, slug)).toBe(published);

    await publishChanges.click();
    await expect(publishChanges).toBeHidden({ timeout: 30_000 });
    expect(await servedTitle(visitor, slug)).toBe(revised);
  } finally {
    await visitor.dispose();
  }
});
