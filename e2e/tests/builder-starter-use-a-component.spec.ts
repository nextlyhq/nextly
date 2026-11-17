/**
 * "Use a component ▾" on the card of a fresh site's starter header: the
 * published components marked "Use as: Header", each with its picture, and
 * the one chosen put in the site default's header, drawn on the canvas at
 * once and on the published page.
 *
 * Starts from the fresh site's default and its starter. The starter header
 * is put back in the default afterwards, so the specs that find it there
 * still do; specs that change the default hold the same lock.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-starter-use-a-component.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

// Each test opens the builder, whose first draw on a dev server is slow.
test.describe.configure({
  mode: "serial",
  lock: [LOCK.siteDefaultLayout],
  timeout: 120_000,
});

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const CHOSEN = `Ridgeline header ${STAMP}`;
const CHOSEN_TEXT = `Ridgeline Surveys ${STAMP}`;
const PAGE_SLUG = `use-a-component-${STAMP}`;

interface Choices {
  items: {
    id: string;
    title: string;
    regions: { area: string; componentId: string }[];
  }[];
  meta: {
    defaultLayout: string | null;
    regionComponents: Record<string, { untouchedStarter?: string }>;
  };
}

interface Seeded {
  /** The site default, which holds the starter. */
  set: string;
  setTitle: string;
  starter: string;
  page: string;
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
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function choices(api: APIRequestContext): Promise<Choices> {
  const answer = await api.get(`${PLUGIN}/layouts/choices`);
  expect(answer.ok(), `choices: ${answer.status()}`).toBe(true);
  return (await answer.json()) as Choices;
}

/** Put `component` in the header of set `set`, through the plugin's route. */
async function putHeader(
  page: Page,
  set: string,
  component: string
): Promise<void> {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const put = await page.request.patch(
    `${PLUGIN}/layouts/${encodeURIComponent(set)}/areas/header`,
    {
      headers: {
        "x-csrf-token": csrf.token,
        origin: new URL(page.url()).origin,
      },
      data: { component },
    }
  );
  expect(put.ok(), `put header: ${put.status()} ${await put.text()}`).toBe(
    true
  );
}

