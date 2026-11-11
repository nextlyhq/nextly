/**
 * The form builder against a real server: fields are added through the shared
 * field picker and edited in the shared settings panel, reordered without a
 * pointer, refused deletion while something else refers to them, and saved
 * with the form's own save. These flows cross the plugin, the SDK's field UI
 * and the shared catalog: the seams unit tests mock away.
 */
import { expect, type Page } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { gotoAdmin } from "./support/admin";

/** Adds a field through the picker: its type, found by search, and a label. */
async function addField(page: Page, search: string, label: string) {
  await page.getByRole("button", { name: "Add field" }).first().click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("combobox", { name: "Search field types" })
    .fill(search);
  await picker
    .getByRole("combobox", { name: "Search field types" })
    .press("Enter");
  await picker.getByRole("textbox", { name: "Label" }).fill(label);
  await picker.getByRole("button", { name: "Add field" }).click();
  await expect(picker).toHaveCount(0);
}

/** Opens a page of the form editor through its tab, a link in the header. */
async function openPage(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Form pages" })
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();
}

/** The form editor's Save, in the admin's top bar. */
const saveButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Save", exact: true });

/** A new form with the name given, on the create page. */
async function newForm(page: Page, name: string) {
  await gotoAdmin(page, "/collections/forms/create");
  // The name is typed on Settings; the header shows it once given.
  await openPage(page, "Settings");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await openPage(page, "Builder");
}

/** Creates the form, then opens it again from its own address. */
async function createAndReopen(page: Page, name: string) {
  await saveButton(page).click();
  // A new form carries on at its own edit address. Dev cold-compiles routes,
  // so the save and the next page get a generous window.
  await expect(page).toHaveURL(/\/collections\/forms\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
    timeout: 30_000,
  });
}

const cards = (page: Page) => page.locator('ul[aria-label="Form fields"] li');

test("adds, edits and reorders a field", async ({ page }) => {
  await newForm(page, "E2E Form");
  await addField(page, "email", "Email");
  await addField(page, "text", "Company");

  // Names come from the labels.
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("email");
  await expect(cards(page).nth(1)).toContainText("company");

  // The newest field's settings are open in the panel docked beside the list.
  const panel = page.getByRole("complementary", { name: "Field settings" });
  await expect(panel.getByRole("textbox", { name: "Name" })).toHaveValue(
    "company"
  );
  await panel
    .getByRole("textbox", { name: "Description" })
    .fill("Where you work");

  // Close the settings so the two cards have comparable heights (dnd-kit's
  // keyboard sorting picks targets by coordinates), then reorder with the
  // keyboard alone: lift the Company card, move it up, drop. The pauses give
  // dnd-kit a frame to process each keyboard event.
  await panel.getByRole("button", { name: "Close field settings" }).click();
  const handle = page.getByRole("button", { name: /Reorder Company/ });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect(cards(page).nth(0)).toContainText("company");

  // The order and the edit were saved with the form, not only shown.
  await createAndReopen(page, "E2E Form");
  await expect(cards(page).nth(0)).toContainText("company", {
    timeout: 30_000,
  });
  await page
    .getByRole("button", { name: /^Company/ })
    .first()
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Field settings" })
      .getByRole("textbox", { name: "Description" })
  ).toHaveValue("Where you work");
});

