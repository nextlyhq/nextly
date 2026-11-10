/**
 * Fonts in Design, end to end: an author adds a font from the Google Fonts
 * catalogue, sees its preview while browsing, picks it in the inspector, and
 * the published page loads it from the site alone, never from Google or the
 * catalogue. Uploading a file still works, and a role without the design
 * grant is refused.
 *
 * The catalogue is the stand-in global setup starts
 * (`support/font-catalogue-server.mjs`); nothing here reaches the network.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, type Request } from "@playwright/test";

import {
  block,
  clickBlock,
  openEditorWith,
  pressSave,
} from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage is reseeded and the site's fonts are changed and restored, as
// the other builder files do with the site style.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

// The stand-in is plain http on localhost, which only a development server
// may reach; a production server rightly refuses it.
test.skip(
  process.env.E2E_SERVER === "production",
  "The stand-in catalogue is reachable from a development server only."
);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILE = path.join(
  HERE,
  "..",
  "fixtures",
  "fonts",
  "fixture-latin-wght-normal.woff2"
);

const SITE_STYLE = "/admin/api/singles/site-style";
const ADD_FONT = "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/fonts";
const HEADING = "fonts-heading";
const HEADING_TEXT = "A heading set in a site font";
const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: HEADING_TEXT, level: "h1" },
  },
];

/** Hosts a published page must never contact. */
const OFF_SITE = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "api.fontsource.org",
  "cdn.jsdelivr.net",
];

async function storedFonts(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.fonts ?? null;
}

async function restoreFonts(page: Page, fonts: unknown): Promise<void> {
  const response = await page.request.patch(SITE_STYLE, {
    data: { fonts, _overwrite: true },
  });
  expect(
    response.ok(),
    `restoring the site's fonts: ${response.status()}`
  ).toBe(true);
}

/** Show Design's Fonts tab, whether or not the panel was left open. */
async function openFonts(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  const restored = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!restored) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: "Fonts" }).click();
  await expect(
    panel.getByRole("heading", { name: "On this site" })
  ).toBeVisible();
}

/**
 * The family the canvas heading is drawn in, as the browser computed it. The
 * heading block's own element is the heading.
 */
async function canvasFamily(page: Page): Promise<string> {
  return (await block(page, HEADING)).evaluate(
    element => getComputedStyle(element).fontFamily
  );
}

test("a Google font added in Design is previewed, picked in the inspector, and loaded only from the site", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const before = await storedFonts(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, HEADING);
    await openFonts(page);
    const panel = page.getByRole("region", { name: "Design panel" });
    await expectNoAxeViolations(page, { include: ".nx-pb-design" });

    // By keyboard alone: the "+" opens its menu, Enter takes the first item.
    await panel.getByRole("button", { name: "Add a font" }).press("Enter");
    const fromGoogle = page.getByRole("menuitem", {
      name: "From Google Fonts",
    });
    await expect(fromGoogle).toBeFocused();
    await page.keyboard.press("Enter");

    // The catalogue opens on its search box, and narrows as the author types.
    const search = panel.getByRole("searchbox", {
      name: "Search Google Fonts",
    });
    await expect(search).toBeFocused();
    await page.keyboard.type("Fixture S");
    const row = panel.getByRole("button", { name: /^Fixture Sans,/ });
    await expect(row).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /^Big Shoulders/ })
    ).toHaveCount(0);

    // The row's preview loads in the editor's own document, from the
    // catalogue's file host, under a name no site family can have.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.fonts.check('16px "nx-preview-fixture-sans"')
        )
      )
      .toBe(true);
    await expectNoAxeViolations(page, { include: ".nx-fonts-catalogue" });

    // The add editor beside the panel, and the add itself, by keyboard.
    await row.focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Add Fixture Sans" });
    await expect(
      editor.getByText("Every weight from 100 to 900, in one file.")
    ).toBeVisible();
    await expectNoAxeViolations(page, {
      include: '[data-slot="popover-content"]',
    });
    const added = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === ADD_FONT &&
        response.request().method() === "POST"
    );
    await editor
      .getByRole("button", { name: /^Add Fixture Sans/ })
      .press("Enter");
    expect((await added).status()).toBe(200);
    await expect(
      page.getByText("Fixture Sans is now on this site.")
    ).toBeVisible();
    await expect(row).toContainText("Added");

    // Back on the list, the family is on the site.
    await panel
      .getByRole("button", { name: "Back to this site’s fonts" })
      .press("Enter");
    await expect(
      panel.getByRole("button", { name: /^Fixture Sans, 1 style/ })
    ).toBeVisible();

    // The inspector offers only what the site can draw: no box to type into.
    await clickBlock(page, HEADING);
    await page
      .getByTestId("inspector")
      .getByRole("tab", { name: "Style" })
      .click();
    const font = page.getByRole("button", { name: /^Font,/ });
    if (!(await font.isVisible())) {
      await page.getByRole("button", { name: /^Typography/ }).click();
    }
    await font.click();
    const list = page.getByRole("listbox");
    await expect(
      list.getByRole("option", { name: "Fixture Sans" })
    ).toBeVisible();
    await expect(list.getByRole("option", { name: "System UI" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0);
    await expectNoAxeViolations(page, {
      include: '[data-slot="popover-content"]',
    });
    await list.getByRole("option", { name: "Fixture Sans" }).click();
    await expect.poll(() => canvasFamily(page)).toMatch(/^"?Fixture Sans"?,/);

    await pressSave(page);
    await expect(page.locator('[data-topbar="end"]')).not.toContainText(
      /Saving/
    );

    // The published page, with every request it makes recorded.
    const site = await context.newPage();
    const requests: Request[] = [];
    site.on("request", request => requests.push(request));
    await site.goto("/");
    const heading = site.getByRole("heading", { name: HEADING_TEXT, level: 1 });
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        site.evaluate(async () => {
          await document.fonts.ready;
          return document.fonts.check('16px "Fixture Sans"');
        })
      )
      .toBe(true);
    expect(
      await heading.evaluate(element => getComputedStyle(element).fontFamily)
    ).toMatch(/^"?Fixture Sans"?,/);

    const own = new URL(test.info().project.use.baseURL ?? "").origin;
    const network = requests
      .map(request => new URL(request.url()))
      .filter(url => url.protocol === "http:" || url.protocol === "https:");
    expect(
      network.filter(url => url.origin !== own).map(url => url.href)
    ).toEqual([]);
    expect(network.filter(url => OFF_SITE.includes(url.hostname))).toEqual([]);

    const fonts = requests.filter(request => request.resourceType() === "font");
    expect(fonts.length).toBeGreaterThan(0);
    for (const request of fonts) {
      expect(new URL(request.url()).pathname).toMatch(
        /^\/api\/media\/[^/]+\/raw$/
      );
      const response = await request.response();
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"]).toContain("font/woff2");
    }
    await site.close();
  } finally {
    await restoreFonts(page, before);
  }
});

