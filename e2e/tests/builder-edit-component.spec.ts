/**
 * "Edit component": from a page's builder, the inspector of a placement and
 * the block toolbar open the component alone in its own view, with a banner
 * naming it and how many pages a change reaches, and one Back, naming the
 * page, returns to it with the placement selected. Unsaved page changes are asked about first, and
 * an author who may not update components is not offered it.
 *
 * Each test makes its own component and page through the admin API.
 *
 * @module tests/builder-edit-component
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { layerRow, openLayers, selectedLayers } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { fileAccount, test } from "./support/test";

const COMPONENTS = "/admin/api/collections/components/entries";
const PAGES = "/admin/api/collections/pages/entries";
const INSTANCE = "nextly/component-instance";

function tag(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** A published component and a published page placing it; answers both ids. */
async function seed(request: APIRequestContext): Promise<{
  component: string;
  page: string;
  title: string;
  pageTitle: string;
}> {
  const t = tag();
  const title = `Promo ${t}`;
  const component = await request.post(COMPONENTS, {
    data: {
      title,
      slug: `promo-${t}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "promo-heading",
            type: "core/heading",
            version: 1,
            props: { text: "Inside the component", level: "h2" },
          },
        ],
      },
    },
  });
  expect(component.ok(), `creating the component: ${component.status()}`).toBe(
    true
  );
  const componentId = ((await component.json()) as { item: { id: string } })
    .item.id;
  const pageTitle = `Host ${t}`;
  const page = await request.post(PAGES, {
    data: {
      title: pageTitle,
      slug: `host-${t}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "intro",
            type: "core/heading",
            version: 1,
            props: { text: "On the page", level: "h1" },
          },
          {
            id: "placed",
            type: INSTANCE,
            version: 1,
            props: { componentId },
          },
        ],
      },
    },
  });
  expect(page.ok(), `creating the page: ${page.status()}`).toBe(true);
  const pageId = ((await page.json()) as { item: { id: string } }).item.id;
  return { component: componentId, page: pageId, title, pageTitle };
}

async function openPage(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await openLayers(page);
  await expect(layerRow(page, "placed")).toBeVisible({ timeout: 30_000 });
  await layerRow(page, "placed").click();
}

const banner = (page: Page) =>
  page.getByRole("region", { name: "Editing a component" });

test.describe("Edit component", () => {
  test.describe.configure({ timeout: 180_000 });

  test("opens the component alone from the inspector, says what it reaches, and Back returns to the placement", async ({
    page,
  }) => {
    const seeded = await seed(page.request);
    await openPage(page, seeded.page);

    await page
      .getByTestId("inspector")
      .getByRole("button", { name: "Edit component" })
      .click();

    await expect(page).toHaveURL(
      new RegExp(
        `/admin/collections/components/${seeded.component}/builder\\?field=content&return=`
      )
    );
    await expect(banner(page)).toContainText(seeded.title);
    // Pages, and "at least" only while the usage index is still being filled.
    await expect(banner(page)).toContainText(
      /Changes reach (at least )?1 page(?!s)/
    );
    // One way back, in the banner, naming the page it returns to; the
    // editor's own exit arrow is withheld while it is offered.
    await expect(page.getByRole("button", { name: "Exit editor" })).toHaveCount(
      0
    );
    // The component alone: its own blocks, none of the page's.
    await openLayers(page);
    await expect(layerRow(page, "promo-heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(layerRow(page, "intro")).toHaveCount(0);

    await banner(page)
      .getByRole("button", { name: `Back to ${seeded.pageTitle}` })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/pages/${seeded.page}/builder\\?`)
    );
    // The page again, with the placement selected where the author left it.
    await expect(layerRow(page, "intro")).toBeVisible({ timeout: 30_000 });
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => selectedLayers(page)).toEqual(["placed"]);
  });

  test("opens it from the block toolbar too", async ({ page }) => {
    const seeded = await seed(page.request);
    await openPage(page, seeded.page);

    await page
      .getByRole("toolbar", { name: "Block actions" })
      .getByRole("button", { name: "Edit component" })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/components/${seeded.component}/builder`)
    );
    await expect(banner(page)).toContainText(seeded.title);
  });

  test("asks first when the page has unsaved changes", async ({ page }) => {
    const seeded = await seed(page.request);
    await openPage(page, seeded.page);
    await layerRow(page, "intro").click();
    await page.keyboard.press("Delete");
    await expect(layerRow(page, "intro")).toHaveCount(0);
    await layerRow(page, "placed").click();

    // The move is a load of the component's own address, which the
    // unsaved-changes guard answers by asking: declined, the page stays.
    const asked: string[] = [];
    page.once("dialog", dialog => {
      asked.push(dialog.type());
      void dialog.dismiss();
    });
    await page
      .getByTestId("inspector")
      .getByRole("button", { name: "Edit component" })
      .click({ noWaitAfter: true });
    await expect.poll(() => asked).toEqual(["beforeunload"]);
    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/pages/${seeded.page}/builder`)
    );
    await expect(layerRow(page, "intro")).toHaveCount(0);
  });
});

test.describe("Edit component, for an author who may not update components", () => {
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
    ]);
  });

  test.afterAll(async () => {
    await author?.context.close();
    await admin?.dispose();
  });

  test("is not offered", async () => {
    test.setTimeout(180_000);
    const seeded = await seed(admin);
    const page = await author.context.newPage();
    await openPage(page, seeded.page);
    // The placement's own inspector is drawn, without the offer.
    await expect(
      page.getByRole("complementary").getByText(seeded.title).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Edit component" })
    ).toHaveCount(0);
  });
});
