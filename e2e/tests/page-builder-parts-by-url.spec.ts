/**
 * The page builder's screens and fields, each opened straight from its
 * address in a fresh tab.
 *
 * The plugin registers its parts with the admin and fetches each part's code
 * when a screen first draws it, with the editor's stylesheet for the parts it
 * styles. So no screen may depend on having passed through another one first:
 * the builder, a template's form and an entry with a blocks field must each
 * draw from their own address. And the editor's stylesheet arrives with the
 * builder, not with a screen that draws none of the builder's parts.
 *
 * @module tests/page-builder-parts-by-url
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage, LOCK.postsTemplate] });

const HOMEPAGE_API = "/admin/api/singles/homepage";
const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";
const TEMPLATES = "/admin/api/collections/templates/entries";
const OPEN_BUILDER_ACTION = /^Open in builder$/;
const HEADING = "parts-by-url-heading";

/** A selector the editor's stylesheet styles, and no other sheet does. */
const EDITOR_RULE = ".nx-builder-chrome";

/** The homepage's layout: one heading. */
async function seedHomepage(api: APIRequestContext): Promise<void> {
  const stored = await api.patch(HOMEPAGE_API, {
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Opened by its address", level: "h1" },
          },
        ],
      },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/** The posts collection's template, made if it does not exist yet. */
async function postsTemplate(api: APIRequestContext): Promise<string> {
  const csrf = await api.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which a
  // browser sends and an API request does not: named here as the site's own.
  const created = await api.post(`${PLUGIN}/templates/actions`, {
    data: { action: { kind: "create-template", collection: "posts" } },
    headers: { "x-csrf-token": token, origin: new URL(csrf.url()).origin },
  });
  if (created.ok()) {
    const body = (await created.json()) as {
      item?: { template?: { id?: string } };
    };
    const made = body.item?.template?.id;
    if (made !== undefined) return made;
  }
  // A collection has one template: an earlier call made it.
  const found = await api.get(
    `${TEMPLATES}?where[collection][equals]=posts&limit=1`
  );
  expect(found.ok(), await found.text()).toBe(true);
  const { items } = (await found.json()) as { items: { id: string }[] };
  const id = items[0]?.id;
  if (id === undefined) {
    throw new Error(`[e2e] No posts template: ${await created.text()}`);
  }
  return id;
}

/** Whether any stylesheet the page holds has a rule for `selector`. */
function hasRuleFor(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(wanted => {
    const holds = (rules: CSSRuleList): boolean =>
      [...rules].some(
        rule =>
          (rule instanceof CSSStyleRule &&
            rule.selectorText.includes(wanted)) ||
          ("cssRules" in rule && holds((rule as CSSGroupingRule).cssRules))
      );
    return [...document.styleSheets].some(sheet => {
      try {
        return holds(sheet.cssRules);
      } catch {
        // A sheet from another origin cannot be read; the admin serves none.
        return false;
      }
    });
  }, selector);
}

test.describe("the page builder's parts, opened by their address", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the dashboard draws without the editor's stylesheet", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The parts the dashboard draws fetch their code after it shows: once the
    // network is quiet, anything they brought is on the page.
    await page.waitForLoadState("networkidle");

    expect(await hasRuleFor(page, EDITOR_RULE)).toBe(false);
  });

  test("an entry with a blocks field draws its field", async ({ page }) => {
    await seedHomepage(page.request);

    await gotoAdmin(page, "/singles/homepage");

    await expect(
      page.getByRole("link", { name: OPEN_BUILDER_ACTION })
    ).toBeVisible({ timeout: 30_000 });
  });

  test("the builder draws the page, styled by the editor's stylesheet", async ({
    page,
  }) => {
    await seedHomepage(page.request);

    await gotoAdmin(page, "/singles/homepage/builder?field=layout");

    await expect(await block(page, HEADING)).toBeVisible({ timeout: 60_000 });
    const chrome = page.locator(EDITOR_RULE).first();
    await expect(chrome).toBeVisible();
    expect(await hasRuleFor(page, EDITOR_RULE)).toBe(true);
    // Styled, not merely present: unstyled, the chrome has no background.
    expect(
      await chrome.evaluate(
        element => getComputedStyle(element).backgroundColor
      )
    ).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("a template's form draws its address and its design field", async ({
    page,
  }) => {
    const template = await postsTemplate(page.request);

    await gotoAdmin(page, `/collections/templates/${template}`);

    await expect(
      page.getByRole("textbox", { name: "Address", exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("link", { name: OPEN_BUILDER_ACTION })
    ).toBeVisible();
  });
});
