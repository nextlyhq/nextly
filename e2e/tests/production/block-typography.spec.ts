import { expect, test } from "@playwright/test";

/**
 * A heading a visitor reads is set apart from the body text around it.
 *
 * IN A PRODUCTION BUILD SPECIFICALLY, and that is the whole reason this lives
 * here rather than beside the other blocks tests. `next dev` serves the CSS of
 * every route it has compiled, so a stylesheet imported by the admin route
 * reaches a public page that never imports it — and the dev suite therefore
 * cannot tell a page that styles its own headings from one borrowing the
 * admin's. Measured under `next dev`, this passed with the renderer's
 * stylesheet removed entirely.
 *
 * What makes the question real: a host applying a CSS reset — Tailwind's
 * Preflight, which the scaffolded template uses — sets `h1`-`h6` to
 * `font-size: inherit; font-weight: inherit`, and the style compiler emits only
 * what a document DECLARES. A heading nobody has styled therefore has no size
 * of its own, and renders identically to a paragraph.
 *
 * @module tests/production/block-typography
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

const HEADING = "A heading nobody has styled";
const BODY = "A paragraph nobody has styled, beneath it.";

test("a heading outranks body text with no author styling at all", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  // By ROLE, not by label: `getByLabel(/password/i)` also matches the "Show
  // password" toggle beside the input, and a locator resolving to two elements
  // fails on strict mode rather than on anything about the product.
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  /*
   * Authored through the API the editor writes with, and carrying NO styles.
   * A `styles` key here would answer a different question: the compiler is
   * known to emit what a document declares, and what is in doubt is what a
   * document that declares nothing looks like.
   */
  const authored = await request.patch("/admin/api/singles/homepage", {
    headers: { cookie: cookieHeader, "content-type": "application/json" },
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "typography-heading",
            type: "core/heading",
            version: 1,
            props: { text: HEADING, level: "h1" },
          },
          {
            id: "typography-body",
            type: "core/text",
            version: 1,
            props: { text: BODY },
          },
        ],
      },
    },
  });
  expect(
    authored.ok(),
    `authoring failed: ${authored.status()} ${await authored.text()}`
  ).toBe(true);

  await page.goto("/");
  const root = page.locator(".nx-pb-page");
  await expect(root).toBeVisible({ timeout: 60_000 });

  const sizes = await root.evaluate(el => {
    const px = (selector: string) => {
      const found = el.querySelector(selector);
      return found === null
        ? null
        : parseFloat(getComputedStyle(found).fontSize);
    };
    return { heading: px("h1"), body: px("p") };
  });

  // Reported so a future failure names the two sizes rather than only their
  // order, and so the hierarchy can be judged rather than merely detected.
  console.log(`TYPOGRAPHY heading=${sizes.heading} body=${sizes.body}`);

  // POPULATION FIRST. "The heading is bigger" is satisfied just as well by a
  // page that rendered neither element, and both would read as null.
  expect(sizes.heading, "the page must render the heading").not.toBeNull();
  expect(sizes.body, "the page must render the body text").not.toBeNull();

  /*
   * A RELATION rather than a pixel value. The claim is that the two are
   * distinguishable; pinning 36px would fail on a scale change that kept the
   * hierarchy perfectly intact, which is a worse test of the same idea.
   */
  expect(
    sizes.heading as number,
    `a heading with no authored size must outrank body text (heading ${sizes.heading}px, body ${sizes.body}px)`
  ).toBeGreaterThan(sizes.body as number);
});