/** The default set, and the starter header component the fresh site made. */
async function defaultWithStarter(
  page: Page
): Promise<{ set: string; setTitle: string; starter: string }> {
  const { items, meta } = await choices(page.request);
  const set = items.find(item => item.id === meta.defaultLayout);
  if (set === undefined) throw new Error("[e2e] no site default");
  const header = set.regions.find(region => region.area === "header");
  if (
    header !== undefined &&
    meta.regionComponents[header.componentId]?.untouchedStarter === "header"
  ) {
    return { set: set.id, setTitle: set.title, starter: header.componentId };
  }
  // Something replaced it, a first published header among them: the starter
  // is still a published component marked for the header, to put back.
  const listed = (await (
    await page.request.get(`${PLUGIN}/layouts/area-components?area=header`)
  ).json()) as { items: { id: string; title: string }[] };
  const starter = listed.items.find(item => item.title === "Starter header");
  if (starter === undefined) throw new Error("[e2e] no starter header");
  await putHeader(page, set.id, starter.id);
  return { set: set.id, setTitle: set.title, starter: starter.id };
}

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: CHOSEN,
        slug: `ridgeline-header-${STAMP}`,
        area: "header",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "h",
              type: "core/heading",
              version: 1,
              props: { text: CHOSEN_TEXT, level: "h2" },
            },
          ],
        },
        status: "published",
      },
    }),
    "creating the header component"
  );
  // Read after the component is published: a site's first published header
  // may fill the default, and the starter is then put back.
  const start = await defaultWithStarter(page);
  const pageId = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Use a component ${STAMP}`,
        slug: PAGE_SLUG,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "body",
              type: "core/heading",
              version: 1,
              props: { text: "Page body", level: "h1" },
            },
          ],
        },
      },
    }),
    "creating the page"
  );
  seeded = { ...start, page: pageId };
  return seeded;
}

test.afterAll(async ({ browser }) => {
  if (seeded === undefined) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await putHeader(page, seeded.set, seeded.starter);
  } finally {
    await page.close();
  }
});

async function openBuilder(page: Page, id: string): Promise<Locator> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  const header = (await canvasRoot(page)).locator('[data-nx-region="header"]');
  await expect(header).toContainText("Contact us", { timeout: 30_000 });
  return header;
}

/** The sidebar's card for the selected header. */
function card(page: Page): Locator {
  return page
    .getByRole("complementary")
    .getByRole("region", { name: "Site header" });
}

/** A menu row by its name. */
function option(page: Page, name: string): Locator {
  return page.getByRole("option").filter({
    has: page.locator('[data-slot="hf-name"]').getByText(name, { exact: true }),
  });
}

test("the starter's card offers the components marked for the header, with pictures, and the one chosen replaces it everywhere", async ({
  page,
}) => {
  const { page: id, setTitle } = await seed(page);
  const header = await openBuilder(page, id);
  await expect(header).toHaveAccessibleName(
    `Starter header, from the ${setTitle} header & footer`
  );

  await header.click();
  const shown = card(page);
  await expect(
    shown.getByRole("button", { name: "Edit header" })
  ).toBeVisible();
  const use = shown.getByRole("button", { name: "Use a component" });
  await expect(use).toBeVisible();
  await use.click();

  // Each component marked for the header, with its picture drawn from what
  // is published; the starter shown now is the current one.
  await expect(option(page, CHOSEN)).toBeVisible();
  await expect(
    option(page, CHOSEN).locator(
      '.nx-pb-hf-picture .nx-picture[data-state="drawn"]'
    )
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(option(page, "Starter header")).toContainText("(current)");

  await option(page, CHOSEN).click();
  await expect(
    page.getByText(
      `${CHOSEN} is now the header of every page that uses the ${setTitle} header & footer.`
    )
  ).toBeVisible();

  // Drawn on the canvas at once, no longer the starter, and the card no
  // longer offers to replace it.
  await expect(header).toContainText(CHOSEN_TEXT, { timeout: 30_000 });
  await expect(header).not.toContainText("Contact us");
  await expect(header).toHaveAccessibleName(
    `Site header, from the ${setTitle} header & footer`
  );
  await expect(card(page)).toBeVisible();
  await expect(
    card(page).getByRole("button", { name: "Use a component" })
  ).toHaveCount(0);

  // Published: a visitor's page shows it.
  const published = await page.request.get(`/${PAGE_SLUG}`);
  expect(published.ok()).toBe(true);
  expect(await published.text()).toContain(CHOSEN_TEXT);
});

test.describe("for an author who may not publish header & footer sets", () => {
  let admin: APIRequestContext;
  let author: LimitedUser;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    author = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-pages",
      "update-pages",
      "read-components",
      "update-components",
      "read-layouts",
      "update-layouts",
    ]);
  });

  test.afterAll(async () => {
    await author?.context.close();
    await admin?.dispose();
  });

  test("shows the starter's card without Use a component", async ({ page }) => {
    const { page: id, set, starter } = await seed(page);
    // The starter is back in the default, as a fresh site has it.
    await gotoAdmin(page, "/");
    await putHeader(page, set, starter);
    const authorPage = await author.context.newPage();
    const header = await openBuilder(authorPage, id);
    await header.click();
    const shown = card(authorPage);
    await expect(
      shown.getByRole("button", { name: "Edit header" })
    ).toBeVisible();
    await expect(
      shown.getByRole("button", { name: "Page settings" })
    ).toBeVisible();
    await expect(
      shown.getByRole("button", { name: "Use a component" })
    ).toHaveCount(0);
    await authorPage.close();
  });
});
