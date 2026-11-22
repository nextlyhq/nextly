/**
 * Page checks under Content and data and Publishing:
 * - the page's data count, always, as a line under Content and data;
 * - an Image with no picture, a Button with no link and a Collection list
 *   with no source, each opening the setting that fixes it;
 * - a component the page uses that isn't published, gone once it is;
 * - over the page data limit, each block that then shows empty, named.
 *
 * Seeded through the admin API. Black box like the rest of `e2e/`: no
 * product code is imported.
 *
 * @module tests/builder-page-checks-content.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const PAGES = `${API}/collections/pages/entries`;
const POSTS = `${API}/collections/posts/entries`;
const COMPONENTS = `${API}/collections/components/entries`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

async function idOf(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function seedPage(
  page: Page,
  name: string,
  nodes: unknown[]
): Promise<string> {
  await gotoAdmin(page, "/");
  return idOf(
    await page.request.post(PAGES, {
      data: {
        title: `${name} ${STAMP}`,
        slug: `${name.toLowerCase().replaceAll(" ", "-")}-${STAMP}`,
        content: { formatVersion: 1, kind: "page", nodes },
      },
    }),
    name
  );
}

async function openChecks(page: Page, id: string) {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^(\d+ checks?|Checks)\b/ })
    .click();
  const list = page.getByRole("dialog", { name: "Page checks" });
  await expect(list).toBeVisible();
  return list;
}

test("lists the empty blocks and the page's data, and opens each fix", async ({
  page,
}) => {
  const id = await seedPage(page, "Empty blocks", [
    { id: "picture", type: "core/image", version: 1, props: {} },
    { id: "go", type: "core/button", version: 1, props: { label: "Go" } },
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { limit: 3 },
      slots: { children: [] },
    },
  ]);
  const list = await openChecks(page, id);
  const content = list.getByRole("region", { name: "Content and data" });
  // The page's data, always, though nothing on it reads any yet: counted
  // once the page is drawn off screen, which a cold server takes a while to.
  await expect(content).toContainText(/Page data: \d+ of 500/, {
    timeout: 30_000,
  });
  await expect(content).toContainText("Image has no picture");
  await expect(content).toContainText("Collection list has no source");
  // The Button's item opens its Link, where the fix is.
  await content.getByRole("button", { name: /^Button has no link/ }).click();
  // The Link picker, with the cursor on it, which a link is chosen through.
  const link = page
    .locator(".nx-inspector")
    .getByRole("button", { name: /^Link:/ });
  await expect(link).toBeFocused();
  await link.click();
  const search = page.getByRole("combobox", {
    name: "Search pages or paste a URL for link",
  });
  await search.fill("/signup");
  await search.press("Enter");
  // The Link now names it, and the fix bar counts the item fixed at once.
  await expect(
    page
      .locator(".nx-inspector")
      .getByRole("button", { name: /^Link: \/signup/ })
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^Fixed/ })
  ).toBeVisible();
  // Judged on the draft as it stands: the item is gone, unsaved, in the
  // list the fix bar opens again.
  await page.getByRole("button", { name: "All checks" }).click();
  await expect(
    page.getByRole("dialog", { name: "Page checks" })
  ).not.toContainText("Button has no link");
});

test("lists a component the page uses that isn't published, until it is", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const title = `Call to action ${STAMP}`;
  const component = await idOf(
    await page.request.post(COMPONENTS, {
      data: {
        title,
        slug: `call-to-action-${STAMP}`,
        status: "draft",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "cta-text",
              type: "core/heading",
              version: 1,
              props: { text: "Join us", level: "h2" },
            },
          ],
        },
      },
    }),
    "component"
  );
  const id = await seedPage(page, "Uses a draft component", [
    {
      id: "placed",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: component },
    },
  ]);
  const list = await openChecks(page, id);
  const publishing = list.getByRole("region", { name: "Publishing" });
  await expect(publishing).toContainText(`Component not published: ${title}`, {
    timeout: 15_000,
  });
  // Published elsewhere, then the page saved: asked again, the item goes.
  const published = await page.request.patch(`${COMPONENTS}/${component}`, {
    data: { status: "published", _overwrite: true },
  });
  expect(published.ok(), await published.text()).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^(\d+ checks?|Checks)\b/ })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Page checks" })
      .getByRole("region", { name: "Publishing" })
  ).not.toContainText("Component not published", { timeout: 15_000 });
});

/** At least this many posts, so the outer list draws this many entries. */
const ENTRIES = 10;

test("names each block that shows empty over the page data limit", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const counted = await page.request.get(`${POSTS}?limit=1`);
  expect(counted.ok(), await counted.text()).toBe(true);
  const total = ((await counted.json()) as { meta: { total: number } }).meta
    .total;
  for (let made = total; made < ENTRIES; made += 1) {
    await idOf(
      await page.request.post(POSTS, {
        data: {
          title: `Data post ${String(made)}`,
          slug: `data-post-${STAMP}-${String(made)}`,
        },
      }),
      "post"
    );
  }
  // Ten posts, each drawing fifty lists of one post: 501 reads, past the 500
  // a page may make, so the last are refused and their lists come up empty.
  const inner = Array.from({ length: 50 }, (_, index) => ({
    id: `inner-${String(index)}`,
    type: "core/collection-loop",
    version: 1,
    props: { collection: "posts", limit: 1 },
    slots: { children: [] },
  }));
  const id = await seedPage(page, "Over the limit", [
    {
      id: "outer",
      type: "core/collection-loop",
      version: 1,
      name: "All posts",
      props: { collection: "posts", limit: ENTRIES },
      slots: { children: inner },
    },
  ]);
  const list = await openChecks(page, id);
  const content = list.getByRole("region", { name: "Content and data" });
  await expect(content).toContainText("Page data: 500 of 500", {
    timeout: 60_000,
  });
  await expect(
    content.getByRole("button", { name: /^Over the page data limit/ }).first()
  ).toBeVisible();
});
