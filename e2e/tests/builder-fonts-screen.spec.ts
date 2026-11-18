/**
 * The one Fonts screen, every way in: Design → Type "Manage fonts…" and a
 * font picker's "Manage fonts…" open it over the Design panel with the canvas
 * kept, and the admin's Page Builder → Fonts draws it on a page of its own.
 * A font added on either surface is in the other: the admin's page lists it,
 * and the builder's font picker offers it. A role that may not change the
 * site's design sees the screen read-only in the builder, is not offered the
 * admin page, and is refused by the routes.
 *
 * Fonts are added by upload here, which needs no catalogue and so runs on a
 * production server too; the catalogue's add is `builder-fonts.spec.ts`'s.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Locator, type Page } from "@playwright/test";

import { block, clickBlock, openEditorWith } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { writeHeaders } from "./support/usage-count";

// The homepage is reseeded and the site's fonts changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILE = path.join(
  HERE,
  "..",
  "fixtures",
  "fonts",
  "fixture-latin-wght-normal.woff2"
);

const SITE_STYLE = "/admin/api/singles/site-style";
const PAGES = "/admin/api/collections/pages/entries";
const ADD_FONT = "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/fonts";
/** The admin's Fonts page, under the admin's root. */
const FONTS_PAGE = "/plugins/nextlyhq-plugin-page-builder/fonts";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

const HEADING = "screen-heading";
const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "A heading for the Fonts screen", level: "h1" },
  },
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
  expect(response.ok(), `restoring the fonts: ${response.status()}`).toBe(true);
}

/** The Design panel, opened from the rail unless it was left open. */
async function designPanel(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  const open = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!open) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  return panel;
}

/** Design → Type → "Manage fonts…", and the screen it opens. */
async function manageFonts(page: Page): Promise<Locator> {
  const panel = await designPanel(page);
  await panel.getByRole("tab", { name: "Type" }).click();
  await panel.getByRole("button", { name: "Manage fonts…" }).click();
  const fonts = panel.getByRole("region", { name: "Fonts" });
  await expect(
    fonts.getByRole("heading", { name: "On this site" })
  ).toBeVisible();
  return fonts;
}

/** Upload the fixture font on a Fonts screen, under `family`. */
async function uploadFont(
  page: Page,
  fonts: Locator,
  family: string
): Promise<void> {
  await fonts.getByRole("button", { name: "Add a font" }).click();
  await page.getByRole("menuitem", { name: "Upload a font file" }).click();
  const editor = page.getByRole("dialog", { name: "Upload a font file" });
  const chooser = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles(FONT_FILE);
  await editor.getByLabel("Family").fill(family);
  await editor
    .getByRole("checkbox", {
      name: "I have the right to use this font on the web",
    })
    .check();
  await editor.getByRole("button", { name: "Upload" }).click();
  // The editor stays open for the next style once this one is stored.
  await expect(editor.getByText("No file chosen")).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press("Escape");
  await expect(
    fonts.getByRole("button", { name: new RegExp(`^${family},`) })
  ).toBeVisible({ timeout: 30_000 });
}

/** The heading's Font control in the inspector, opened on its list. */
async function openFontPicker(page: Page): Promise<Locator> {
  await clickBlock(page, HEADING);
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style" })
    .click();
  const font = page.getByRole("button", { name: /^Font,/ });
  if (!(await font.isVisible())) {
    await page.getByRole("button", { name: /^Text(\s?has changes)?$/ }).click();
  }
  await font.click();
  return page.getByRole("listbox");
}

