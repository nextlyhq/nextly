import { expect } from "@playwright/test";

import { test } from "../support/visible";

/**
 * The admin is served as not listable by search engines, on the build a
 * visitor gets, whatever plugins the site runs: the HTML the server sends
 * for the admin, signed in or not, carries
 * `<meta name="robots" content="noindex, nofollow">` in its head, so a
 * crawler that reads only the first response sees it, and the page a browser
 * draws keeps exactly one. The site's own pages carry none.
 *
 * @module tests/production/admin-not-listable
 */

/** The robots tags' contents in the head of some HTML. */
function robotsInHead(html: string): string[] {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  return Array.from(
    head.matchAll(/<meta[^>]*name="robots"[^>]*content="([^"]*)"/gi),
    match => match[1] ?? ""
  );
}

test.describe("the admin is not listable on a production build", () => {
  for (const address of ["/admin", "/admin/login", "/admin/collections"]) {
    test(`${address} is sent with noindex in its head`, async ({ request }) => {
      const response = await request.get(address);
      expect(response.status()).toBe(200);
      expect(robotsInHead(await response.text())).toEqual([
        "noindex, nofollow",
      ]);
    });
  }

  test("the page a browser draws keeps one robots tag, noindex", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await expect(page.locator('head meta[name="robots"]')).toHaveCount(1);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow"
    );
  });

  test("the site's own home page carries no robots tag from the admin", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(robotsInHead(await response.text())).toEqual([]);
  });
});
