/**
 * A page that shows two headers: its header & footer set draws one around
 * it, and it has a header block of its own too. The notice above the canvas
 * says so, with its three ways on, and a dismissal that holds for the page
 * until its own header block changes. The same for footers.
 *
 * Seeded through the admin API, as a copy of a real site's page that built
 * its own header and footer before choosing a set: a header Section with the
 * site's navigation, the body, and a footer Section, drawn inside a set that
 * has a header and a footer. A second page places a component marked "Use
 * as: Header" instead. The site's previous default set is put back after.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-two-headers-notice.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SET_TITLE = `Foursight ${STAMP}`;
const SET_HEADER = `Set header ${STAMP}`;
const HEADER_WORDS = `This page shows two headers: the site header (${SET_TITLE}) and a header block on the page.`;
const FOOTER_WORDS = `This page shows two footers: the site footer (${SET_TITLE}) and a footer block on the page.`;

interface Seeded {
  ownBlocks: string;
  placed: string;
}

let seeded: Seeded | undefined;
/**
 * The site's default set before this spec made its own the default, kept
 * BEFORE the change, so a seed that fails part-way still puts it back.
 */
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

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

function section(id: string, as: string, children: unknown[]) {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as, contained: true },
    slots: { children },
  };
}

/** The page as a site built it: its own header and footer around the body. */
function ownBlocksNodes(headerId: string) {
  return [
    section(headerId, "header", [heading(`${headerId}-nav`, "Home · Work")]),
    heading("body", "Page body"),
    section("own-footer", "footer", [heading("footer-text", "© Foursight")]),
  ];
}

async function component(
  api: APIRequestContext,
  name: string,
  area: "header" | "footer" | null
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `${name} ${STAMP}`,
        slug: `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`,
        ...(area === null ? {} : { area }),
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading(`${name}-text`, `${name} ${STAMP}`)],
        },
        status: "published",
      },
    }),
    `creating ${name}`
  );
}

async function pageEntry(
  api: APIRequestContext,
  name: string,
  nodes: unknown[]
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${name} ${STAMP}`,
        slug: `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`,
        content: { formatVersion: 1, kind: "page", nodes },
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
  // A fresh site always has one, the boot's seeded set; there is no route
  // that clears the default, so a site with none could not be put back.
  const before = choices.meta.defaultLayout;
  if (before === null) throw new Error("the site has no default set");
  const header = await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `Set header ${STAMP}`,
        slug: `set-header-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("h", SET_HEADER)],
        },
        status: "published",
      },
    }),
    "creating the set's header"
  );
  const footer = await component(api, "Set footer", null);
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: SET_TITLE,
        slug: `foursight-${STAMP}`,
        areas: [
          { area: "header", component: header },
          { area: "footer", component: footer },
        ],
        status: "published",
      },
    }),
    "creating the header & footer set"
  );
  previousDefault = before;
  await makeDefault(page, set);
  const marked = await component(api, "Own header", "header");
  seeded = {
    ownBlocks: await pageEntry(api, "Own blocks", ownBlocksNodes("own-header")),
    placed: await pageEntry(api, "Placed header", [
      {
        id: "placed-header",
        type: "nextly/component-instance",
        version: 1,
        props: { componentId: marked },
      },
      heading("body", "Page body"),
    ]),
  };
  return seeded;
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

/** Open the builder on a page, with the set's header drawn on its canvas. */
async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(
    (await canvasRoot(page)).locator('[data-nx-region="header"]')
  ).toContainText(SET_HEADER, { timeout: 30_000 });
}

function notice(page: Page, area: "header" | "footer") {
  return page.locator(`[data-two-regions="${area}"]`);
}

test("says the page shows two headers and two footers, naming the set", async ({
  page,
}) => {
  const { ownBlocks } = await seed(page);
  await openBuilder(page, ownBlocks);

  await expect(notice(page, "header")).toContainText(HEADER_WORDS);
  await expect(notice(page, "footer")).toContainText(FOOTER_WORDS);
  await expect(notice(page, "header").getByRole("status")).toHaveText(
    HEADER_WORDS
  );
});

test("selects the page's own header block", async ({ page }) => {
  const { ownBlocks } = await seed(page);
  await openBuilder(page, ownBlocks);

  await notice(page, "header")
    .getByRole("button", { name: "Select the page's header" })
    .click();
  await expect.poll(() => selection(page)).toEqual(["own-header"]);
});

test("opens Page settings on the header & footer choice", async ({ page }) => {
  const { ownBlocks } = await seed(page);
  await openBuilder(page, ownBlocks);

  await notice(page, "header")
    .getByRole("button", { name: "Change in Page settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Header & footer").first()).toBeVisible();
  await expect(
    dialog.locator('[data-slot="page-layout"] button').first()
  ).toBeFocused();
});

test("points out a placed component used as the header", async ({ page }) => {
  const { placed } = await seed(page);
  await openBuilder(page, placed);

  await expect(notice(page, "header")).toContainText(HEADER_WORDS);
  await expect(notice(page, "footer")).toHaveCount(0);
});

test("a dismissal holds after a reload, and ends when the header block changes", async ({
  page,
}) => {
  const { ownBlocks } = await seed(page);
  await openBuilder(page, ownBlocks);

  await notice(page, "header").getByRole("button", { name: "Dismiss" }).click();
  await expect(notice(page, "header")).toHaveCount(0);
  // Only the header's notice: the footer's is its own.
  await expect(notice(page, "footer")).toContainText(FOOTER_WORDS);

  await page.reload();
  await openBuilder(page, ownBlocks);
  await expect(notice(page, "footer")).toContainText(FOOTER_WORDS);
  await expect(notice(page, "header")).toHaveCount(0);

  // The page's own header block replaced by another: the notice is back.
  // An update says which version it changes, or is refused as unversioned.
  const read = await page.request.get(
    `${API}/collections/pages/entries/${ownBlocks}?status=all`
  );
  expect(read.ok(), `read: ${read.status()}`).toBe(true);
  const stored = (await read.json()) as {
    _rev?: unknown;
    item?: { _rev?: unknown };
  };
  const changed = await page.request.patch(
    `${API}/collections/pages/entries/${ownBlocks}`,
    {
      data: {
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: ownBlocksNodes("new-header"),
        },
        _rev: stored.item?._rev ?? stored._rev,
      },
    }
  );
  expect(changed.ok(), `update: ${changed.status()}`).toBe(true);
  await openBuilder(page, ownBlocks);
  await expect(notice(page, "header")).toContainText(HEADER_WORDS);
});
