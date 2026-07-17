/**
 * The form builder's field editor against a real server: add fields from the
 * shared catalog picker, edit inline on the card, reorder without a pointer,
 * and refuse to delete a field something else references. These flows cross
 * the plugin, the SDK's field-UI kit, and the shared catalog — the seams unit
 * tests mock away.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test("builds a form with catalog fields, keyboard reorder, and a guarded delete", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms/create");

  await page.getByRole("textbox", { name: "Form Name" }).fill("E2E Form");

  // Add email + text through the Add-field dialog (the kit's catalog picker).
  for (const type of [/^Email/, /^Text Single-line/]) {
    await page.getByRole("button", { name: "Add field" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: type }).click();
    await dialog.getByRole("button", { name: "Add field" }).click();
  }

  // Names come from the catalog type, readable and sequential.
  const cards = page.locator('ul[aria-label="Form fields"] li');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("email");
  await expect(cards.nth(1)).toContainText("text");

  // The newest card is expanded inline: give the text field conditional
  // logic that references the email field (the condition row defaults to
  // the first other field, which is email).
  await page.getByRole("tab", { name: "Conditional" }).click();
  await page.getByRole("checkbox", { name: /Enable conditional/i }).click();
  await page.getByRole("button", { name: /Add Condition/i }).click();

  // The email field is now referenced, so its Delete is blocked; the text
  // field's Delete stays available.
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Actions for Text" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  await page.keyboard.press("Escape");

  // Collapse the expanded card first so the two cards have comparable
  // heights (dnd-kit's keyboard sorting picks targets by coordinates), then
  // reorder with the keyboard alone: lift the text card, move it up, drop.
  // The pauses give dnd-kit a frame to process each keyboard event.
  await page.getByRole("button", { name: /^Text/ }).first().click();
  const handle = page.getByRole("button", { name: /Reorder Text/ });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect(cards.nth(0)).toContainText("text");

  // Persist and verify the round trip. Dev cold-compiles routes, so the
  // save + list render gets a generous window.
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/forms$/, { timeout: 30_000 });

  // Entry rows render as buttons (the whole row navigates).
  await page.getByRole("button", { name: /E2E Form/ }).click();
  await expect(
    page.locator('ul[aria-label="Form fields"] li').nth(0)
  ).toContainText("text", { timeout: 30_000 });

  // The reference guard survives the round trip: conditional logic was
  // persisted with the form, not just held in editor state.
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
});
