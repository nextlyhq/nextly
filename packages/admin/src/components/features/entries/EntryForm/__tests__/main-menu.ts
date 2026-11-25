/**
 * The entry header's main button's menu, as a test reaches it: the arrow
 * beside the main button opens it, and its rows hold saving, the other ways
 * to publish, the preview's choices and the ways into the document's views.
 *
 * @module components/features/entries/EntryForm/__tests__/main-menu
 */
import userEvent from "@testing-library/user-event";

import { screen, within } from "@admin/__tests__/utils";

/**
 * What the main button's arrow is called: the ways to publish where Publish
 * or a workflow step leads, the document's actions where Save does.
 */
export const MAIN_MENU = /^More (ways to publish|document actions)$/;

/** Opens the main button's menu and returns it. */
export async function openMainMenu(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: MAIN_MENU }));
  return screen.findByRole("menu");
}

/** The rows of the main button's menu, by their words, the menu opened. */
export async function mainMenuRows(): Promise<string[]> {
  const menu = await openMainMenu();
  return within(menu)
    .getAllByRole("menuitem")
    .map(row => row.textContent?.trim() ?? "");
}

/** One row of the main button's menu, by its name, the menu opened. */
export async function mainMenuRow(name: string | RegExp): Promise<HTMLElement> {
  const menu = await openMainMenu();
  return within(menu).getByRole("menuitem", { name });
}
