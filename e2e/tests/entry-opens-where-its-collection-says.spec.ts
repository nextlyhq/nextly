/**
 * An entry opens where its collection says, the same from every link meant to
 * open it. The fixture's builder-first pages say their entries open in the
 * Page Builder, though by their main field (an excerpt) they would open as a
 * form: a list row, a row found by the list's search and a row of the
 * dashboard's Continue card all open the builder, and a middle click opens it
 * in a new tab. Opening the form by its own address keeps working and changes
 * nothing about where the next click lands. A reader who may only read lands
 * on the form, read-only; a row opened in a second language opens the form in
 * that language; and with the builder's views not published, as on a site
 * without the plugin, every row opens the form.
 */
import { expect, type Page, type Route } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { includingHidden, test } from "./support/test";

// Reads the dashboard's Continue card, which other specs arrange.
test.describe.configure({ lock: [LOCK.dashboard] });

const SLUG = "builder-first-pages";
const LIST = `/collections/${SLUG}`;
const RUN = Date.now().toString(36);

/** The builder's address for an entry, on the field the collection names. */
const builderAt = (id: string) =>
  new RegExp(`/admin/collections/${SLUG}/${id}/builder\\?field=sections$`);
/** The form's address for an entry, with nothing after it but a language. */
const formAt = (id: string, query = "") =>
  new RegExp(`/admin/collections/${SLUG}/${id}${query.replace("?", "\\?")}$`);

/** A new draft of the collection, saved by whoever `page` is signed in as. */
async function savePage(page: Page, title: string): Promise<string> {
  return createEntry(page.request, SLUG, {
    title,
    excerpt: "A short summary.",
    status: "draft",
  });
}

/** The link a list row draws for `title`. */
const rowLink = (page: Page, title: string) =>
  page
    .getByRole("table", { name: "Entries table" })
    .getByRole("link", { name: title, exact: true });

const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

test("a list row opens the builder, and the form's own address still opens the form", async ({
  page,
}) => {
  const title = `Opens in builder ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, LIST);
  await expect(rowLink(page, title)).toHaveAttribute("href", builderAt(id));
  await rowLink(page, title).click();
  await expect(page).toHaveURL(builderAt(id));
  await expect(excerpt(page)).toHaveCount(0);

  // An old link or a bookmark to the form keeps opening the form.
  await gotoAdmin(page, `${LIST}/${id}`);
  await expect(excerpt(page)).toHaveValue("A short summary.");
});

test("opening the form changes nothing about where the next click lands", async ({
  page,
}) => {
  const title = `No memory ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, `${LIST}/${id}`);
  await expect(excerpt(page)).toBeVisible();
  await gotoAdmin(page, LIST);
  await rowLink(page, title).click();
  await expect(page).toHaveURL(builderAt(id));
});

test("a row found by the list's search opens the builder", async ({ page }) => {
  const title = `Found by search ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, LIST);
  await page.getByRole("searchbox").first().fill(title);
  await expect(rowLink(page, title)).toHaveCount(1);
  await rowLink(page, title).click();
  await expect(page).toHaveURL(builderAt(id));
});

test("a middle click on a row opens the builder in a new tab", async ({
  page,
  context,
}) => {
  const title = `New tab ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, LIST);
  const listUrl = page.url();
  const opened = context.waitForEvent("page");
  await rowLink(page, title).click({ button: "middle" });
  const tab = await opened;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(builderAt(id));
  expect(page.url()).toBe(listUrl);
  await tab.close();
});

test("a Continue card row opens the builder", async ({ page }) => {
  const title = `Continue in builder ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, "");
  const row = page
    .getByTestId("widget-cell-core/continue")
    .getByTestId("entity-row")
    .filter({ hasText: title });
  const link = row.getByRole("link", { name: title });
  await expect(link).toHaveAttribute("href", builderAt(id));
  await link.click();
  await expect(page).toHaveURL(builderAt(id));
});

test("a row opened in a second language opens the form in that language", async ({
  page,
}) => {
  const title = `In Spanish ${RUN}`;
  const id = await savePage(page, title);

  await gotoAdmin(page, LIST);
  const row = page
    .getByRole("table", { name: "Entries table" })
    .getByRole("row")
    .filter({ hasText: title });
  await row.getByRole("button", { name: /^Open in Spanish/ }).click();
  await expect(page).toHaveURL(formAt(id, "?locale=es"));
  await expect(excerpt(page)).toBeVisible();
});

test("a reader who may only read opens the form, read-only", async ({
  browser,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  const title = `Read only ${RUN}`;
  let reader;
  let id: string;
  try {
    id = await createEntry(admin, SLUG, {
      title,
      excerpt: "A short summary.",
      status: "draft",
    });
    reader = await signInAsLimitedUser(browser, admin, baseURL, [
      `read-${SLUG}`,
    ]);
  } finally {
    await admin.dispose();
  }
  try {
    const page = await reader.context.newPage();
    await gotoAdmin(page, LIST);
    await expect(rowLink(page, title)).toHaveAttribute("href", formAt(id));
    await rowLink(page, title).click();
    await expect(page).toHaveURL(formAt(id));
    await expect(page.getByTestId("document-lock-banner")).toHaveText(
      "Your access lets you view this, but not change it. If you need to change it, ask an admin."
    );
  } finally {
    await reader.context.close();
  }
});

/**
 * The workspace half of the admin's metadata, which lists the plugins, with
 * every plugin's document views taken out.
 */
async function withoutDocumentViews(route: Route): Promise<void> {
  try {
    const response = await route.fetch();
    const body = (await response.json()) as {
      plugins?: Record<string, unknown>[];
    };
    for (const plugin of body.plugins ?? []) delete plugin.documentViews;
    await route.fulfill({ response, json: body });
  } catch {
    // The page went away mid-request; nothing is left to answer.
  }
}

test("with the builder's views not published, a row opens the form", async ({
  page,
}) => {
  const title = `No builder ${RUN}`;
  const id = await savePage(page, title);

  // The startup request carries the same answer in one batch; refused, the
  // admin asks each path on its own, so the metadata comes from the route below.
  await page.route(
    url => url.pathname.endsWith("/startup"),
    async route => {
      try {
        await route.abort();
      } catch {
        // The page went away mid-request.
      }
    }
  );
  await page.route(
    url => url.pathname.endsWith("/admin-meta/workspace"),
    withoutDocumentViews
  );
  await gotoAdmin(page, LIST);
  await expect(rowLink(page, title)).toHaveAttribute("href", formAt(id));
  await rowLink(page, title).click();
  await expect(excerpt(page)).toHaveValue("A short summary.");
  // Nothing offers the builder where its views are not published, not even
  // in a hidden copy of the page.
  await expect(includingHidden(page).getByText("Open in builder")).toHaveCount(
    0
  );
});
