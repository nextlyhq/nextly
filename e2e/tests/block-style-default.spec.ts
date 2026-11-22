/**
 * A block type's default ★ block style, on a published page.
 *
 * Moving ★ to another block style makes it the look of every block of that
 * type that picked no style, while a block wearing another style keeps it.
 * Proven on the served page in a browser, which is where the cascade is
 * decided, and on a page saved BEFORE ★ moved and never saved again: the
 * page's stored sheet must be recompiled, not served with the old default.
 *
 * Safe to write against: the suite owns its database. The stored classes are
 * put back at the end, so the next spec reads the code's block styles alone.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";
const PAGE_SLUG = "block-style-default";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000002${suffix}`;

/** Two buttons: one that picked no block style, one wearing Secondary. */
const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: id("01"),
      type: "core/button",
      version: 1,
      props: { label: "Plain button" },
    },
    {
      id: id("02"),
      type: "core/button",
      version: 1,
      props: { label: "Secondary button" },
      classes: ["look:core/button:secondary"],
    },
  ],
};

/**
 * The built-in Outline style with the ★ mark, and a colour no other tier
 * paints a button, so the plain button taking it can only mean ★ moved.
 */
const OUTLINE_STARRED = {
  id: "look:core/button:outline",
  slug: "button-outline",
  label: "Outline",
  orderIndex: 2,
  blockType: "core/button",
  starred: true,
  styles: {
    base: {
      base: { backgroundColor: "#1b7f5c", color: "#ffffff" },
    },
    hover: { base: { backgroundColor: "#0f5132" } },
  },
};
const OUTLINE_GREEN = "rgb(27, 127, 92)";
const OUTLINE_HOVER = "rgb(15, 81, 50)";

async function expectOk(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  what: string
): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

/** A button's computed background on the served page. */
async function backgroundOf(page: Page, name: string): Promise<string> {
  return page
    .getByRole("button", { name })
    .evaluate(element => getComputedStyle(element).backgroundColor);
}

async function storeClasses(
  api: APIRequestContext,
  classes: readonly unknown[]
): Promise<void> {
  await expectOk(
    await api.patch(SITE_STYLE, { data: { classes, _overwrite: true } }),
    "storing the site's block styles"
  );
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    // The page is saved while the block's own style is still the default.
    await storeClasses(api, []);
    const created = await api.post(ENTRIES, {
      data: {
        title: "Block style default",
        slug: PAGE_SLUG,
        content: DOCUMENT,
        status: "published",
      },
    });
    if (created.status() !== 409) {
      await expectOk(created, `seeding ${PAGE_SLUG}`);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) return;
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    await storeClasses(api, []);
  } finally {
    await api.dispose();
  }
});

test("a button with no pick follows the new ★, one wearing Secondary doesn't", async ({
  page,
  request,
}) => {
  await page.goto(`/blocks/${PAGE_SLUG}`);
  const secondaryBefore = await backgroundOf(page, "Secondary button");
  // The control: before ★ moves, the plain button isn't Outline's green.
  expect(await backgroundOf(page, "Plain button")).not.toBe(OUTLINE_GREEN);

  // ★ moves; the page itself is not saved again.
  await storeClasses(request, [OUTLINE_STARRED]);

  // `/blocks` is cached, and Next serves the previous render once after a
  // write expires its tags, so the page is read again within a bound.
  await expect
    .poll(
      async () => {
        await page.goto(`/blocks/${PAGE_SLUG}`);
        return backgroundOf(page, "Plain button");
      },
      { timeout: 30_000 }
    )
    .toBe(OUTLINE_GREEN);
  expect(await backgroundOf(page, "Secondary button")).toBe(secondaryBefore);

  // The ★ style's hover reaches the plain button too.
  await page.getByRole("button", { name: "Plain button" }).hover();
  await expect
    .poll(() => backgroundOf(page, "Plain button"))
    .toBe(OUTLINE_HOVER);
});

test("a built-in block style can't be renamed through the site style", async ({
  request,
}) => {
  const refused = await request.patch(SITE_STYLE, {
    data: {
      classes: [{ ...OUTLINE_STARRED, label: "Bordered" }],
      _overwrite: true,
    },
  });
  expect(refused.ok()).toBe(false);
  expect(await refused.text()).toContain("is a built-in block style");
});
