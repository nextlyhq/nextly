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

test("seeds a default notification, edits it in the sheet, and guards referenced fields", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms/create");

  await page
    .getByRole("textbox", { name: "Form Name" })
    .fill("E2E Notifications Form");

  // One email field for reply-to / condition targets.
  await page.getByRole("button", { name: "Add field" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Email/ }).click();
  await dialog.getByRole("button", { name: "Add field" }).click();

  // A new form arrives pre-seeded with one admin-notification rule, honest
  // about why it will not send yet.
  await page.getByRole("tab", { name: /Notifications/ }).click();
  await expect(page.getByText("Admin notification")).toBeVisible();
  await expect(page.getByText("No template — will not send")).toBeVisible();

  // Edit in the sheet: recipient, visitor reply-to, and a send condition.
  await page
    .getByRole("button", { name: "Edit notification Admin notification" })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet
    .getByRole("textbox", { name: "Recipient address" })
    .fill("team@example.com");

  await sheet.getByLabel("Reply-To").click();
  await page.getByRole("option", { name: "The visitor (email field)" }).click();
  await sheet.getByLabel("Visitor email field").click();
  await page.getByRole("option", { name: "Email" }).click();

  await sheet.getByRole("button", { name: "Add condition" }).click();
  await sheet.getByLabel("Comparison").click();
  await page.getByRole("option", { name: "Is not empty" }).click();

  await sheet.getByRole("button", { name: "Save changes" }).click();

  // The card now shows the condition badge and the recipient summary.
  await expect(page.getByText("Conditional")).toBeVisible();
  await expect(page.getByText("To team@example.com")).toBeVisible();

  // The email field is referenced by the rule's reply-to and condition, so
  // its delete is blocked back on the Builder tab.
  await page.getByRole("tab", { name: "Builder" }).click();
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Round trip: the rule, its condition, and the guard all persist.
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/forms$/, { timeout: 30_000 });
  await page.getByRole("button", { name: /E2E Notifications Form/ }).click();
  await page.getByRole("tab", { name: /Notifications/ }).click();
  await expect(page.getByText("Admin notification")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Conditional")).toBeVisible();
});

test("the preview is an interactive simulation with real confirmation", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms");
  await page.getByRole("button", { name: /E2E Notifications Form/ }).click();
  await page.getByRole("tab", { name: "Preview" }).click();

  // Inputs are enabled — this is a simulation, not a screenshot.
  const emailInput = page.getByRole("textbox", { name: /^Email/ });
  await expect(emailInput).toBeEnabled();
  await emailInput.fill("visitor@example.com");

  // The simulated submit shows the form's real confirmation behavior.
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Thank you for your submission!")).toBeVisible();

  // Reset returns to a fresh form.
  await page.getByRole("button", { name: "Fill again" }).click();
  await expect(emailInput).toHaveValue("");
});
