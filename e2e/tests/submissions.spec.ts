/**
 * The submissions view against a real server: per-field columns when one
 * form is selected, the drawer detail with editing (stamped server-side),
 * the Spam tab with recovery, and the CSV export route. These flows cross
 * the plugin's List-view override, the admin's DataTable, and the plugin's
 * export/permission routes — the seams unit tests mock away.
 */
import { expect } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { gotoAdmin } from "./support/admin";

test.describe.configure({ mode: "serial" });

// Named per run of this file, as is everything it seeds. A form's slug comes
// from its name and is unique, so a second run on the same database (a retry
// of the serial group, or `--repeat-each`) would otherwise be refused at the
// first test. And the view lists every form's submissions until a form is
// picked, so a row an earlier run left with the same text could be the one a
// locator finds while the filtered list is still loading.
let formName = "";
let formId = "";
let ada = "";
let bot = "";
let greeting = "";

test("creates a published form and seeds submissions through the API", async ({
  page,
}) => {
  const run = Date.now().toString(36);
  formName = `E2E Submissions Form ${run}`;
  ada = `ada-${run}@example.com`;
  bot = `bot-${run}@example.com`;
  greeting = `hello there ${run}`;
  // The form is made through the entries API: what this file tests is its
  // submissions, and the form editor has browser specs of its own.
  await gotoAdmin(page, "/collections/forms");
  const created = await page.request.post(
    "/admin/api/collections/forms/entries",
    {
      data: {
        name: formName,
        slug: `e2e-submissions-${run}`,
        status: "published",
        fields: [
          { type: "email", name: "email", label: "Email" },
          { type: "text", name: "text", label: "Text" },
        ],
      },
    }
  );
  expect(created.ok()).toBe(true);

  // Seed one clean and one spam submission via the entries API. A create made
  // over HTTP starts as `new` whatever status it names, and only the server's
  // spam verdict files it as `spam`, so the spam row is sent the way a bot
  // sends one: with the honeypot field (`website`, which this form does not
  // declare) filled in. Each stored status is checked here, so a seed that no
  // longer lands where the later tests look fails at the seed.
  formId = await page.evaluate(
    async seed => {
      // Asked for by name rather than looked for on the first page of every
      // form: other specs create forms on the same database, and a list read
      // returns one page of them.
      const query = new URLSearchParams({
        where: JSON.stringify({ name: { equals: seed.name } }),
      });
      const forms = (await (
        await fetch(`/admin/api/collections/forms/entries?${query}`, {
          credentials: "include",
        })
      ).json()) as { items: Array<{ id: string; name: string }> };
      const form = forms.items.find(item => item.name === seed.name);
      if (!form) throw new Error("form not found");
      for (const { data, expected } of [
        {
          data: { email: seed.ada, text: seed.greeting },
          expected: { status: "new", spamReason: null },
        },
        {
          data: {
            email: seed.bot,
            text: "buy things",
            website: "http://spam.example",
          },
          expected: { status: "spam", spamReason: "honeypot" },
        },
      ]) {
        const res = await fetch(
          "/admin/api/collections/form-submissions/entries",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              form: form.id,
              submittedAt: new Date().toISOString(),
              data,
            }),
          }
        );
        if (!res.ok) throw new Error(`seed failed: ${res.status}`);
        const { item } = (await res.json()) as {
          item: { status?: string; spamReason?: string | null };
        };
        const stored = {
          status: item.status,
          spamReason: item.spamReason ?? null,
        };
        if (JSON.stringify(stored) !== JSON.stringify(expected)) {
          throw new Error(
            `seeded ${data.email} as ${JSON.stringify(stored)}, ` +
              `expected ${JSON.stringify(expected)}`
          );
        }
      }
      return form.id;
    },
    { name: formName, ada, bot, greeting }
  );
  expect(formId).not.toBe("");
});

test("shows per-field columns, edits in the drawer, and stamps the edit", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/form-submissions");

  // No "New Submission" button: submissions are machine-created.
  await expect(
    page.getByRole("button", { name: /New Submission/ })
  ).toHaveCount(0);

  // Select the form: columns become its field labels.
  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: formName }).click();
  await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Text" })).toBeVisible();
  // The table renders desktop rows and responsive cards in the same DOM;
  // filter to the visible variant for the current viewport.
  await expect(
    page.getByText(ada).filter({ visible: true }).first()
  ).toBeVisible();

  // The spam row stays out of the default view.
  await expect(includingHidden(page).getByText(bot)).toHaveCount(0);

  // A row opens the submission's own page, at its own address, carrying the
  // list's filter.
  await page.getByText(ada).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(
    /\/admin\/collections\/form-submissions\/[^/?]+\?status=all&form=/
  );
  const answers = page.getByRole("region", { name: "Answers" });
  await expect(answers.getByText(greeting)).toBeVisible();
  // Opening a New one marks it Read, for a person who may update it.
  await expect(
    page
      .getByRole("complementary", { name: "Submission details" })
      .getByRole("button", { name: "Read", pressed: true })
  ).toBeVisible({ timeout: 15_000 });

  // Edit, save: the server stamps the edit, and Activity says so.
  await answers.getByRole("button", { name: "Edit answers" }).click();
  await answers
    .getByRole("textbox", { name: "Text" })
    .fill(`${greeting} (corrected)`);
  await answers.getByRole("button", { name: "Save answers" }).click();
  await expect(answers.getByText(`${greeting} (corrected)`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page
      .getByRole("region", { name: "Activity" })
      .getByText("Answers edited in the admin")
  ).toBeVisible();

  // Opened directly, by its address alone, it reads the same.
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Answers" })
      .getByText(`${greeting} (corrected)`)
  ).toBeVisible({ timeout: 30_000 });
});

test("reviews spam in its tab and recovers it", async ({ page }) => {
  await gotoAdmin(page, "/collections/form-submissions");
  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: formName }).click();

  await page.getByRole("tab", { name: "Spam" }).click();
  await expect(
    page.getByText(bot).filter({ visible: true }).first()
  ).toBeVisible();

  // Recover from its page: Not spam brings it back as New.
  await page.getByText(bot).filter({ visible: true }).first().click();
  await expect(
    page.getByRole("region", { name: "Activity" }).getByText(/Flagged as spam/)
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Not spam" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Submission details" })
      .getByRole("button", { name: "New", pressed: true })
  ).toBeVisible({ timeout: 15_000 });
  await page.goBack();

  // A tab's name carries its count once read ("New 3").
  await page.getByRole("tab", { name: /^New\b/ }).click();
  await expect(
    page.getByText(bot).filter({ visible: true }).first()
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("exports CSV with columns from the form's fields", async ({ page }) => {
  await gotoAdmin(page, "/collections/form-submissions");

  const res = await page.request.get(
    `/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export?format=csv&form=${formId}`
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv).toContain("Email");
  expect(csv).toContain(ada);

  // CSV without a form fails fast with a clear reason.
  const bad = await page.request.get(
    "/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export?format=csv"
  );
  expect(bad.status()).toBe(400);
});
