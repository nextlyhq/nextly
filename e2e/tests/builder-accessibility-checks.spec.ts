/**
 * Page checks' accessibility items on a real page: a second main heading
 * when the site header already has one, a button that only says "Click
 * here", and an embed with no title, each listed under Accessibility, with
 * the header read before the page.
 *
 * Seeded through the admin API: a published header component holding a
 * Heading 1, a header & footer set placing it, made the site's default, and
 * a page with its own Heading 1. The site's previous default is put back.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-accessibility-checks.spec
 */
import { expect, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SITE_TITLE = `Site title ${STAMP}`;

/** The site's default before this spec changed it, kept before the change. */
let previousDefault: string | undefined;

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

function heading(id: string, text: string, level: string) {
  return { id, type: "core/heading", version: 1, props: { text, level } };
}

/** Make a header & footer set the site's default, through the one route that may. */
async function makeDefault(page: Page, id: string): Promise<void> {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const made = await page.request.post(`${PLUGIN}/layouts/${id}/make-default`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data: {},
  });
  expect(made.ok(), `make-default: ${made.status()} ${await made.text()}`).toBe(
    true
  );
}

async function seed(page: Page): Promise<string> {
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const before = choices.meta.defaultLayout;
  if (before === null) throw new Error("the site has no default set");
  const header = await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `Titled header ${STAMP}`,
        slug: `titled-header-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("site-title", SITE_TITLE, "h1")],
        },
        status: "published",
      },
    }),
    "creating the header"
  );
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Titled ${STAMP}`,
        slug: `titled-${STAMP}`,
        areas: [{ area: "header", component: header }],
        status: "published",
      },
    }),
    "creating the header & footer set"
  );
  previousDefault = before;
  await makeDefault(page, set);
  return idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Checked page ${STAMP}`,
        slug: `checked-page-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            heading("page-title", "Our services", "h1"),
            {
              id: "vague-button",
              type: "core/button",
              version: 1,
              props: { label: "Click here", href: "/services", type: "button" },
            },
            {
              id: "untitled-embed",
              type: "core/embed",
              version: 1,
              props: { src: "https://example.com/player", title: "" },
            },
          ],
        },
      },
    }),
    "creating the page"
  );
}

test.afterAll(async ({ browser }) => {
  if (previousDefault === undefined) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await makeDefault(page, previousDefault);
  } finally {
    await page.close();
  }
});

test("lists a second main heading, a vague button and an untitled embed", async ({
  page,
}) => {
  const id = await seed(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(
    (await canvasRoot(page)).locator('[data-nx-region="header"]')
  ).toContainText(SITE_TITLE, { timeout: 30_000 });

  const chip = page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^(\d+ checks?|Checks)\b/ });
  // The header's Heading 1 is read first, so the page's is the second.
  await expect(chip).toHaveText("3 checks");
  await chip.click();
  const list = page.getByRole("dialog", { name: "Page checks" });
  await expect(list).toContainText("More than one main heading (H1)");
  await expect(list).toContainText("Button text doesn’t say where it goes");
  await expect(list).toContainText("Embed has no title");

  // Choosing the heading's item opens its Level, the setting that fixes it.
  await list
    .getByRole("button", { name: /More than one main heading \(H1\)/ })
    .click();
  await expect(
    page.locator(".nx-inspector").getByLabel("Level", { exact: true })
  ).toBeFocused();
});
