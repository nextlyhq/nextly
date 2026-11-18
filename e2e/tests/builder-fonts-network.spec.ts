/**
 * Fonts added from the Google Fonts catalogue are copied to the site, and
 * nothing a visitor or an editor's canvas loads comes from Google, Fontsource
 * or jsDelivr.
 *
 * Two catalogue families are added through the add route, then made the
 * site's Body and Headings fonts. A page with a heading and a paragraph is
 * drawn on the builder's canvas and on its published address, every request
 * each makes is recorded, and both families are checked to be drawn, so the
 * empty request list is about pages that really use the fonts.
 *
 * The catalogue is the stand-in global setup starts
 * (`support/font-catalogue-server.mjs`): plain http on localhost, which only a
 * development server may reach.
 *
 * @module tests/builder-fonts-network.spec
 */
import { expect, type Page, type Request } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

// The site's fonts and variables are changed, then restored.
test.describe.configure({ lock: [LOCK.siteStyle] });

test.skip(
  process.env.E2E_SERVER === "production",
  "The stand-in catalogue is reachable from a development server only."
);

const API = "/admin/api";
const SITE_STYLE = `${API}/singles/site-style`;
const PAGES = `${API}/collections/pages/entries`;
const ADD_FONT = `${API}/plugins/@nextlyhq/plugin-page-builder/site/fonts`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** Hosts neither a published page nor the canvas may ever contact. */
const OFF_SITE = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "api.fontsource.org",
  "cdn.jsdelivr.net",
];

const TEXTS = {
  heading: `Fonts copied to the site ${STAMP}`,
  text: `Body text in a copied font ${STAMP}`,
};

interface Stored {
  tokens: unknown;
  fonts: unknown;
}

async function stored(page: Page): Promise<Stored> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const parse = (raw: unknown) =>
    (typeof raw === "string" ? JSON.parse(raw) : raw) ?? null;
  return { tokens: parse(item.tokens), fonts: parse(item.fonts) };
}

async function writeStyle(page: Page, data: Record<string, unknown>) {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { ...data, _overwrite: true },
  });
  expect(written.ok(), `writing the site style: ${written.status()}`).toBe(
    true
  );
}

/** Add one catalogue family through the route the Fonts screen uses. */
async function addFromCatalogue(
  page: Page,
  family: {
    id: string;
    weights: readonly number[] | "variable";
    styles: readonly ("normal" | "italic")[];
  }
): Promise<void> {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const added = await page.request.post(ADD_FONT, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data: { ...family, subsets: ["latin"] },
  });
  expect(
    added.ok(),
    `adding ${family.id}: ${added.status()} ${await added.text()}`
  ).toBe(true);
}

/** The two fonts as the site's Body and Headings fonts, through Site text. */
const ROLE_TOKENS = {
  tokens: [
    {
      name: "font.body",
      kind: "fontFamily",
      values: { light: '"Fixture Sans", sans-serif' },
    },
    {
      name: "font.heading",
      kind: "fontFamily",
      values: { light: '"Fixture Serif", serif' },
    },
  ],
  siteText: {
    body: { fontFamily: { $token: "font.body" } },
    h1: { fontFamily: { $token: "font.heading" } },
  },
};

/** Every http(s) request a page makes from now on. */
function record(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", request => requests.push(request));
  return requests;
}

/** The origins of the recorded font files that came from anywhere but `own`. */
function foreignFonts(requests: readonly Request[], own: string): string[] {
  return requests
    .filter(request => request.resourceType() === "font")
    .map(request => new URL(request.url()).origin)
    .filter(origin => origin !== own);
}

/** The recorded requests to a host on the never-contact list. */
function offSite(requests: readonly Request[]): string[] {
  return requests
    .map(request => new URL(request.url()))
    .filter(url => OFF_SITE.includes(url.hostname))
    .map(url => url.href);
}

