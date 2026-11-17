/**
 * The notice that visitors may see two headers: the site's canvas route
 * draws a header of its own around the page, and the page's header & footer
 * set draws one too.
 *
 * Seeded through the admin API: a published header component, a published
 * header & footer set made the site's default, and two pages naming nothing,
 * so both are drawn inside that set. The site's previous default is put back
 * afterwards. The playground's canvas route draws no header of its own, so
 * one is added inside the frame, as a site's layout drawing part of itself
 * late would.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-double-header-notice.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SET_HEADER = `Set header ${STAMP}`;
/** The playground's canvas route, its `canvasPath`. */
const CANVAS_ROUTE = "/page-builder-canvas";
const WORDS =
  "This site also draws a header in its code, so visitors may see two. Set the site to draw its header in code, or remove the code header.";
const DOCS =
  "https://nextlyhq.com/docs/page-builder/layouts#a-site-that-draws-its-header-and-footer-in-code";

interface Seeded {
  first: string;
  second: string;
  previousDefault: string | null;
}

let seeded: Seeded | undefined;

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

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

async function pageEntry(api: APIRequestContext, name: string) {
  return idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${name} ${STAMP}`,
        slug: `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("body", `${name} body`)],
        },
      },
    }),
    `creating ${name}`
  );
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

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const header = await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: "set-header",
        slug: `set-header-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("h", SET_HEADER)],
        },
        status: "published",
      },
    }),
    "creating the header component"
  );
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Two headers ${STAMP}`,
        slug: `two-headers-${STAMP}`,
        areas: [{ area: "header", component: header }],
        status: "published",
      },
    }),
    "creating the header & footer set"
  );
  await makeDefault(page, set);
  seeded = {
    first: await pageEntry(api, "First page"),
    second: await pageEntry(api, "Second page"),
    previousDefault: choices.meta.defaultLayout,
  };
  return seeded;
}

test.afterAll(async ({ browser }) => {
  if (seeded?.previousDefault == null) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await makeDefault(page, seeded.previousDefault);
  } finally {
    await page.close();
  }
});

/** Open the builder on a page, with the set's header drawn on its canvas. */
async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(
    (await canvasRoot(page)).locator('[data-nx-region="header"]')
  ).toContainText(SET_HEADER, { timeout: 30_000 });
}

/** Draw a header of the site's own in the canvas route, around the page. */
async function addCodeHeader(page: Page): Promise<void> {
  const frame = page.frame({ url: url => url.pathname === CANVAS_ROUTE });
  if (frame === null) throw new Error("no canvas route frame");
  await frame.evaluate(() => {
    const header = document.createElement("header");
    header.id = "code-header";
    header.style.blockSize = "64px";
    header.textContent = "The site's own header";
    document.body.prepend(header);
  });
  await expect(
    canvasFrame(page).locator("#code-header:visible")
  ).toHaveAttribute("data-nx-site-chrome", "");
}

function notice(page: Page) {
  return page.locator('[data-canvas-state="double-header"]');
}

test("says nothing while only the header & footer set draws a header", async ({
  page,
}) => {
  const { first } = await seed(page);
  await openBuilder(page, first);
  await expect(notice(page)).toHaveCount(0);
});

test("says once a session, with the docs, that visitors may see two headers", async ({
  page,
}) => {
  const { first, second } = await seed(page);
  await openBuilder(page, first);
  await addCodeHeader(page);

  await expect(notice(page)).toHaveCount(1);
  await expect(notice(page)).toContainText(WORDS);
  const details = notice(page).getByRole("link", {
    name: "Details about a site that draws its header in code (opens in a new tab)",
  });
  await expect(details).toHaveAttribute("href", DOCS);
  await expect(details).toHaveAttribute("target", "_blank");

  // Another page in the same session: the same two headers, said no more.
  await openBuilder(page, second);
  await addCodeHeader(page);
  // On the first page the notice was up as soon as the frame marked the
  // site's header; here, after the same and a second's more, it is not.
  await expect(
    canvasFrame(page).locator(".nx-canvas").getByText("Second page body")
  ).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(notice(page)).toHaveCount(0);
});
