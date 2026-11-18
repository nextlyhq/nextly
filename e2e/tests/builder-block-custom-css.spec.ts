/**
 * A block's custom CSS, for an author who may edit pages but not change the
 * site's code: the panel never shows them the CSS or a way to change it,
 * Layers and the Style tab say the block has some, and a copy they make of
 * the block keeps it, stored on the copy and drawn on the canvas.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  layerRow,
  openLayers,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasLayer } from "./support/canvas-frame";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { storedPageNodes } from "./support/stored-page";
import { fileAccount, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const STYLED = "00000000-0000-4000-8000-00000000c561";
const BLUE = "rgb(0, 0, 255)";
const CSS = `selector { border: 4px solid ${BLUE}; }`;

// One signed-in author for the file: signing in spends the auth budget.
test.describe.configure({ mode: "serial", timeout: 180_000 });

let admin: APIRequestContext;
let author: LimitedUser;
let page: Page;
let pageId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await admin.post(ENTRIES, {
    data: {
      title: `Block custom CSS ${stamp}`,
      slug: `block-custom-css-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: STYLED,
            type: "core/text",
            version: 2,
            name: "Styled words",
            props: { text: "Styled words" },
            customCss: CSS,
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  pageId = id;
  // May edit pages, and nothing of the site's settings.
  author = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
  ]);
  page = await author.context.newPage();
});

test.afterAll(async () => {
  await author?.context.close();
  await admin?.dispose();
});

async function openBuilder(): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(await block(page, STYLED)).toBeVisible({ timeout: 60_000 });
}

test("an editor is told the block has custom CSS, and never shown it", async () => {
  await openBuilder();
  await clickBlock(page, STYLED);
  await expect.poll(() => selection(page)).toEqual([STYLED]);

  await page.getByRole("tab", { name: "Style" }).click();
  const style = page.getByRole("tabpanel", { name: "Style" });
  await expect(
    style.getByText(
      "This block also has custom CSS, set by someone who can change site code."
    )
  ).toBeVisible();
  await expect(style.getByRole("button", { name: "Edit" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Advanced" }).click();
  const advanced = page.getByRole("tabpanel", { name: "Advanced" });
  await expect(advanced.getByText("Custom CSS", { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText("4px solid")).toHaveCount(0);

  await openLayers(page);
  await expect(layerRow(page, STYLED).getByTitle("Has custom CSS")).toHaveCount(
    1
  );
});

test("an editor duplicates the block, and the copy keeps its CSS", async () => {
  await openBuilder();
  await clickBlock(page, STYLED);
  await expect.poll(() => selection(page)).toEqual([STYLED]);
  await canvasLayer(page)
    .getByRole("toolbar", { name: "Block actions" })
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  // Selection follows the copy.
  await expect.poll(async () => (await selection(page))[0]).not.toBe(STYLED);
  const copy = (await selection(page))[0];
  if (copy === undefined) throw new Error("the copy was not selected");
  await expect(await block(page, copy)).toHaveCSS("border-top-color", BLUE);

  await pressSave(page);
  await expect
    .poll(async () =>
      (await storedPageNodes(admin, ENTRIES, pageId)).map(
        node => node.customCss
      )
    )
    .toEqual([CSS, CSS]);
});