test("two catalogue fonts in use load only from the site, on the canvas and on the published page", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await gotoAdmin(page, "/");
  const before = await stored(page);
  try {
    await addFromCatalogue(page, {
      id: "fixture-sans",
      weights: "variable",
      styles: ["normal"],
    });
    await addFromCatalogue(page, {
      id: "fixture-serif",
      weights: [400, 700],
      styles: ["normal"],
    });
    const added = await stored(page);
    await writeStyle(page, { tokens: ROLE_TOKENS, fonts: added.fonts });

    const slug = `fonts-network-${STAMP}`;
    const created = await page.request.post(PAGES, {
      data: {
        title: `Fonts network ${STAMP}`,
        slug,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "network-heading",
              type: "core/heading",
              version: 1,
              props: { text: TEXTS.heading, level: "h1" },
            },
            {
              id: "network-text",
              type: "core/text",
              version: 1,
              props: { text: TEXTS.text },
            },
          ],
        },
      },
    });
    expect(created.ok(), `seeding the page: ${await created.text()}`).toBe(
      true
    );
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;

    // The canvas: the builder and its frame, every request recorded.
    const onCanvas = record(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
    const canvas = await canvasRoot(page);
    const heading = canvas.getByText(TEXTS.heading);
    const text = canvas.getByText(TEXTS.text);
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        heading.evaluate(element => getComputedStyle(element).fontFamily)
      )
      .toMatch(/^"?Fixture Serif"?,/);
    await expect
      .poll(() =>
        text.evaluate(element => getComputedStyle(element).fontFamily)
      )
      .toMatch(/^"?Fixture Sans"?,/);
    // Both faces really load, from wherever the canvas takes them.
    await expect
      .poll(
        () =>
          heading.evaluate(async element => {
            await element.ownerDocument.fonts.ready;
            // A face of each family has loaded, whichever weight the text
            // drew: `check` asks after one weight, which may not be the one used.
            const loaded = new Set(
              [...element.ownerDocument.fonts]
                .filter(face => face.status === "loaded")
                .map(face => face.family.replace(/"/g, ""))
            );
            return loaded.has("Fixture Serif") && loaded.has("Fixture Sans");
          }),
        // Font files load after the text draws, slower on a busy machine.
        { timeout: 30_000 }
      )
      .toBe(true);
    expect(offSite(onCanvas), "canvas requests to off-site font hosts").toEqual(
      []
    );
    // Copied, not drawn from the catalogue: every font file is the site's.
    const own = new URL(page.url()).origin;
    expect(foreignFonts(onCanvas, own), "canvas fonts from elsewhere").toEqual(
      []
    );

    // The published page, in a fresh tab.
    const site = await context.newPage();
    const published = record(site);
    await site.goto(`/${slug}`);
    const siteHeading = site.getByRole("heading", {
      name: TEXTS.heading,
      level: 1,
    });
    await expect(siteHeading).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          site.evaluate(async () => {
            await document.fonts.ready;
            const loaded = new Set(
              [...document.fonts]
                .filter(face => face.status === "loaded")
                .map(face => face.family.replace(/"/g, ""))
            );
            return loaded.has("Fixture Serif") && loaded.has("Fixture Sans");
          }),
        // Font files load after the text draws, slower on a busy machine.
        { timeout: 30_000 }
      )
      .toBe(true);
    expect(
      await siteHeading.evaluate(
        element => getComputedStyle(element).fontFamily
      )
    ).toMatch(/^"?Fixture Serif"?,/);
    expect(
      await site
        .getByText(TEXTS.text)
        .evaluate(element => getComputedStyle(element).fontFamily)
    ).toMatch(/^"?Fixture Sans"?,/);
    expect(
      offSite(published),
      "published page requests to off-site font hosts"
    ).toEqual([]);
    // Every font file the page loaded came from the site itself.
    expect(foreignFonts(published, own), "page fonts from elsewhere").toEqual(
      []
    );
    await site.close();
  } finally {
    await writeStyle(page, { tokens: before.tokens, fonts: before.fonts });
  }
});

/**
 * The Fonts screen over the Design panel, from Type's "Manage fonts…". A
 * reload may bring the panel back on the screen it was left on, a moment
 * after drawing its tabs, or not: so the way there is retried until the
 * screen is open, from whichever state the panel is in.
 */
async function openFonts(page: Page) {
  const panel = page.getByRole("region", { name: "Design panel" });
  const back = panel.getByRole("button", { name: "Back to Design" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  await expect(async () => {
    if (await back.isVisible()) return;
    if (!(await panel.isVisible())) {
      await page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Design", exact: true })
        .click({ timeout: 2_000 });
    }
    await panel.getByRole("tab", { name: "Type" }).click({ timeout: 2_000 });
    await panel
      .getByRole("button", { name: "Manage fonts…" })
      .click({ timeout: 2_000 });
    await expect(back).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return panel;
}

/** The Google Fonts catalogue, opened from the Fonts screen's add menu. */
async function openCatalogue(page: Page) {
  // A reload may bring the catalogue itself back.
  const panel = page.getByRole("region", { name: "Design panel" });
  const search = panel.getByRole("searchbox", { name: "Search Google Fonts" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (
    await search
      .waitFor({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    return panel;
  }
  const fonts = await openFonts(page);
  await fonts.getByRole("button", { name: "Add a font" }).click();
  await page.getByRole("menuitem", { name: "From Google Fonts" }).click();
  await expect(
    fonts.getByRole("searchbox", { name: "Search Google Fonts" })
  ).toBeVisible();
  return fonts;
}

test("the catalogue loads no preview until the author asks, and keeps the choice", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoAdmin(page, "/");
  const created = await page.request.post(PAGES, {
    data: {
      title: `Font previews ${STAMP}`,
      slug: `font-previews-${STAMP}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), `seeding the page: ${await created.text()}`).toBe(true);
  const pageId = ((await created.json()) as { item: { id: string } }).item.id;
  const builder = `/collections/pages/${pageId}/builder?field=content`;
  await page.setViewportSize({ width: 1440, height: 900 });
  const own = new URL(page.url()).origin;

  const requests = record(page);
  await gotoAdmin(page, builder);
  let catalogue = await openCatalogue(page);
  await expect(
    catalogue.getByText(
      "Fonts you add are copied to your site. Visitors never contact Google."
    )
  ).toBeVisible();
  await expect(
    catalogue.getByRole("button", { name: /^Fixture Sans,/ })
  ).toBeVisible();
  // Rows on screen, and still no font file from the preview host.
  expect(foreignFonts(requests, own), "previews before asking").toEqual([]);

  await catalogue.getByRole("button", { name: "Show previews" }).click();
  await expect
    .poll(() => foreignFonts(requests, own).length)
    .toBeGreaterThan(0);

  // Reloaded: the choice is kept, so previews load without asking again.
  requests.length = 0;
  await page.reload();
  catalogue = await openCatalogue(page);
  await expect(
    catalogue.getByRole("button", { name: /^Fixture Sans,/ })
  ).toBeVisible();
  await expect(
    catalogue.getByRole("button", { name: "Show previews" })
  ).toHaveCount(0);
  await expect
    .poll(() => foreignFonts(requests, own).length)
    .toBeGreaterThan(0);
  expect(offSite(requests), "requests to off-site font hosts").toEqual([]);
});
