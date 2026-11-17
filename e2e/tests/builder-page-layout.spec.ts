/**
 * The page's header & footer in the editor: one menu with pictures, the same
 * on the entry page and in Settings, which set is in effect and why, and the
 * set's regions drawn locked on the canvas with a way to open the set.
 *
 * Seeded through the admin API: two components, a published Layout made the
 * site's default, a second published Layout and an unpublished one, and a
 * page naming nothing. The site's previous default is put back afterwards.
 *
 * @module tests/builder-page-layout.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot, openLayers, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const MAIN = `Main ${STAMP}`;
const LANDING = `Landing ${STAMP}`;
const UNFINISHED = `Unfinished ${STAMP}`;
const MAIN_HEADER = `Main header ${STAMP}`;
const LANDING_HEADER = `Landing header ${STAMP}`;

interface Seeded {
  pageId: string;
  main: string;
  landing: string;
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
) {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

async function component(api: APIRequestContext, slug: string, text: string) {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: slug,
        slug: `${slug}-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("h", text)],
        },
        status: "published",
      },
    }),
    `creating ${slug}`
  );
}

async function layout(
  api: APIRequestContext,
  title: string,
  header: string,
  status: "published" | "draft"
) {
  return idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title,
        slug: title.toLowerCase().replaceAll(" ", "-"),
        areas: [{ area: "header", component: header }],
        status,
      },
    }),
    `creating ${title}`
  );
}

/** Make a Layout the site's default, through the one route that may. */
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
  ).json()) as {
    meta: { defaultLayout: string | null };
  };
  const mainHeader = await component(api, "main-header", MAIN_HEADER);
  const landingHeader = await component(api, "landing-header", LANDING_HEADER);
  const main = await layout(api, MAIN, mainHeader, "published");
  const landing = await layout(api, LANDING, landingHeader, "published");
  await layout(api, UNFINISHED, landingHeader, "draft");
  await makeDefault(page, main);
  const pageId = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `In its Layout ${STAMP}`,
        slug: `in-its-layout-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("body", "Page body")],
        },
      },
    }),
    "creating the page"
  );
  seeded = {
    pageId,
    main,
    landing,
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

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Open the editor's Settings dialog, whose "This page" tab holds the picker. */
async function openSettings(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Settings" });
  if (await dialog.isVisible()) return;
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(dialog).toBeVisible();
}

async function region(page: Page, area: "header" | "footer") {
  return (await canvasRoot(page)).locator(`[data-nx-region="${area}"]`);
}

/** The menu's option for the set or choice named `name`, by its bold name. */
function option(page: Page, name: string) {
  return page.getByRole("option").filter({
    has: page.locator('[data-slot="hf-name"]').getByText(name, { exact: true }),
  });
}

async function choose(page: Page, name: string): Promise<void> {
  await page.getByRole("combobox", { name: "Header & footer" }).click();
  await option(page, name).click();
}

test("offers one menu with pictures, the same on the entry page and in Settings, and says which set is in effect and why", async ({
  page,
}) => {
  const { pageId } = await seed(page);

  // On the entry form's Page Builder card: the default by name, with its
  // picture drawn from the default set's published header.
  await gotoAdmin(page, `/collections/pages/${pageId}`);
  const cardPicker = page.getByRole("combobox", { name: "Header & footer" });
  await expect(cardPicker).toBeVisible({ timeout: 30_000 });
  // The name, read past the picture, whose drawn text is the set's own.
  await expect(cardPicker.locator('[data-slot="hf-name"]')).toHaveText(
    `Site default (${MAIN})`
  );
  await expect(
    cardPicker.locator('.nx-pb-hf-picture .nx-picture[data-state="drawn"]')
  ).toHaveCount(1);

  // And in the editor's Settings, the same choice shown the same way.
  await openBuilder(page, pageId);
  await openSettings(page);
  // The dialog's, not the right panel's beside it, which says the same.
  const settings = page.getByRole("dialog", { name: "Settings" });
  const picker = settings.getByRole("combobox", { name: "Header & footer" });
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-slot="hf-name"]')).toHaveText(
    `Site default (${MAIN})`
  );
  await expect(
    picker.locator('.nx-pb-hf-picture .nx-picture[data-state="drawn"]')
  ).toHaveCount(1);
  await expect(
    settings.getByText(
      `Follows the site default, ${MAIN}, because this page doesn't choose its own header & footer set.`
    )
  ).toBeVisible();

  await picker.click();
  // The site default first, by name, and not again under its own name;
  // published sets; an unpublished one marked; then None. Other sets the
  // suite's database holds sit among them, so the order is asserted between
  // these.
  const names = await page
    .getByRole("option")
    .locator('[data-slot="hf-name"]')
    .allTextContents();
  expect(names[0]).toBe(`Site default (${MAIN})`);
  await expect(option(page, `Site default (${MAIN})`)).toContainText(
    "Follows the site if the default changes"
  );
  expect(names.at(-1)).toBe("None");
  await expect(option(page, "None")).toContainText("No header or footer");
  expect(names).not.toContain(MAIN);
  expect(names.indexOf(LANDING)).toBeGreaterThan(0);
  expect(names.indexOf(UNFINISHED)).toBeGreaterThan(names.indexOf(LANDING));
  await expect(option(page, LANDING)).toContainText("Header only");
  await expect(option(page, UNFINISHED)).toContainText(
    "Not published: the site default shows until it is"
  );
  // Each published set is drawn from its published header; one not
  // published has nothing to draw.
  await expect(
    option(page, LANDING).locator('.nx-picture[data-state="drawn"]')
  ).toHaveCount(1);
  await expect(
    option(page, UNFINISHED).locator('.nx-picture[data-state="empty"]')
  ).toHaveCount(1);
  // After a separator, the way to the list of sets, as a new tab.
  await expect(
    page.getByRole("option", { name: /Manage headers & footers ↗/ })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await choose(page, UNFINISHED);
  await expect(
    settings.getByText(
      `${UNFINISHED} (not published, so the site default shows)`
    )
  ).toBeVisible();

  await choose(page, "None");
  await expect(
    settings.getByText("No header or footer", { exact: true })
  ).toBeVisible();
  await expect(await region(page, "header")).toHaveCount(0);

  await choose(page, LANDING);
  await expect(picker.locator('[data-slot="hf-name"]')).toHaveText(LANDING);
});