test("saves and reloads, with no database review", async ({ page }) => {
  await newForm(page, "E2E Saved Form");
  await addField(page, "email", "Email");
  await createAndReopen(page, "E2E Saved Form");

  // A field added to a saved form is stored with the form itself: the save
  // asks nothing about the database, and the page holds the change after a
  // reload.
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  await addField(page, "number", "Guests");
  await saveButton(page).click();
  await expect(page.getByText("Form saved")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await expect(cards(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(cards(page).nth(1)).toContainText("guests");
});

test("refuses to delete a field another refers to", async ({ page }) => {
  await newForm(page, "E2E Guarded Form");
  await addField(page, "email", "Email");
  await addField(page, "text", "Company");

  // Company shows only once Email is answered: a condition in the form's own
  // editor, which defaults to the first other field.
  const panel = page.getByRole("complementary", { name: "Field settings" });
  await panel.getByRole("tab", { name: "Conditions" }).click();
  await panel
    .getByRole("checkbox", { name: /Enable conditional logic/ })
    .click();
  await panel.getByRole("button", { name: /Add Condition/i }).click();

  // Email is now referred to, so its Delete is refused; Company's is not.
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Actions for Company" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  await page.keyboard.press("Escape");

  // The condition was saved with the form, so the refusal survives a reload.
  await createAndReopen(page, "E2E Guarded Form");
  await expect(cards(page)).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
});

test("seeds a default notification, edits it in place, and guards referenced fields", async ({
  page,
}) => {
  await newForm(page, "E2E Notifications Form");

  // One email field for reply-to / condition targets.
  await addField(page, "email", "Email");

  // A new form arrives pre-seeded with one admin-notification rule, ready to
  // send with the starter message rather than waiting for one.
  await openPage(page, "Notifications");
  await expect(page.getByText("Admin notification")).toBeVisible();
  await expect(
    includingHidden(page).getByText("No template — will not send")
  ).toHaveCount(0);

  // Edit in place: the row expands into an editor on the page, not a panel
  // over it. Scoped to that region rather than to the page so a control with
  // the same name elsewhere cannot satisfy these steps.
  const toggle = page.getByRole("button", {
    name: "Edit notification Admin notification",
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // There is no overlay. A `getByRole("dialog")` here would have found the
  // sheet this replaced, which is how this test failed when it moved.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // `:visible`: a hidden copy of this page, which Next.js may keep mounted,
  // holds the same id.
  const editor = page.locator('[id^="notification-editor-"]:visible');
  await editor
    .getByRole("textbox", { name: "Recipient address" })
    .fill("team@example.com");

  await editor.getByLabel("Reply-To").click();
  await page.getByRole("option", { name: "The visitor (email field)" }).click();
  await editor.getByLabel("Visitor email field").click();
  await page.getByRole("option", { name: "Email" }).click();

  await editor.getByRole("button", { name: "Add condition" }).click();
  await editor.getByLabel("Comparison").click();
  await page.getByRole("option", { name: "Is not empty" }).click();

  // No save press: the editor writes through to the form as it is typed, and
  // the page's own action bar is the only commit. The summary above proves it
  // — it is driven by the same state the editor is writing.
  await expect(page.getByText("Conditional")).toBeVisible();
  await expect(page.getByText("To team@example.com")).toBeVisible();

  // The email field is referenced by the rule's reply-to and condition, so
  // its delete is blocked back on the Builder tab.
  await openPage(page, "Builder");
  await page.getByRole("button", { name: "Actions for Email" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Round trip: the rule, its condition, and the guard all persist.
  await createAndReopen(page, "E2E Notifications Form");
  await openPage(page, "Notifications");
  await expect(page.getByText("Admin notification")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Conditional")).toBeVisible();
});

test("the preview is an interactive simulation with real confirmation", async ({
  page,
}) => {
  // Self-sufficient: the preview needs no saved form — the builder state
  // previews live, so an unsaved form with one field is enough.
  await newForm(page, "E2E Preview Form");
  await addField(page, "email", "Email");
  await openPage(page, "Preview");

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

  // The device toggle must genuinely resize the simulated pane. The pane
  // widths come from utility classes in the compiled admin stylesheet, so a
  // class the stylesheet fails to emit leaves both modes rendering at the
  // same width — measure the pane (via its full-width input) instead of
  // trusting the toggle state.
  const desktopWidth = (await emailInput.boundingBox())?.width ?? 0;
  expect(desktopWidth).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Mobile" }).click();
  // boundingBox() returns null while the pane is detached mid-transition; a
  // null-to-zero fallback would let that transient state pass the narrower
  // check, so only a real, positive measurement may satisfy the poll.
  await expect
    .poll(
      async () => {
        const box = await emailInput.boundingBox();
        return box !== null && box.width > 0 && box.width < desktopWidth;
      },
      { message: "mobile preview should be narrower than desktop" }
    )
    .toBe(true);
});
