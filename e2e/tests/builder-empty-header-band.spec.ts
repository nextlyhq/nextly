/**
 * The canvas's "No header yet" band: where the site's default header &
 * footer set shows no header, a page following it draws the band in the
 * header's place, and only on the canvas, never on the published page.
 * "Create a header" makes one from the starter's design, puts it in the
 * default and opens it in place; "Use a component" puts a chosen one there;
 * an author who may not publish sets is told who can.
 *
 * Each case makes a set holding nothing the default, made before any header
 * is published here, so a first published header never fills the fresh
 * site's own default. The previous default is put back afterwards; specs
 * that change the default hold the same lock.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-empty-header-band.spec
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
const SENTENCE =
  "No header yet. Pages on this site show no header until you add one.";

/** The default before this file changed it, put back at the end. */
let previousDefault: string | null | undefined;

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

/** A write to a plugin route, with the admin's CSRF token. */
async function pluginWrite(
  page: Page,
  method: "post" | "patch",
  path: string,
  data: unknown
) {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  return page.request[method](`${PLUGIN}${path}`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data,
  });
}

/** Make a header & footer set the site's default, through its one route. */
async function makeDefault(page: Page, id: string): Promise<void> {
  const made = await pluginWrite(
    page,
    "post",
    `/layouts/${id}/make-default`,
    {}
  );
  expect(made.ok(), `make-default: ${made.status()} ${await made.text()}`).toBe(
    true
  );
}

/**
 * A published set holding no header and no footer, made the default, and a
 * published page following it: the page draws the band in both places.
 */
async function emptyDefaultWithPage(
  page: Page,
  name: string
): Promise<{ setTitle: string; page: string; slug: string }> {
  await gotoAdmin(page, "/");
  const api = page.request;
  if (previousDefault === undefined) {
    const choices = (await (
      await api.get(`${PLUGIN}/layouts/choices`)
    ).json()) as { meta: { defaultLayout: string | null } };
    previousDefault = choices.meta.defaultLayout;
  }
  const setTitle = `Bare ${name} ${STAMP}`;
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: setTitle,
        slug: `bare-${name}-${STAMP}`,
        areas: [],
        status: "published",
      },
    }),
    "creating the empty set"
  );
  await makeDefault(page, set);
  const slug = `empty-band-${name}-${STAMP}`;
  const pageId = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Empty band ${name}`,
        slug,
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
    `creating ${slug}`
  );
  return { setTitle, page: pageId, slug };
}

test.afterAll(async ({ browser }) => {
  if (previousDefault === undefined || previousDefault === null) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await makeDefault(page, previousDefault);
  } finally {
    await page.close();
  }
});

async function openBuilder(page: Page, id: string): Promise<Locator> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  const band = (await canvasRoot(page)).locator(
    '[data-nx-region-empty="header"]'
  );
  await expect(band).toContainText(SENTENCE, { timeout: 30_000 });
  return band;
}

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

test("Create a header makes one from the starter's design, puts it in the default and opens it in place", async ({
  page,
}) => {
  const {
    page: id,
    slug,
    setTitle,
  } = await emptyDefaultWithPage(page, "create");
  const band = await openBuilder(page, id);
  // Both areas are empty, so the footer has its band too.
  await expect(
    (await canvasRoot(page)).locator('[data-nx-region-empty="footer"]')
  ).toContainText("No footer yet.");
  // Never on the published page: a visitor's page draws nothing there.
  const before = await page.request.get(`/${slug}`);
  expect(before.ok()).toBe(true);
  expect(await before.text()).not.toContain("No header yet");

  await band.getByRole("button", { name: "Create a header" }).click();
  await expect(
    toast(
      page,
      `It is now the header of every page that uses the ${setTitle} header & footer.`
    )
  ).toBeVisible();

  // The new header in the band's place, from the starter's design, opened
  // for editing in place.
  const header = (await canvasRoot(page)).locator('[data-nx-region="header"]');
  await expect(header).toContainText("Contact us", { timeout: 30_000 });
  await expect(band).toHaveCount(0);
  const bar = page.locator(".nx-region-bar");
  await expect(bar.getByRole("button", { name: "Done" })).toBeVisible();
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toHaveCount(0);

  // Published: a visitor's page shows it.
  const after = await page.request.get(`/${slug}`);
  expect(after.ok()).toBe(true);
  expect(await after.text()).toContain("Contact us");
});

test("Use a component puts the one chosen in the default's header", async ({
  page,
}) => {
  const { page: id, setTitle } = await emptyDefaultWithPage(page, "use");
  const chosen = `Lakeside header ${STAMP}`;
  const chosenText = `Lakeside Rowing ${STAMP}`;
  // Published after the empty set became the default, so it fills nothing
  // by itself.
  await idOf(
    await page.request.post(`${API}/collections/components/entries`, {
      data: {
        title: chosen,
        slug: `lakeside-header-${STAMP}`,
        area: "header",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "h",
              type: "core/heading",
              version: 1,
              props: { text: chosenText, level: "h2" },
            },
          ],
        },
        status: "published",
      },
    }),
    "creating the header component"
  );
  const band = await openBuilder(page, id);
  await band.getByRole("button", { name: /Use a component/ }).click();
  const row = page.getByRole("option").filter({
    has: page.locator('[data-slot="hf-name"]').getByText(chosen, {
      exact: true,
    }),
  });
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    toast(
      page,
      `${chosen} is now the header of every page that uses the ${setTitle} header & footer.`
    )
  ).toBeVisible();
  const header = (await canvasRoot(page)).locator('[data-nx-region="header"]');
  await expect(header).toContainText(chosenText, { timeout: 30_000 });
  await expect(band).toHaveCount(0);
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

  test("the band says who can fill it, and offers nothing", async ({
    page,
  }) => {
    const { page: id } = await emptyDefaultWithPage(page, "ask");
    const authorPage = await author.context.newPage();
    const band = await openBuilder(authorPage, id);
    await expect(band).toContainText(
      "Ask someone who can change the site's header."
    );
    await expect(band.getByRole("button")).toHaveCount(0);
    await authorPage.close();
  });
});
