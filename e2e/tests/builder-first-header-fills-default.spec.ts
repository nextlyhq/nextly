/**
 * The first header an author publishes takes the starter's place in the site
 * default, once, and the builder says so: "<Name> now shows on every page.",
 * "Pages that chose a different header keep theirs." and "Change in Header &
 * footer", which opens the Pages panel at its Header & footer sets. A second
 * header published later changes nothing and says nothing.
 *
 * The browser tests start on a fresh database, so the site default is the
 * boot's own seed, holding the untouched starter. This spec holds the site
 * default's lock, and puts the starter back in Main when it is done, so the
 * starter's own spec still finds it there. The fill happens once per site,
 * so no later publish in the run fills Main again; and only someone's publish
 * fills, so the playground's own seeded header never does.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-first-header-fills-default.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const FIRST = `Acme header ${STAMP}`;
const SECOND = `Second header ${STAMP}`;

interface Choices {
  items: {
    id: string;
    title: string;
    regions: { area: string; componentId: string }[];
  }[];
  meta: { defaultLayout: string | null };
}

/** Main as the boot seeded it, read before this spec changed anything. */
let seeded: { id: string; areas: Record<string, string> } | undefined;

async function choices(api: APIRequestContext): Promise<Choices> {
  const answer = await api.get(`${PLUGIN}/layouts/choices`);
  expect(answer.ok(), `choices: ${answer.status()}`).toBe(true);
  return (await answer.json()) as Choices;
}

/** The default set's areas, as `{ area: componentId }`. */
async function defaultAreas(
  api: APIRequestContext
): Promise<{ id: string; areas: Record<string, string> }> {
  const { items, meta } = await choices(api);
  const set = items.find(item => item.id === meta.defaultLayout);
  if (set === undefined) throw new Error("no default set");
  return {
    id: set.id,
    areas: Object.fromEntries(set.regions.map(r => [r.area, r.componentId])),
  };
}

/** A draft component used as the header, holding one heading. */
async function draftHeader(
  api: APIRequestContext,
  title: string
): Promise<string> {
  const created = await api.post(`${API}/collections/components/entries`, {
    data: {
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      area: "header",
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "title",
            type: "core/heading",
            version: 1,
            props: { text: title, level: "h2" },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `creating ${title}: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function statusOf(api: APIRequestContext, id: string): Promise<unknown> {
  const read = await api.get(
    `${API}/collections/components/entries/${id}?status=all`
  );
  expect(read.ok(), `reading component ${id}`).toBe(true);
  const body = (await read.json()) as {
    item?: { status?: unknown };
    status?: unknown;
  };
  return body.item?.status ?? body.status;
}

/**
 * Open a component in the builder and publish it from the top bar, until the
 * builder has asked what the publish filled.
 */
async function publishInBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/components/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  const asked = page.waitForResponse(
    response =>
      response.url().includes("/default-layout/fill-notices") &&
      response.request().method() === "POST",
    { timeout: 30_000 }
  );
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  expect((await asked).ok(), "the builder asked what was filled").toBe(true);
  expect(await statusOf(page.request, id)).toBe("published");
}

const headline = (title: string) => `${title} now shows on every page.`;

test.afterAll(async ({ browser }) => {
  if (seeded === undefined) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    // The starter back in Main, as the boot seeded it.
    const restored = await page.request.patch(
      `${API}/collections/layouts/entries/${seeded.id}`,
      {
        data: {
          areas: Object.entries(seeded.areas).map(([area, component]) => ({
            area,
            component,
          })),
          status: "published",
          _overwrite: true,
        },
      }
    );
    expect(
      restored.ok(),
      `restoring Main: ${restored.status()} ${await restored.text()}`
    ).toBe(true);
  } finally {
    await page.close();
  }
});

test("the first header published in the builder takes the starter's place in Main, and says so", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  seeded = await defaultAreas(page.request);
  const starterHeader = seeded.areas.header;
  expect(starterHeader, "Main holds the starter header").toBeTruthy();

  const first = await draftHeader(page.request, FIRST);
  await publishInBuilder(page, first);

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: headline(FIRST) });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(
    "Pages that chose a different header keep theirs."
  );
  const link = toast.getByRole("button", { name: "Change in Header & footer" });
  await expect(link).toBeVisible();

  const after = await defaultAreas(page.request);
  expect(after.id).toBe(seeded.id);
  expect(after.areas).toEqual({ ...seeded.areas, header: first });
  // The starter stays in Components, published.
  expect(await statusOf(page.request, starterHeader ?? "")).toBe("published");

  // In the builder, the link opens the Pages panel at its sets.
  await link.click();
  await expect(
    page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Pages" })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("list", { name: "Header & footer sets" })
  ).toBeVisible();
});

test("a second header published later changes nothing and says nothing", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const before = await defaultAreas(page.request);
  const second = await draftHeader(page.request, SECOND);
  await publishInBuilder(page, second);
  // Asked and answered: nothing was waiting, so nothing is said.
  await expect(page.getByText(/now shows on every page\./)).toBeHidden();
  expect(await defaultAreas(page.request)).toEqual(before);
});
