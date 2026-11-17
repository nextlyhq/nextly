/**
 * The other view of an entry is one step away. On the fixture's builder-first
 * pages, whose rows open the Page Builder, a row's menu offers "Edit details",
 * which opens the form, and a person reaches it with the keyboard alone. On
 * Posts, which open as a form and have a blocks field, the row's menu and the
 * form's document bar both offer the builder, in the words its view declares
 * (`openLabel`), or "Open in" its label where it declares none.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

const BUILDER_FIRST = "builder-first-pages";
const RUN = Date.now().toString(36);

/** The builder's words as the view declares them, or as the admin words its label. */
const OPEN_IN_BUILDER = /^Open in (Page )?[Bb]uilder$/;

const table = (page: Page) =>
  page.getByRole("table", { name: "Entries table" });

const rowOf = (page: Page, title: string) =>
  table(page).getByRole("row").filter({ hasText: title });

test('a builder-first row\'s menu reaches "Edit details" by keyboard, and it opens the form', async ({
  page,
}) => {
  const title = `Edit details ${RUN}`;
  const id = await createEntry(page.request, BUILDER_FIRST, {
    title,
    excerpt: "A short summary.",
    status: "draft",
  });
  await gotoAdmin(page, `/collections/${BUILDER_FIRST}`);
  await expect(rowOf(page, title)).toHaveCount(1);

  // Tab from the page's start to the row's menu button, as a keyboard user
  // does; the bound only keeps a regression from looping forever.
  const rowMenu = rowOf(page, title).getByRole("button", {
    name: "Row actions",
  });
  await page.locator("body").focus();
  let reached = false;
  for (let step = 0; step < 200 && !reached; step += 1) {
    await page.keyboard.press("Tab");
    reached = await rowMenu.evaluate(
      button => button === document.activeElement
    );
  }
  expect(reached).toBe(true);

  await page.keyboard.press("Enter");
  const editDetails = page.getByRole("menuitem", { name: "Edit details" });
  await expect(editDetails).toBeVisible();
  // Arrow down the menu until "Edit details" holds the focus.
  for (let step = 0; step < 10; step += 1) {
    if (await editDetails.evaluate(item => item === document.activeElement)) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  await expect(editDetails).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/${BUILDER_FIRST}/${id}$`)
  );
  await expect(
    page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true })
  ).toHaveValue("A short summary.");
});

test("a post's row menu and its form's bar both open it in the builder", async ({
  page,
}) => {
  const title = `Open in builder ${RUN}`;
  const id = await createEntry(page.request, "posts", {
    title,
    slug: `open-in-builder-${RUN}`,
    status: "draft",
  });
  const builder = new RegExp(
    `/admin/collections/posts/${id}/builder\\?field=sections$`
  );

  await gotoAdmin(page, "/collections/posts");
  await rowOf(page, title).getByRole("button", { name: "Row actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Edit details" })
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: OPEN_IN_BUILDER }).click();
  await expect(page).toHaveURL(builder);

  await gotoAdmin(page, `/collections/posts/${id}`);
  const inBar = page.getByRole("link", { name: OPEN_IN_BUILDER });
  await expect(inBar).toHaveAttribute("href", builder);
  await inBar.click();
  await expect(page).toHaveURL(builder);
});
