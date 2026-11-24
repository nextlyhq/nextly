/**
 * The editor's document bar, as a spec reaches what it offers.
 *
 * The bar draws one main button (Publish, Submit for review, Approve…), and
 * its arrow holds the rest: Save draft, the other ways to publish, the
 * preview's choices and the ways into the document's other views (Open in
 * builder). These helpers open that menu and choose a row of it, so a spec
 * names the act rather than where the header happens to draw it.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** What the main button's arrow is called. */
export const MAIN_MENU = "More ways to publish";

/** The document bar of the editor on screen. */
export function documentBar(page: Page): Locator {
  return page.getByTestId("document-bar");
}

/** Opens the main button's menu and returns it. */
export async function openMainMenu(page: Page): Promise<Locator> {
  await documentBar(page).getByRole("button", { name: MAIN_MENU }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** A row of the main button's menu, by its name, the menu opened. */
export async function mainMenuRow(
  page: Page,
  name: string | RegExp
): Promise<Locator> {
  const menu = await openMainMenu(page);
  return menu.getByRole("menuitem", {
    name,
    ...(typeof name === "string" ? { exact: true } : {}),
  });
}

/** Chooses a row of the main button's menu, by its name. */
export async function chooseFromMainMenu(
  page: Page,
  name: string | RegExp
): Promise<void> {
  await (await mainMenuRow(page, name)).click();
}

/** Every word the document's Save is said with. */
export const SAVE_NAME = /^(Save draft|Save changes|Save)$/;

/**
 * Saves the document as an author does: the main button where Save leads (a
 * live page, or a collection with no drafts), otherwise the Save row of its
 * menu (a draft, where Publish leads). Call it once the bar is drawn.
 */
export async function saveFromBar(
  page: Page,
  name: RegExp = SAVE_NAME
): Promise<void> {
  const button = documentBar(page).getByRole("button", { name });
  if ((await button.count()) > 0) {
    await button.first().click();
    return;
  }
  await chooseFromMainMenu(page, name);
}
