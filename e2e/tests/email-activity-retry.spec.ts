/**
 * A queued email that failed because of its template, followed from the Activity tab to the
 * template's workbench and back to try it again: the detail sheet puts the template's failure
 * first and offers Fix template, which opens that template; once the template is fixed, Try again
 * now sends it, and the sheet then says it was sent and offers neither action. At phone, tablet
 * and desktop widths.
 *
 * The failure is real: a form notification queues the email with a template whose Reply-To renders
 * to the form's name, which is no address, so its first attempt fails before any provider is asked.
 * The fix is applied as the workbench's save applies it, through the template's own route: the
 * Reply-To field is a code editor, and typing into it is the workbench's own spec's business.
 *
 * @module tests/email-activity-retry
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { expectOk } from "./support/runtime-collection";
import { fileAccount, test } from "./support/test";

// The template list and the queued email are the site's, as another email spec's are.
test.describe.configure({ lock: [LOCK.email] });

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const RUN = Date.now().toString(36);
const API = "/admin/api";

/** What each width made, so it is taken down after every test, failed or not. */
const made: { templates: string[]; forms: string[] } = {
  templates: [],
  forms: [],
};

/** The one queued email sent from `slug`, as Activity reads it, once there is one. */
async function queuedFrom(
  api: APIRequestContext,
  slug: string
): Promise<{ id: string; status: string } | undefined> {
  const res = await api.get(
    `${API}/email-deliveries/activity?template=${encodeURIComponent(slug)}`
  );
  await expectOk(res, "read Activity for the template");
  const body = (await res.json()) as {
    items: { kind: string; id: string; status: string }[];
  };
  return body.items.find(item => item.kind === "queued");
}

/** Wait until the email sent from `slug` stands in `status`, and answer its id. */
async function settledAs(
  api: APIRequestContext,
  slug: string,
  status: string
): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const row = await queuedFrom(api, slug);
        id = row?.id;
        return row?.status;
      },
      { timeout: 30_000, message: `the queued email is ${status}` }
    )
    .toBe(status);
  return id!;
}

/**
 * A template whose Reply-To renders to the form's name, a form whose notification sends it, and
 * one submission: its email is queued and its first attempt fails on the Reply-To.
 */
async function seedFailedEmail(
  api: APIRequestContext,
  width: string
): Promise<{ templateId: string; templateName: string; slug: string }> {
  const slug = `retry-check-${RUN}-${width}`;
  const templateName = `Retry check ${RUN} ${width}`;
  const template = await api.post(`${API}/email-templates`, {
    data: {
      name: templateName,
      slug,
      subject: "Thanks for writing",
      htmlContent: "<p>Thanks, we got your message.</p>",
      replyTo: "{{ formName }}",
    },
  });
  await expectOk(template, "create a template with a broken Reply-To");
  const templateId = ((await template.json()) as { item: { id: string } }).item
    .id;
  made.templates.push(templateId);

  const formSlug = `retry-form-${RUN}-${width}`;
  const form = await api.post(`${API}/collections/forms/entries`, {
    data: {
      name: `Retry form ${RUN} ${width}`,
      slug: formSlug,
      status: "published",
      fields: [{ type: "text", name: "message", label: "Message" }],
      notifications: [
        {
          id: "notify-team",
          name: "Notify the team",
          enabled: true,
          recipientType: "static",
          to: "team@example.com",
          templateSlug: slug,
        },
      ],
    },
  });
  await expectOk(form, "create a form whose notification sends it");
  made.forms.push(((await form.json()) as { item: { id: string } }).item.id);

  const sent = await api.post(`${API}/forms/${formSlug}/submit`, {
    data: { data: { message: "Hello" } },
  });
  await expectOk(sent, "submit the form");
  return { templateId, templateName, slug };
}

/** Open the Activity tab and the detail sheet of the email sent from `templateName`. */
async function openSheet(page: Page, templateName: string) {
  await gotoAdmin(page, "/settings/email/activity");
  await page
    .getByRole("button", { name: templateName, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

test.afterAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  // Each cleanup asserted: a refused teardown would leave a broken template behind for every later
  // email spec to find.
  for (const id of made.forms) {
    await expectOk(
      await api.delete(`${API}/collections/forms/entries/${id}`),
      "delete the form"
    );
  }
  for (const id of made.templates) {
    await expectOk(
      await api.delete(`${API}/email-templates/${id}`),
      "delete the template"
    );
  }
  await api.dispose();
});

for (const { name, width, height } of WIDTHS) {
  test(`a template's failure goes to the workbench and back to retry, at ${name} (${width}px)`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    const api = page.request;
    const { templateId, templateName, slug } = await seedFailedEmail(api, name);
    const queuedId = await settledAs(api, slug, "failed");

    // The sheet puts the template's failure first and offers its fix.
    let sheet = await openSheet(page, templateName);
    await expect(sheet.getByRole("status").first()).toContainText(
      "Failed: the template couldn’t be used"
    );
    await expect(
      sheet.getByRole("button", { name: "Try again now" })
    ).toBeVisible();
    await sheet.getByRole("link", { name: "Fix template" }).click();

    // To the workbench, on that template, where its Reply-To is.
    await expect(page).toHaveURL(
      new RegExp(`/settings/email/messages/edit/${templateId}$`)
    );
    await expect(page.getByRole("textbox", { name: "Email name" })).toHaveValue(
      templateName,
      { timeout: 30_000 }
    );
    await expect(page.getByText("Reply-To").first()).toBeVisible();
    await expectOk(
      await api.patch(`${API}/email-templates/${templateId}`, {
        data: { replyTo: "help@example.com" },
      }),
      "fix the template's Reply-To"
    );

    // Back to Activity, and try it again.
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/email\/activity/);
    sheet = await openSheet(page, templateName);
    await sheet.getByRole("button", { name: "Try again now" }).click();
    await expect(
      page.getByText("Email will be tried again now.").first()
    ).toBeVisible();

    // The attempt runs on the next jobs pass: one a manager may start, from the admin's origin.
    const pass = await api.post(`${API}/jobs/run`, {
      headers: { Origin: baseURL ?? "" },
    });
    await expectOk(pass, "run a jobs pass");
    await settledAs(api, slug, "sent");

    // Read afresh: it was sent, and nothing is left to try again or cancel.
    sheet = await openSheet(page, templateName);
    await expect(sheet.getByRole("status").first()).toContainText("Sent");
    await expect(
      sheet.getByRole("button", { name: "Try again now" })
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: "Cancel email" })
    ).toHaveCount(0);
    // The same email throughout, not a second one queued by the fix.
    expect(await settledAs(api, slug, "sent")).toBe(queuedId);
  });
}