test("a font file can still be uploaded", async ({ page }) => {
  test.setTimeout(150_000);
  const before = await storedFonts(page);
  try {
    await openEditorWith(page, NODES, HEADING);
    await openFonts(page);
    const panel = page.getByRole("region", { name: "Design panel" });
    await panel.getByRole("button", { name: "Add a font" }).press("Enter");
    await page.getByRole("menuitem", { name: "Upload a font file" }).click();
    const editor = page.getByRole("dialog", { name: "Upload a font file" });

    const chooser = page.waitForEvent("filechooser");
    await editor.getByRole("button", { name: "Choose file" }).click();
    await (await chooser).setFiles(FONT_FILE);
    await expect(
      editor.getByText(/^fixture-latin-wght-normal\.woff2 · \d+ KB$/)
    ).toBeVisible();
    await editor.getByLabel("Family").fill("Fixture Upload");
    await editor
      .getByRole("checkbox", {
        name: "I have the right to use this font on the web",
      })
      .check();
    await editor.getByRole("button", { name: "Upload" }).click();
    // The editor stays open for the next style; the list is behind it.
    await expect(editor.getByText("No file chosen")).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Escape");

    const uploaded = panel.getByRole("button", { name: /^Fixture Upload,/ });
    await expect(uploaded).toBeVisible({ timeout: 30_000 });
    await uploaded.click();
    await expect(
      page.getByRole("dialog", { name: "Fixture Upload" }).getByText("Uploaded")
    ).toBeVisible();
  } finally {
    await restoreFonts(page, before);
  }
});

test("a role without the design grant cannot add a font", async ({
  browser,
  page,
}) => {
  const baseURL = test.info().project.use.baseURL ?? "";
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-site-style",
  ]);
  try {
    const csrf = await reader.context.request.get("/admin/api/auth/csrf");
    const { token } = (await csrf.json()) as { token: string };
    const answer = await reader.context.request.post(ADD_FONT, {
      // A cookie-authenticated write names its origin and token, as a browser's does.
      headers: { "x-csrf-token": token, origin: new URL(csrf.url()).origin },
      data: {
        id: "fixture-sans",
        weights: "variable",
        styles: ["normal"],
        subsets: ["latin"],
      },
    });
    expect(answer.status()).toBe(403);
    expect(await answer.text()).toContain(
      "You can’t change this site’s fonts."
    );
  } finally {
    await reader.context.close();
  }
});
