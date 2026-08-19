import { expect, test } from "@playwright/test";

/**
 * Phase 3's exit demo: a page built in the builder, served to a visitor from a
 * PRODUCTION build.
 *
 * D-04.10 requires this environment specifically. Task 179's 500-on-every-path
 * reproduced only under `next build` and never in `next dev`, so the same
 * assertions against a dev server would certify the phase in the one environment
 * the failure it guards against cannot appear in.
 *
 * Dev auto-login is hard-blocked here, correctly, so this signs in through the
 * real form with the credentials the seed creates. An exit demo that
 * authenticated by a dev-only shortcut would prove a path nobody takes.
 *
 * @module tests/production/exit-demo
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** Distinctive enough that finding it on the page cannot be a coincidence. */
const HEADLINE = "Published from the builder, in a production build";

test.describe("the production exit demo", () => {
  test("a builder-authored page reaches a visitor, carrying no editor markers", async ({
    page,
    request,
  }) => {
    // 1. Sign in through the real form. Asserting the landing state first,
    //    because a failed sign-in leaves a page that still renders and every
    //    later assertion would fail for the wrong reason.
    await page.goto("/admin");
    await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
    // By ROLE, not by label: `getByLabel(/password/i)` also matches the "Show
    // password" toggle beside the input, and a locator that resolves to two
    // elements fails on strict mode rather than on anything about the product.
    await page
      .getByRole("textbox", { name: /password/i })
      .fill(DEV_USER.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });

    // 2. Author a page THROUGH THE API the editor writes with, rather than by
    //    inserting rows: the claim is about what the product serves for content
    //    the product accepted, and a hand-written row can be shaped in ways the
    //    write path would have rejected.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

    const authored = await request.patch("/admin/api/singles/homepage", {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: {
        layout: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "exit-demo-heading",
              type: "core/heading",
              version: 1,
              props: { text: HEADLINE, level: "h1" },
            },
          ],
        },
      },
    });
    expect(
      authored.ok(),
      `authoring failed: ${authored.status()} ${await authored.text()}`
    ).toBe(true);

    // 3. The visitor's view. A plain fetch, not the signed-in browser context —
    //    a page that renders only for an authenticated editor is not published.
    const visitor = await request.get("/", {
      headers: { cookie: "" },
    });
    expect(visitor.status()).toBe(200);
    const html = await visitor.text();

    // The POPULATION: the authored content is actually on the page. Without
    // this the marker assertions below pass for an empty page.
    expect(html).toContain(HEADLINE);

    // 4. No editor markers. `data-nx-node` is emitted only when a host asks for
    //    it, and a published route must not — this is the claim that had no
    //    production-build evidence before this spec existed.
    expect(html).not.toContain("data-nx-node");
    expect(html).not.toContain("data-nx-selected");
    expect(html).not.toContain("nx-drop-indicator");
  });

  test("an unknown page answers 404, not 500", async ({ request }) => {
    // Task 179's failure: a route whose collection is empty at build time
    // answered 500 on EVERY path, in a production build only. A 404 is the
    // route working; a 500 is the route broken in a way that looks like content.
    const missing = await request.get("/no-such-page-exists-here");
    expect(missing.status()).toBe(404);
  });
});