/** Marks the editor's document, so a reload would be seen as one. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__fontsScreenMark = true;
  });
}

async function documentKept(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__fontsScreenMark === true
  );
}

test("opens over the Design panel from Type and from a font picker, with the canvas kept", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(page, NODES, HEADING);
  await markDocument(page);

  // From Type's "Manage fonts…": the screen in the panel's place.
  const fonts = await manageFonts(page);
  const panel = page.getByRole("region", { name: "Design panel" });
  await expect(
    fonts.getByRole("heading", { name: "Fonts", level: 2 })
  ).toBeVisible();
  await expect(panel.getByRole("tab", { name: "Type" })).toHaveCount(0);
  await expect(await block(page, HEADING)).toBeVisible();
  // The keyboard is in the screen, on its way back.
  await expect(
    fonts.getByRole("button", { name: "Back to Design" })
  ).toBeFocused();
  await expectNoAxeViolations(page, { include: "[data-fonts-screen]" });

  // Back by keyboard: the Type tab again, focus on what opened the screen.
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("tab", { name: "Type" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(
    panel.getByRole("button", { name: "Manage fonts…" })
  ).toBeFocused();

  // From the inspector's font picker: the same screen, on the left side.
  const list = await openFontPicker(page);
  await expect(list).toBeVisible();
  await page
    .locator(".nx-font-pick__footer")
    .getByRole("button", { name: "Manage fonts…" })
    .click();
  await expect(panel.getByRole("region", { name: "Fonts" })).toBeVisible();
  await expect(await block(page, HEADING)).toBeVisible();
  expect(await documentKept(page), "the editor was not reloaded").toBe(true);

  // In the dark theme, reloaded: the screen the author left open is the one
  // they come back to, and it passes the scan there too.
  const here = new URL(page.url());
  await gotoAdmin(
    page,
    `${here.pathname.replace(/^\/admin/, "")}${here.search}`,
    "dark"
  );
  await expect(
    panel.getByRole("region", { name: "Fonts" }).getByRole("heading", {
      name: "On this site",
    })
  ).toBeVisible({ timeout: 30_000 });
  await expectNoAxeViolations(page, { include: "[data-fonts-screen]" });
});

test("fits the narrowest panel, with no row scrolling sideways", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditorWith(page, NODES, HEADING);
  const fonts = await manageFonts(page);
  const panel = page.getByRole("region", { name: "Design panel" });
  const divider = page.getByRole("separator", { name: "Panel and canvas" });
  await divider.focus();
  await page.keyboard.press("Home");
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBeLessThanOrEqual(240);
  const sideways = await fonts.evaluate(element => {
    const scrolled = [element, ...element.querySelectorAll("*")].find(
      each =>
        each.scrollWidth > each.clientWidth + 1 &&
        getComputedStyle(each).overflowX !== "visible" &&
        getComputedStyle(each).textOverflow !== "ellipsis"
    );
    return scrolled === undefined ? null : scrolled.className;
  });
  expect(sideways, "nothing on the screen scrolls sideways").toBeNull();
  await expect(
    fonts.getByRole("heading", { name: "Fonts", level: 2 })
  ).toBeInViewport();
});

test("a font added on the admin's Fonts page is in the builder's picker, and one added in the builder is on the page", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedFonts(page);
  const fromAdmin = `Admin Added ${STAMP}`;
  const fromBuilder = `Builder Added ${STAMP}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Page Builder → Fonts, from the admin's own panel.
    await gotoAdmin(page, "/plugins/nextlyhq-plugin-page-builder/overview");
    await page
      .getByTestId("sub-sidebar")
      .getByRole("group", { name: "Design" })
      .getByRole("link", { name: "Fonts", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${FONTS_PAGE}$`));
    await expect(
      page.getByRole("heading", { name: "Fonts", level: 1 })
    ).toBeVisible();
    const adminScreen = page.getByRole("region", { name: "Fonts" });
    for (const theme of ["light", "dark"] as const) {
      await gotoAdmin(page, FONTS_PAGE, theme);
      await expect(
        adminScreen.getByRole("heading", { name: "On this site" })
      ).toBeVisible();
      await expectNoAxeViolations(page, { include: "[data-fonts-screen]" });
    }
    await gotoAdmin(page, FONTS_PAGE);
    await uploadFont(page, adminScreen, fromAdmin);

    // The builder's font picker offers it.
    await openEditorWith(page, NODES, HEADING);
    let list = await openFontPicker(page);
    await expect(
      list.getByRole("option", { name: fromAdmin, exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // The reverse: added from the builder's screen...
    const builderScreen = await manageFonts(page);
    await uploadFont(page, builderScreen, fromBuilder);
    list = await openFontPicker(page);
    await expect(
      list.getByRole("option", { name: fromBuilder, exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // ...and listed on the admin's page.
    await gotoAdmin(page, FONTS_PAGE);
    await expect(
      adminScreen.getByRole("button", { name: new RegExp(`^${fromBuilder},`) })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      adminScreen.getByRole("button", { name: new RegExp(`^${fromAdmin},`) })
    ).toBeVisible();
  } finally {
    await restoreFonts(page, before);
  }
});

test("a role that may not change the design sees the screen read-only, is not offered the page, and is refused", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    const created = await page.request.post(PAGES, {
      data: {
        title: `Fonts screen read-only ${STAMP}`,
        slug: `fonts-screen-read-only-${STAMP}`,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = ((await created.json()) as { item: { id: string } }).item.id;
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(view, `/collections/pages/${id}/builder?field=content`);
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });

    // In the builder: the screen opens, shows the fonts, and changes nothing.
    const fonts = await manageFonts(view);
    await expect(
      fonts.getByText("You can view the site’s fonts but not change them.")
    ).toBeVisible();
    await expect(fonts.getByRole("button", { name: "Add a font" })).toHaveCount(
      0
    );

    // In the admin: no Fonts item, and the page itself says no.
    await gotoAdmin(view, "/plugins/nextlyhq-plugin-page-builder/overview");
    await expect(
      view
        .getByTestId("sub-sidebar")
        .getByRole("link", { name: "Bindings to fix" })
    ).toBeVisible();
    await expect(
      view.getByTestId("sub-sidebar").getByRole("link", {
        name: "Fonts",
        exact: true,
      })
    ).toHaveCount(0);
    await gotoAdmin(view, FONTS_PAGE);
    await expect(
      view.getByRole("heading", { name: "You don't have access to this page" })
    ).toBeVisible();
    await expect(view.getByRole("region", { name: "Fonts" })).toHaveCount(0);

    // And the routes refuse a font change, whichever surface asks.
    const headers = await writeHeaders(reader.context.request);
    const added = await reader.context.request.post(ADD_FONT, {
      headers,
      data: {
        id: "fixture-sans",
        weights: "variable",
        styles: ["normal"],
        subsets: ["latin"],
      },
    });
    expect(added.status(), await added.text()).toBe(403);
    const written = await reader.context.request.patch(SITE_STYLE, {
      headers,
      data: {
        fonts: [
          {
            family: "Refused",
            src: [{ url: "/api/media/none/raw", format: "woff2" }],
          },
        ],
        _overwrite: true,
      },
    });
    expect(written.status(), await written.text()).toBe(403);
  } finally {
    await reader.context.close();
  }
});
