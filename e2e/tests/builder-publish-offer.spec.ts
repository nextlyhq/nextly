/**
 * Publishing a page whose components or Layout are not published: the editor
 * says so before the publish, offers to publish them too, and never blocks.
 *
 * Seeded through the admin API as the dev administrator, who may publish
 * everything, so the offer covers every part. Each test seeds its own page and
 * components under a fresh stamp, so the tests share nothing but the site's
 * default Layout, which the last test changes and puts back.
 *
 * @module tests/builder-publish-offer.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { includingHidden, test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;

const stamp = () =>
  `${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;

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

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const placing = (ids: readonly string[]) =>
  ids.map((componentId, i) => ({
    id: `place-${String(i)}`,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId },
  }));

/** A component, placing `places` after its own heading. */
async function component(
  api: APIRequestContext,
  title: string,
  status: "published" | "draft",
  places: readonly string[] = []
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title,
        slug: `${title.toLowerCase().replaceAll(" ", "-")}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("h", title), ...placing(places)],
        },
        status,
      },
    }),
    `creating ${title}`
  );
}

async function layout(
  api: APIRequestContext,
  title: string,
  header: string,
  status: "published" | "draft"
): Promise<string> {
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

/** A draft page placing `places`, inside `layoutId` when one is named. */
async function draftPage(
  api: APIRequestContext,
  title: string,
  places: readonly string[],
  layoutId: string | null = null
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title,
        slug: title.toLowerCase().replaceAll(" ", "-"),
        status: "draft",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("body", `${title} body`), ...placing(places)],
        },
        ...(layoutId === null ? {} : { layout: layoutId }),
      },
    }),
    `creating ${title}`
  );
}

async function statusOf(
  api: APIRequestContext,
  collection: string,
  id: string
): Promise<unknown> {
  const read = await api.get(
    `${API}/collections/${collection}/entries/${id}?status=all`
  );
  expect(read.ok(), `reading ${collection} ${id}`).toBe(true);
  const body = (await read.json()) as {
    item?: { status?: unknown };
    status?: unknown;
  };
  return body.item?.status ?? body.status;
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The editor's top-bar Publish. */
async function pressPublish(page: Page): Promise<void> {
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: "Publish", exact: true })
    .click();
}

/** The page's status pill in the editor's top bar. */
const pageStatus = (page: Page) =>
  page
    .locator('[data-topbar="start"]')
    .getByText(/^Page status:/)
    .locator("..");

const offer = (page: Page) => page.getByRole("alertdialog");

test("names an unpublished component and publishes both on request", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const card = await component(api, `Pricing card ${s}`, "draft");
  const pageId = await draftPage(api, `Pricing ${s}`, [card]);

  await openBuilder(page, pageId);
  await pressPublish(page);
  await expect(offer(page)).toContainText(
    "This page uses 1 component that isn't published"
  );
  await expect(offer(page)).toContainText(`Pricing card ${s}`);
  // Publishing the page only is the leading choice, and nothing is chosen
  // by pressing Enter: the first focus is Cancel.
  await expect(
    offer(page).getByRole("button", { name: "Cancel" })
  ).toBeFocused();

  await offer(page).getByRole("button", { name: "Publish both" }).click();
  await expect(pageStatus(page)).toHaveText("Page status: Published");
  expect(await statusOf(api, "components", card)).toBe("published");
});

test("publishes the page only, leaving the component, when asked to", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  // Published, then unpublished while nothing placed it, then placed.
  const promo = await component(api, `Promo ${s}`, "published");
  const unpublished = await api.patch(
    `${API}/collections/components/entries/${promo}`,
    { data: { status: "draft", _overwrite: true } }
  );
  expect(unpublished.ok(), await unpublished.text()).toBe(true);
  const pageId = await draftPage(api, `Offers ${s}`, [promo]);

  await openBuilder(page, pageId);
  await pressPublish(page);
  await expect(offer(page)).toContainText(`Promo ${s}`);
  await offer(page).getByRole("button", { name: "Publish page only" }).click();
  await expect(pageStatus(page)).toHaveText("Page status: Published");
  expect(await statusOf(api, "components", promo)).toBe("draft");
});

test("names a component that a published component places", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const badge = await component(api, `Badge ${s}`, "draft");
  const card = await component(api, `Card ${s}`, "published", [badge]);
  const pageId = await draftPage(api, `Nested ${s}`, [card]);

  await openBuilder(page, pageId);
  await pressPublish(page);
  await expect(offer(page)).toContainText(`Badge ${s}`);
  await expect(offer(page)).not.toContainText(`Card ${s}`);
  await offer(page).getByRole("button", { name: "Publish both" }).click();
  await expect(pageStatus(page)).toHaveText("Page status: Published");
  expect(await statusOf(api, "components", badge)).toBe("published");
});

test("names the page's unpublished Layout, and publishes it with the page", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const header = await component(api, `Header ${s}`, "published");
  const landing = await layout(api, `Landing ${s}`, header, "draft");
  const pageId = await draftPage(api, `In Landing ${s}`, [], landing);

  await openBuilder(page, pageId);
  await pressPublish(page);
  await expect(offer(page)).toContainText("This page's Layout isn't published");
  await expect(offer(page)).toContainText("site's default Layout");
  await expect(offer(page)).toContainText(`Landing ${s}`);
  await offer(page).getByRole("button", { name: "Publish both" }).click();
  await expect(pageStatus(page)).toHaveText("Page status: Published");
  expect(await statusOf(api, "layouts", landing)).toBe("published");
});

test("cancelling leaves the page a draft and the save state as it was", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const card = await component(api, `Draft card ${s}`, "draft");
  const pageId = await draftPage(api, `Held ${s}`, [card]);

  await openBuilder(page, pageId);
  await pressPublish(page);
  await expect(offer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(offer(page)).toBeHidden();
  await expect(pageStatus(page)).toHaveText("Page status: Draft");
  // A cancelled publish is not a failed one.
  await expect(includingHidden(page).getByText("Not saved")).toHaveCount(0);
  expect(await statusOf(api, "pages", pageId)).toBe("draft");
  expect(await statusOf(api, "components", card)).toBe("draft");
});

test("asks the same question when the page is published from its form", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const card = await component(api, `Form card ${s}`, "draft");
  const pageId = await draftPage(api, `From the form ${s}`, [card]);

  await gotoAdmin(page, `/collections/pages/${pageId}`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(offer(page)).toContainText(`Form card ${s}`);
  await offer(page).getByRole("button", { name: "Publish both" }).click();
  await expect
    .poll(() => statusOf(api, "pages", pageId), { timeout: 15_000 })
    .toBe("published");
  expect(await statusOf(api, "components", card)).toBe("published");
});

test("asks about a Layout chosen on the form while the question was out", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const header = await component(api, `Late header ${s}`, "published");
  await layout(api, `Late ${s}`, header, "draft");
  const pageId = await draftPage(api, `Edited while asked ${s}`, []);

  await gotoAdmin(page, `/collections/pages/${pageId}`);
  const picker = page.getByRole("combobox", { name: "Layout" });
  await expect(picker).toBeVisible({ timeout: 30_000 });

  // The first question is held until the Layout has changed, so its answer is
  // about the draft from before the change.
  let arrived!: () => void;
  const asked = new Promise<void>(resolve => {
    arrived = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let questions = 0;
  await page.route("**/publish-readiness", async route => {
    try {
      questions += 1;
      if (questions === 1) {
        arrived();
        await released;
      }
      await route.continue();
    } catch {
      // The page went away with the request held: nothing is left to answer.
    }
  });

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await asked;
  await picker.click();
  await page.getByRole("option", { name: new RegExp(`^Late ${s}`) }).click();
  release();

  await expect(offer(page)).toContainText("This page's Layout isn't published");
  await expect(offer(page)).toContainText(`Late ${s}`);
  expect(questions).toBe(2);
  await offer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(offer(page)).toBeHidden();
  expect(await statusOf(api, "pages", pageId)).toBe("draft");
});

test("warns before a Layout with an unpublished header becomes the default", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  const s = stamp();
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const previous = choices.meta.defaultLayout;
  const header = await component(api, `Site header ${s}`, "draft");
  const site = await layout(api, `Site ${s}`, header, "published");
  const pageId = await draftPage(api, `Settings page ${s}`, []);

  try {
    await openBuilder(page, pageId);
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Settings" })
      .click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("tab", { name: "Site" }).click();
    await settings
      .getByRole("combobox", {
        name: "Pages without a Layout of their own use",
      })
      .click();
    await page.getByRole("option", { name: `Site ${s}` }).click();

    await expect(offer(page)).toContainText(
      "This Layout uses 1 component that isn't published"
    );
    await offer(page)
      .getByRole("button", { name: "Publish it, then make default" })
      .click();
    await expect(
      settings.getByRole("status").filter({ hasText: "Saved" })
    ).toBeVisible({ timeout: 15_000 });
    expect(await statusOf(api, "components", header)).toBe("published");
    const after = (await (
      await api.get(`${PLUGIN}/layouts/choices`)
    ).json()) as { meta: { defaultLayout: string | null } };
    expect(after.meta.defaultLayout).toBe(site);
  } finally {
    if (previous !== null) {
      const csrf = (await (await api.get(`${API}/auth/csrf`)).json()) as {
        token: string;
      };
      await api.post(`${PLUGIN}/layouts/${previous}/make-default`, {
        headers: {
          "x-csrf-token": csrf.token,
          origin: new URL(page.url()).origin,
        },
        data: {},
      });
    }
  }
});
