/**
 * A header & footer set in the builder, in a real browser on the dev server:
 * opened from its row in the Pages panel and from its admin form's "Open in
 * builder"; its header and footer around the "Page content goes here"
 * placeholder; each control of its settings; Save keeping the pages that use
 * it unchanged and Publish, after "Publish to N pages?", changing them; the
 * header selected and edited in place as on a page; and Back to the page it
 * was opened from, asking first about unsaved changes.
 *
 * Seeded through the admin API: two header components marked for the header,
 * one component marked for nothing, a footer, a published set naming the
 * first header and the footer, and pages naming the set, one per test that
 * opens the builder, so no test's open editor holds another's lock. The set
 * is never the site default.
 *
 * @module tests/builder-set-view.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", timeout: 180_000 });

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SET = `Shore ${STAMP}`;
const HEADER_TEXT = `Lighthouse ${STAMP}`;
const OTHER_HEADER_TEXT = `Harbour ${STAMP}`;
const FOOTER_TEXT = `Pier Ltd ${STAMP}`;

interface Seeded {
  set: string;
  header: string;
  otherHeader: string;
  plain: string;
  footer: string;
}

let seeded: Seeded | undefined;

async function idOf(
  response: Awaited<ReturnType<Page["request"]["post"]>>,
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function component(
  page: Page,
  title: string,
  area: "header" | "footer" | null,
  text: string
): Promise<string> {
  return idOf(
    await page.request.post(`${API}/collections/components/entries`, {
      data: {
        title,
        slug: `${title.toLowerCase().replace(/\W+/g, "-")}`,
        ...(area === null ? {} : { area }),
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "words",
              type: "core/heading",
              version: 1,
              props: { text, level: "h2" },
            },
          ],
        },
        status: "published",
      },
    }),
    `creating ${title}`
  );
}

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const header = await component(
    page,
    `Lighthouse ${STAMP}`,
    "header",
    HEADER_TEXT
  );
  const otherHeader = await component(
    page,
    `Harbour ${STAMP}`,
    "header",
    OTHER_HEADER_TEXT
  );
  const plain = await component(
    page,
    `Banner ${STAMP}`,
    null,
    `Banner ${STAMP}`
  );
  const footer = await component(page, `Pier ${STAMP}`, "footer", FOOTER_TEXT);
  const set = await idOf(
    await page.request.post(`${API}/collections/layouts/entries`, {
      data: {
        title: SET,
        slug: `shore-${STAMP}`,
        areas: [
          { area: "header", component: header },
          { area: "footer", component: footer },
        ],
        status: "published",
      },
    }),
    "creating the set"
  );
  seeded = { set, header, otherHeader, plain, footer };
  return seeded;
}

/** A page naming the set, of its own. */
async function pageFor(page: Page, slug: string): Promise<string> {
  const { set } = await seed(page);
  return idOf(
    await page.request.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${slug} ${STAMP}`,
        slug: `${slug}-${STAMP}`,
        layout: set,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "intro",
              type: "core/heading",
              version: 1,
              props: { text: "Welcome aboard", level: "h2" },
            },
          ],
        },
        status: "published",
      },
    }),
    `creating ${slug}`
  );
}

async function openPageBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

async function openSetView(page: Page): Promise<void> {
  const { set } = await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/layouts/${set}/in-builder`);
  await expectSetView(page);
}

async function expectSetView(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/in-builder(\?|$)/);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    (await canvasRoot(page)).getByText("Page content goes here")
  ).toBeVisible({
    timeout: 30_000,
  });
}

async function region(page: Page, area: "header" | "footer"): Promise<Locator> {
  return (await canvasRoot(page)).locator(`[data-nx-region="${area}"]`);
}

function settings(page: Page): Locator {
  return page.getByRole("region", { name: "Header & footer set" });
}

async function openPagesPanel(page: Page): Promise<void> {
  const item = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" });
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(
    page.getByRole("button", { name: /^Header & footer, \d+$/ })
  ).toBeVisible();
}

test("opens from its row in the Pages panel, its header and footer around the placeholder", async ({
  page,
}) => {
  await openPageBuilder(page, await pageFor(page, "from-row"));
  await openPagesPanel(page);
  await page
    .getByRole("list", { name: "Header & footer sets" })
    .getByRole("link", { name: new RegExp(`^${SET}`) })
    .click();
  await expectSetView(page);
  await expect(await region(page, "header")).toContainText(HEADER_TEXT);
  await expect(await region(page, "footer")).toContainText(FOOTER_TEXT);
  // The placeholder sits between them.
  const placeholder = (await canvasRoot(page)).getByText(
    "Page content goes here"
  );
  const top = (await (await region(page, "header")).boundingBox())?.y ?? 0;
  const middle = (await placeholder.boundingBox())?.y ?? 0;
  const bottom = (await (await region(page, "footer")).boundingBox())?.y ?? 0;
  expect(top).toBeLessThan(middle);
  expect(middle).toBeLessThan(bottom);
});

