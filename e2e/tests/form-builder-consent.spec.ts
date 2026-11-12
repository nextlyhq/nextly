/**
 * A consent field against a real server: added through the picker, it stays
 * required and carries the text the visitor agrees to; a visitor's submission
 * stores that text, the submission shows it, and Edit does not offer it.
 * These cross the shared catalog, the builder's panel, the public submit
 * route and the submissions drawer: the seams unit tests mock away.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";
const AGREEMENT = "I agree to the privacy policy";

/** Opens a page of the form editor through its tab, a link in the header. */
async function openPage(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Form pages" })
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();
}

test("adds a consent that stays required and carries its text", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms/create");
  await openPage(page, "Settings");
  await page.getByRole("textbox", { name: "Name" }).fill("E2E Consent Form");
  await openPage(page, "Builder");

  await page.getByRole("button", { name: "Add field" }).first().click();
  const picker = page.getByRole("dialog");
  const search = picker.getByRole("combobox", { name: "Search field types" });
  await search.fill("gdpr");
  await search.press("Enter");
  await picker.getByRole("textbox", { name: "Label" }).fill("Privacy");
  await picker.getByRole("button", { name: "Add field" }).click();
  await expect(picker).toHaveCount(0);

  const panel = page.getByRole("complementary", { name: "Field settings" });
  const text = panel.getByRole("textbox", { name: "Agreement text" });
  await expect(text).toHaveValue(AGREEMENT);
  await text.fill("I agree to be contacted");

  // Turning Required off is refused, and the refusal says why.
  const required = panel.getByRole("switch", { name: "Required" });
  await expect(required).toBeChecked();
  await required.click();
  await expect(required).toBeChecked();
  await expect(page.getByText(/A consent is always required/)).toBeVisible();

  // The preview shows the box labelled by what the visitor agrees to.
  await openPage(page, "Preview");
  await expect(
    page.getByRole("checkbox", { name: /I agree to be contacted/ })
  ).toBeVisible();
});

test("stores the text agreed to, shows it, and never offers it for editing", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await gotoAdmin(page, "/collections/form-submissions");
  const formName = `Consent ${stamp}`;
  await ok(
    await page.request.post(`${API}/collections/forms/entries`, {
      data: {
        name: formName,
        slug: `consent-${stamp}`,
        status: "published",
        fields: [
          { type: "text", name: "name", label: "Name", required: true },
          {
            type: "consent",
            name: "privacy",
            label: "Privacy",
            required: true,
            agreementText: AGREEMENT,
          },
        ],
      },
    })
  );
  // As a plain HTML form sends it: the box's own value, stored with the text
  // the form shows.
  const sent = await page.request.post(`${API}/forms/consent-${stamp}/submit`, {
    data: { data: { name: `Ada ${stamp}`, privacy: "on" } },
  });
  expect(sent.ok(), await sent.text()).toBe(true);

  await gotoAdmin(page, "/collections/form-submissions");
  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: formName }).click();
  await page
    .getByText(`Ada ${stamp}`)
    .filter({ visible: true })
    .first()
    .click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(`“${AGREEMENT}”`)).toBeVisible();
  await expect(sheet.getByText("Agreed", { exact: true })).toBeVisible();

  await sheet.getByRole("button", { name: "Edit" }).click();
  await expect(sheet.getByRole("textbox", { name: "Name" })).toBeVisible();
  await expect(sheet.getByText("A consent cannot be edited")).toBeVisible();
  // Nothing in the drawer would change it.
  await expect(sheet.getByRole("checkbox")).toHaveCount(0);
  await expect(sheet.getByRole("switch")).toHaveCount(0);
});
