/**
 * The page's Layout in the editor: one choice, which Layout is in effect and
 * why, and the Layout's regions drawn locked on the canvas with a way to open
 * the Layout.
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

async function choose(page: Page, label: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: "Layout" }).click();
  await page.getByRole("option", { name: label }).click();
}

test("offers one Layout choice and says which Layout is in effect and why", async ({
  page,
}) => {
  const { pageId } = await seed(page);

  // On the entry form's Page Builder card.
  await gotoAdmin(page, `/collections/pages/${pageId}`);
  const cardPicker = page.getByRole("combobox", { name: "Layout" });
  await expect(cardPicker).toBeVisible({ timeout: 30_000 });
  await expect(cardPicker).toContainText(`Site default · ${MAIN}`);

  // And in the editor's Settings.
  await openBuilder(page, pageId);
  await openSettings(page);
  const picker = page.getByRole("combobox", { name: "Layout" });
  await expect(picker).toBeVisible();
  await expect(
    page.getByText(
      `Follows the site default, ${MAIN}, because this page doesn't choose its own Layout.`
    )
  ).toBeVisible();

  await picker.click();
  // The site default first, by name; published Layouts; an unpublished one
  // marked; and no header or footer last. Other Layouts the suite's database
  // holds sit among them, so the order is asserted between these.
  const options = await page.getByRole("option").allTextContents();
  expect(options[0]).toBe(`Site default · ${MAIN}`);
  expect(options.at(-1)).toBe("No header or footer");
  const unfinished = options.indexOf(
    `${UNFINISHED} (not published: the site default shows until it is)`
  );
  expect(options.indexOf(LANDING)).toBeGreaterThan(0);
  expect(options.indexOf(MAIN)).toBeGreaterThan(0);
  expect(unfinished).toBeGreaterThan(options.indexOf(MAIN));
  expect(unfinished).toBeGreaterThan(options.indexOf(LANDING));
  await page.keyboard.press("Escape");

  await choose(
    page,
    `${UNFINISHED} (not published: the site default shows until it is)`
  );
  await expect(
    page.getByText(`${UNFINISHED} (not published, so the site default shows)`)
  ).toBeVisible();

  await choose(page, "No header or footer");
  await expect(
    page.getByText("No header or footer", { exact: true }).last()
  ).toBeVisible();
  await expect(await region(page, "header")).toHaveCount(0);

  await choose(page, LANDING);
  await expect(page.getByText(LANDING, { exact: true }).last()).toBeVisible();
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
  await expect(tag).toContainText(`Header, from Layout ${MAIN}`);
  const edit = header.getByRole("link", {
    name: `Edit Layout ${MAIN} (opens in a new tab)`,
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
    header.getByRole("button", { name: `Header, from Layout ${MAIN}, locked` })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(header.getByRole("status")).toBeVisible();

  // Layers: a read-only row above the page's blocks.
  await openLayers(page);
  const row = page.getByRole("button", {
    name: `Header, from Layout ${MAIN}, locked`,
  });
  await expect(row).toBeVisible();

  // Changing the Layout redraws the canvas at once, before anything is saved.
  await openSettings(page);
  await choose(page, LANDING);
  await expect(await region(page, "header")).toContainText(LANDING_HEADER);
});
