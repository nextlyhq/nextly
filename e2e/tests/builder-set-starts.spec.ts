/**
 * Where a header & footer set's parts come from, in a real browser on the dev
 * server: "+ New header & footer" in the Pages panel with each of its three
 * starts; "+ Create a header" in a set's picker; and "Also used by <set>" with
 * "Make a separate copy", which points only this set at a copy.
 *
 * Seeded through the admin API: a header component, a footer, two published
 * sets naming the header, and a page naming the first, opened in the builder.
 * Nothing here changes the site default.
 *
 * @module tests/builder-set-starts.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", timeout: 180_000 });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const FIRST = `Quay ${STAMP}`;
const SECOND = `Dock ${STAMP}`;
const HEADER_TEXT = `Beacon ${STAMP}`;

interface Seeded {
  header: string;
  first: string;
  second: string;
  page: string;
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

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const header = await idOf(
    await page.request.post(`${API}/collections/components/entries`, {
      data: {
        title: `Beacon ${STAMP}`,
        slug: `beacon-${STAMP}`,
        area: "header",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "words",
              type: "core/heading",
              version: 1,
              props: { text: HEADER_TEXT, level: "h2" },
            },
          ],
        },
        status: "published",
      },
    }),
    "creating the header"
  );
  const set = async (title: string, slug: string) =>
    idOf(
      await page.request.post(`${API}/collections/layouts/entries`, {
        data: {
          title,
          slug,
          areas: [{ area: "header", component: header }],
          status: "published",
        },
      }),
      `creating ${title}`
    );
  const first = await set(FIRST, `quay-${STAMP}`);
  const second = await set(SECOND, `dock-${STAMP}`);
  const pageId = await idOf(
    await page.request.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Harbour page ${STAMP}`,
        slug: `harbour-page-${STAMP}`,
        layout: first,
        content: { formatVersion: 1, kind: "page", nodes: [] },
        status: "published",
      },
    }),
    "creating the page"
  );
  seeded = { header, first, second, page: pageId };
  return seeded;
}

async function openSetView(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/layouts/${id}/in-builder`);
  await expectSetView(page);
}

async function expectSetView(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/in-builder(\?|$)/);
  await expect(
    (await canvasRoot(page)).getByText("Page content goes here")
  ).toBeVisible({ timeout: 60_000 });
}

async function region(page: Page, area: "header" | "footer"): Promise<Locator> {
  return (await canvasRoot(page)).locator(`[data-nx-region="${area}"]`);
}

function settings(page: Page): Locator {
  return page.getByRole("region", { name: "Header & footer set" });
}

/** The set's areas as saved now, as the caller reads its working draft. */
async function savedAreas(page: Page, id: string): Promise<unknown> {
  const answer = await page.request.get(
    `${API}/collections/layouts/entries/${encodeURIComponent(id)}?draft=true&depth=0`
  );
  const body = (await answer.json()) as { item?: { areas?: unknown } };
  return body.item?.areas;
}

for (const [label, expectHeader] of [
  ["Empty", false],
  ["The starter header and footer", true],
] as const) {
  test(`+ New header & footer from "${label}" opens the new set`, async ({
    page,
  }) => {
    const { page: from } = await seed(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/pages/${from}/builder?field=content`);
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Pages" })
      .click();
    await page.getByRole("button", { name: /New header & footer/ }).click();
    const dialog = page.getByRole("dialog", { name: "New header & footer" });
    const name = `${label.split(" ")[0]} set ${STAMP}`;
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("radio", { name: new RegExp(label) }).click();
    await dialog.getByRole("button", { name: "Create" }).click();
    await expectSetView(page);
    await expect(
      settings(page).getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue(name);
    await expect(await region(page, "header")).toHaveCount(
      expectHeader ? 1 : 0
    );
    // Back to the page it was asked from.
    await expect(
      page.getByRole("button", { name: `Back to Harbour page ${STAMP}` })
    ).toBeVisible();
  });
}

test("+ New header & footer offers a copy of the site default", async ({
  page,
}) => {
  const { page: from } = await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${from}/builder?field=content`);
  const choices = (await (
    await page.request.get(`${PLUGIN}/layouts/choices`)
  ).json()) as {
    items: { id: string; title: string }[];
    meta: { defaultLayout: string | null };
  };
  const defaultTitle = choices.items.find(
    item => item.id === choices.meta.defaultLayout
  )?.title;
  test.skip(defaultTitle === undefined, "This site has no readable default.");
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" })
    .click();
  await page.getByRole("button", { name: /New header & footer/ }).click();
  const dialog = page.getByRole("dialog", { name: "New header & footer" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(`Copy set ${STAMP}`);
  await dialog
    .getByRole("radio", { name: new RegExp(`A copy of ${defaultTitle ?? ""}`) })
    .click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expectSetView(page);
});

test("+ Create a header makes one and chooses it for the set", async ({
  page,
}) => {
  const { second } = await seed(page);
  await openSetView(page, second);
  await settings(page).getByRole("combobox", { name: "Header" }).click();
  await page.getByRole("option", { name: "+ Create a header" }).click();
  // The new header is drawn, and chosen in the picker, before any save.
  await expect(
    settings(page).getByRole("combobox", { name: "Header" })
  ).not.toContainText(`Beacon ${STAMP}`, { timeout: 30_000 });
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "was created as this set's header"
  );
  await expect(await region(page, "header")).toBeVisible();
});

test("Also used by, and Make a separate copy points only this set at a copy", async ({
  page,
}) => {
  const { first, second, header } = await seed(page);
  await openSetView(page, first);
  await expect(settings(page)).toContainText(`Also used by ${SECOND}`);
  await settings(page)
    .getByRole("button", { name: "Make a separate copy" })
    .click();
  await expect(
    settings(page).getByRole("combobox", { name: "Header" })
  ).toContainText(`Beacon ${STAMP} copy`, { timeout: 30_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true })
  ).toBeDisabled({ timeout: 30_000 });
  // This set names the copy; the other still names the original.
  expect(JSON.stringify(await savedAreas(page, first))).not.toContain(header);
  expect(JSON.stringify(await savedAreas(page, second))).toContain(header);
});