test("draws the Layout's regions locked on the canvas, with a way to open the Layout", async ({
  page,
}) => {
  const { pageId, main } = await seed(page);
  await openBuilder(page, pageId);

  const header = await region(page, "header");
  await expect(header).toContainText(MAIN_HEADER, { timeout: 30_000 });
  // Before the page, and part of the canvas.
  const box = await header.boundingBox();
  const body = await (await canvasRoot(page))
    .getByText("Page body")
    .boundingBox();
  expect(box !== null && body !== null && box.y < body.y).toBe(true);

  // A click selects nothing and shows where the region comes from.
  await header.click();
  expect(await selection(page)).toEqual([]);
  const tag = header.getByRole("status");
  await expect(tag).toContainText(`Header, from header & footer set ${MAIN}`);
  const edit = header.getByRole("link", {
    name: `Edit header & footer set ${MAIN} (opens in a new tab)`,
  });
  await expect(edit).toHaveAttribute("target", "_blank");
  await expect(edit).toHaveAttribute(
    "href",
    `/admin/collections/layouts/${main}`
  );

  // By keyboard: Escape closes the tag and returns to the region's lock, its
  // one focus stop; Enter opens it again.
  await edit.focus();
  await page.keyboard.press("Escape");
  await expect(tag).toHaveCount(0);
  await expect(
    header.getByRole("button", {
      name: `Header, from header & footer set ${MAIN}, locked`,
    })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(header.getByRole("status")).toBeVisible();

  // Layers: a read-only row above the page's blocks.
  await openLayers(page);
  const row = page.getByRole("button", {
    name: `Header, from header & footer set ${MAIN}, locked`,
  });
  await expect(row).toBeVisible();

  // Changing the set redraws the canvas at once, before anything is saved.
  await openSettings(page);
  await choose(page, LANDING);
  await expect(await region(page, "header")).toContainText(LANDING_HEADER);

  // Nothing is stored until the page is saved: reloaded without saving, the
  // page is drawn inside the default again and the menu says so.
  page.on("dialog", dialog => void dialog.accept());
  await page.reload();
  await expect(await region(page, "header")).toContainText(MAIN_HEADER, {
    timeout: 30_000,
  });
  await openSettings(page);
  await expect(
    page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("combobox", { name: "Header & footer" })
      .locator('[data-slot="hf-name"]')
  ).toHaveText(`Site default (${MAIN})`);
});