test("shows each control of the set's settings with nothing selected", async ({
  page,
}) => {
  await pageFor(page, "settings");
  await openSetView(page);
  const panel = settings(page);
  await expect(panel.getByLabel("Name")).toHaveValue(SET);
  await expect(panel.getByLabel("Header")).toContainText(`Lighthouse ${STAMP}`);
  await expect(panel.getByLabel("Footer")).toContainText(`Pier ${STAMP}`);
  await expect(
    panel.getByText(/^Used on (at least )?\d+ pages?$/)
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Make site default" })
  ).toBeVisible();

  // The header picker: marked components first, then the others, then None,
  // each with its picture.
  await panel.getByLabel("Header").click();
  const list = page.getByRole("listbox");
  await expect(
    list.getByRole("option", { name: new RegExp(`Harbour ${STAMP}`) })
  ).toBeVisible();
  await expect(list.getByText("Other components")).toBeVisible();
  await expect(
    list.getByRole("option", { name: new RegExp(`Banner ${STAMP}`) })
  ).toBeVisible();
  await expect(list.getByRole("option", { name: /^None/ })).toBeVisible();
  const names = await list.getByRole("option").allTextContents();
  const markedAt = names.findIndex(name => name.includes(`Harbour ${STAMP}`));
  const otherAt = names.findIndex(name => name.includes(`Banner ${STAMP}`));
  expect(markedAt).toBeGreaterThan(-1);
  expect(markedAt).toBeLessThan(otherAt);
  expect(names.at(-1)).toContain("None");
  await expect(list.locator(".nx-pb-hf-picture").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await panel.getByRole("button", { name: `More for ${SET}` }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Rename",
    "Duplicate",
    "Delete",
  ]);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(panel.getByLabel("Name")).toBeFocused();
});

test("Save keeps the pages unchanged; Publish asks how many pages and changes them", async ({
  page,
}) => {
  const using = await pageFor(page, "publish");
  await openSetView(page);
  await settings(page).getByLabel("Header").click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(`Harbour ${STAMP}`) })
    .click();
  // Drawn at once, before anything is saved.
  await expect(await region(page, "header")).toContainText(OTHER_HEADER_TEXT);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true })
  ).toBeDisabled({
    timeout: 30_000,
  });
  const published = async () =>
    (
      (await (
        await page.request.get(
          `${API}/plugins/@nextlyhq/plugin-page-builder/layouts/choices?selected=${encodeURIComponent((await seed(page)).set)}`
        )
      ).json()) as {
        items: Array<{
          id: string;
          regions: Array<{ area: string; componentId: string }>;
        }>;
      }
    ).items.find(item => item.id === seeded?.set)?.regions;
  // A draft: the pages using the set still get its published header.
  expect(await published()).toContainEqual({
    area: "header",
    componentId: seeded?.header,
  });

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const ask = page.getByRole("alertdialog", {
    name: /^Publish to (at least )?\d+ pages?\?$/,
  });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: /^Publish to/ }).click();
  await expect.poll(published, { timeout: 30_000 }).toContainEqual({
    area: "header",
    componentId: seeded?.otherHeader,
  });

  // And a page using it now draws the new header.
  await openPageBuilder(page, using);
  await expect(await region(page, "header")).toContainText(OTHER_HEADER_TEXT, {
    timeout: 30_000,
  });
});

test("the header is selected and edited in place, as on a page", async ({
  page,
}) => {
  await pageFor(page, "in-place");
  await openSetView(page);
  await (await region(page, "header")).click();
  const card = page.getByRole("complementary").getByRole("region", {
    name: "Site header",
  });
  await expect(card).toContainText("To use a different header in this set");
  await card.getByRole("button", { name: "Edit header" }).click();
  const bar = page.locator(".nx-region-bar");
  await expect(bar).toContainText(/^Editing the site header · changes show on/);
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toHaveCount(0);
  // "its settings" goes back to the set's settings.
  await (await region(page, "header")).click();
  await card.getByRole("button", { name: "its settings" }).click();
  await expect(settings(page)).toBeVisible();
});

test("Back returns to the page it was opened from, asking first about unsaved changes", async ({
  page,
}) => {
  const from = await pageFor(page, "back");
  await openPageBuilder(page, from);
  await openPagesPanel(page);
  await page
    .getByRole("list", { name: "Header & footer sets" })
    .getByRole("link", { name: new RegExp(`^${SET}`) })
    .click();
  await expectSetView(page);
  await settings(page).getByLabel("Name").fill(`${SET} renamed`);

  const asked: string[] = [];
  page.once("dialog", dialog => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  const back = page.getByRole("button", { name: `Back to back ${STAMP}` });
  await back.click({ noWaitAfter: true });
  await expect.poll(() => asked).toEqual(["beforeunload"]);
  await expect(page).toHaveURL(/\/in-builder/);

  // Taken back, nothing unsaved: straight to the page.
  await settings(page).getByLabel("Name").fill(SET);
  page.once("dialog", dialog => void dialog.accept());
  await back.click();
  await expect(page).toHaveURL(
    new RegExp(`/collections/pages/${from}/builder`)
  );
});

test("its admin form offers Open in builder", async ({ page }) => {
  const { set } = await seed(page);
  await gotoAdmin(page, `/collections/layouts/${set}`);
  await page.getByRole("link", { name: "Open in builder" }).click();
  await expectSetView(page);
});
