/**
 * The editor's canvas reads real data as the person editing: a bound prop
 * shows the value they could see in the admin, their draft included, and a
 * list of a collection they may not read shows none of its entries.
 *
 * 1. A heading bound to the page's own title shows the page's draft title on
 *    the canvas, where it drew its own text before the canvas read sources.
 * 2. A list of `bound-entries` draws this run's entries for the author who
 *    may read them, and none for an author who may edit pages but may not
 *    read that collection: the canvas reads with each person's own access.
 *
 * @module tests/builder-canvas-bindings.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { fileAccount, test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

const HEADING = "00000000-0000-4000-8000-0000001000b1";
const LIST = "00000000-0000-4000-8000-0000001000b2";
const ITEM = "00000000-0000-4000-8000-0000001000b3";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** A draft page whose heading is bound to its own title, over a list. */
async function seed(
  api: APIRequestContext,
  mark: string
): Promise<{ id: string; title: string }> {
  for (const title of [`${mark} Alder`, `${mark} Birch`]) {
    await created(api, ENTRIES, { title, status: "published" });
  }
  const title = `${mark} draft title`;
  const id = await created(api, PAGES, {
    title,
    slug: `canvas-bindings-${mark.toLowerCase()}`,
    status: "draft",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: HEADING,
          type: "core/heading",
          version: 1,
          props: { text: "Its own text", level: "h1" },
          bindings: { text: { $bind: "title" } },
        },
        {
          id: LIST,
          type: "core/collection-loop",
          version: 1,
          props: {
            collection: "bound-entries",
            limit: 10,
            filters: [{ field: "title", op: "contains", value: mark }],
          },
          slots: {
            children: [
              {
                id: ITEM,
                type: "core/heading",
                version: 1,
                props: { text: "Entry", level: "h3" },
                bindings: { text: { $bind: "title", source: "item" } },
              },
            ],
          },
        },
      ],
    },
  });
  return { id, title };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The canvas's bound heading and the titles its list draws. */
async function drawn(
  page: Page
): Promise<{ heading: string; items: string[] }> {
  const root = await canvasRoot(page);
  return {
    heading:
      (await root.locator(`[data-nx-node="${HEADING}"]`).textContent()) ?? "",
    items: await root.locator(`[data-nx-node="${LIST}"] h3`).allTextContents(),
  };
}

test.describe("the canvas's real data", () => {
  test.describe.configure({ timeout: 240_000 });

  test("shows a bound prop with the author's own draft value", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `B${Date.now().toString(36)}`;
    const { id, title } = await seed(page.request, mark);
    await openBuilder(page, id);
    await expect
      .poll(async () => (await drawn(page)).heading, { timeout: 30_000 })
      .toBe(title);
    await expect
      .poll(async () => (await drawn(page)).items, { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`]);
  });

  test.describe("for an author who may not read the list's collection", () => {
    let admin: APIRequestContext;
    let author: LimitedUser;

    test.beforeAll(async ({ browser, playwright }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      if (baseURL === undefined) {
        throw new Error("[e2e] No baseURL configured.");
      }
      admin = await playwright.request.newContext({
        baseURL,
        storageState: await fileAccount(baseURL, testInfo),
      });
      // May edit pages, and may not read `bound-entries`.
      author = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-pages",
        "update-pages",
        "read-components",
      ]);
    });

    test.afterAll(async () => {
      await author?.context.close();
      await admin?.dispose();
    });

    test("draws none of its entries, though the bound title is theirs", async () => {
      const mark = `L${Date.now().toString(36)}`;
      const { id, title } = await seed(admin, mark);
      const page = await author.context.newPage();
      // The list's read is made, as them, and refused: what follows is the
      // answer, not a read still on its way.
      const refused = page.waitForResponse(
        response =>
          response.url().includes("/list-entries") && response.status() === 403,
        { timeout: 60_000 }
      );
      await openBuilder(page, id);
      await refused;
      // The page they may read fills its bound heading...
      await expect
        .poll(async () => (await drawn(page)).heading, { timeout: 30_000 })
        .toBe(title);
      // ...and the collection they may not read lists nothing of its rows,
      // which the author above, who may read it, was shown.
      const { items } = await drawn(page);
      expect(items.join(" ")).not.toContain(mark);
    });
  });
});
