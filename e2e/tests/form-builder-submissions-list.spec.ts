/**
 * The submissions lists against a real server: a form's Submissions tab with
 * the form's labels as its columns and its options' labels as values, its
 * date filter, and ticked rows acted on alone (exported, archived, deleted);
 * and the list of every form, with who sent each, its form and a summary.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

test.describe.configure({ mode: "serial" });

// Named per run, as everything this file seeds, so a second run on the same
// database finds its own rows.
let formId = "";
let formName = "";
let names: string[] = [];

/** A day as a date field takes it, `days` from today in the browser's zone. */
function dayFromToday(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The list's table, the desktop view of its rows. */
const table = (page: Page) => page.getByRole("table", { name: "Submissions" });

/**
 * One row of the table, by text in it. By element rather than role: a row
 * that opens its submission is named a button, not a row.
 */
const row = (page: Page, text: string) =>
  table(page).locator("tbody tr").filter({ hasText: text });

test("seeds a job application with three submissions", async ({ page }) => {
  const stamp = Date.now().toString(36);
  formName = `Job application ${stamp}`;
  names = ["Ana", "Bilal", "Chen"].map(name => `${name} ${stamp}`);
  await gotoAdmin(page, "/collections/form-submissions");
  const form = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/forms/entries`, {
      data: {
        name: formName,
        slug: `jobs-${stamp}`,
        status: "published",
        fields: [
          { type: "text", name: "full_name", label: "Full name" },
          { type: "email", name: "email", label: "Email" },
          {
            type: "select",
            name: "role",
            label: "Role",
            options: [
              { value: "backend-engineer", label: "Backend engineer" },
              { value: "designer", label: "Product designer" },
            ],
          },
          { type: "number", name: "years", label: "Years" },
        ],
      },
    })
  );
  formId = form.item.id;
  for (const [index, name] of names.entries()) {
    await ok(
      await page.request.post(`${API}/collections/form-submissions/entries`, {
        data: {
          form: formId,
          data: {
            full_name: name,
            email: `${name.split(" ")[0]!.toLowerCase()}-${stamp}@example.com`,
            role: index === 1 ? "designer" : "backend-engineer",
            years: index + 2,
          },
        },
      })
    );
  }
});

test("a form's tab: labels, a date filter, and ticked rows exported alone", async ({
  page,
}) => {
  const [ana, bilal, chen] = names as [string, string, string];
  await gotoAdmin(page, `/collections/forms/${formId}/submissions`);

  // The form's labels as columns, and its options' labels as values.
  for (const header of ["Full name", "Email", "Role", "Years"]) {
    await expect(
      table(page).getByRole("columnheader", { name: header })
    ).toBeVisible({ timeout: 30_000 });
  }
  await expect(row(page, ana).getByText("Backend engineer")).toBeVisible();
  await expect(row(page, bilal).getByText("Product designer")).toBeVisible();
  await expect(table(page).getByText("backend-engineer")).toHaveCount(0);
  // No way to add a submission.
  await expect(
    page.getByRole("button", { name: /new submission|add submission/i })
  ).toHaveCount(0);

  // Days that end yesterday hold none of today's submissions.
  await page.getByRole("button", { name: /^Date sent:/ }).click();
  await page.getByLabel("To", { exact: true }).fill(dayFromToday(-1));
  await page.getByRole("button", { name: "Show these days" }).click();
  await expect(
    page
      .getByText("No submissions were sent in these dates.")
      .filter({ visible: true })
  ).toBeVisible({ timeout: 15_000 });

  // The last 7 days hold all three.
  await page.getByRole("button", { name: /^Date sent:/ }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(row(page, chen)).toBeVisible({ timeout: 15_000 });

  // Tick two: one by pointer, one from the keyboard, which ticks the row
  // without opening it.
  await row(page, ana).getByRole("checkbox").click();
  const chenBox = row(page, chen).getByRole("checkbox");
  await chenBox.focus();
  await page.keyboard.press("Space");
  await expect(chenBox).toBeChecked();
  await expect(page).toHaveURL(/\/submissions$/);

  const bar = page.getByRole("region", { name: "Selected submissions" });
  await expect(bar).toContainText("2 selected");

  // Export there holds exactly the two ticked.
  await bar.getByRole("button", { name: "Export" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const csv = await (await downloading).createReadStream().then(
    stream =>
      new Promise<string>((resolve, reject) => {
        let text = "";
        stream.on("data", chunk => (text += String(chunk)));
        stream.on("end", () => resolve(text));
        stream.on("error", reject);
      })
  );
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  expect(lines[0]).toMatch(/^Full name,Email,Role,Years,/);
  expect(lines).toHaveLength(3);
  expect(csv).toContain(ana);
  expect(csv).toContain(chen);
  expect(csv).not.toContain(bilal);
  expect(csv).toContain("Backend engineer");

  // Archive the two: the list says so, and shows them archived.
  await bar.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived 2 submissions.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(row(page, ana).getByText("Archived")).toBeVisible();
  await expect(row(page, chen).getByText("Archived")).toBeVisible();
  await expect(row(page, bilal).getByText("New")).toBeVisible();

  // Delete asks first, then deletes the ticked row alone.
  await row(page, bilal).getByRole("checkbox").click();
  await bar.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete 1 submission?");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted 1 submission.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(row(page, bilal)).toHaveCount(0);
  await expect(row(page, ana)).toBeVisible();
});

test("every form's list: who, which form, a summary, and the form's own columns once picked", async ({
  page,
}) => {
  const [ana] = names as [string];
  // Wide enough for every column: a list too narrow for them gives up its
  // Summary first, then names the form under the sender.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoAdmin(page, "/collections/form-submissions");
  for (const header of ["From", "Form", "Summary", "Status", "Submitted"]) {
    await expect(
      table(page).getByRole("columnheader", { name: header })
    ).toBeVisible({ timeout: 30_000 });
  }
  await expect(row(page, ana).getByText(formName)).toBeVisible();
  await expect(row(page, ana).getByText(/Backend engineer/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /new submission|add submission/i })
  ).toHaveCount(0);

  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: formName }).click();
  await expect(
    table(page).getByRole("columnheader", { name: "Role" })
  ).toBeVisible();
  await expect(row(page, ana).getByText("Backend engineer")).toBeVisible();
});
