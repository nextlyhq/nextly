/**
 * Deleting an email template a form rule uses: the delete dialog warns that
 * deleting the template will affect what sends it, and names the form and the
 * rule. Tested across phone, tablet and desktop widths.
 *
 * @module tests/email-template-delete-guard
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { expectOk } from "./support/runtime-collection";
import { fileAccount, test } from "./support/test";

test.describe.configure({ lock: [LOCK.email] });

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const RUN = Date.now().toString(36);
const TEMPLATE_NAME = `Order Alert ${RUN}`;
const TEMPLATE_SLUG = `order-alert-${RUN}`;
const FORM_NAME = `Order Form ${RUN}`;
const RULE_NAME = "Notify logistics";

let templateId: string | undefined;
let formId: string | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  // A session, like every admin API context: without it the setup posts
  // unauthenticated and the guard this spec covers never runs against real
  // data.
  const api: APIRequestContext = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });

  // 1. Create a site email template.
  const templateRes = await api.post("/admin/api/email-templates", {
    data: {
      name: TEMPLATE_NAME,
      slug: TEMPLATE_SLUG,
      subject: "Order update",
      htmlContent: "<p>Your order status has changed.</p>",
    },
  });
  await expectOk(templateRes, "create site email template");
  const templateBody = (await templateRes.json()) as { item: { id: string } };
  templateId = templateBody.item.id;

  // 2. Create a form with a notification rule using the template.
  const formRes = await api.post("/admin/api/collections/forms/entries", {
    data: {
      name: FORM_NAME,
      slug: `order-form-${RUN}`,
      status: "published",
      fields: [{ type: "text", name: "orderId", label: "Order ID" }],
      notifications: [
        {
          id: "rule-1",
          name: RULE_NAME,
          enabled: true,
          recipientType: "static",
          to: "logistics@example.com",
          templateSlug: TEMPLATE_SLUG,
        },
      ],
    },
  });
  await expectOk(formRes, "create form referencing template");
  const formBody = (await formRes.json()) as { item: { id: string } };
  formId = formBody.item.id;

  await api.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api: APIRequestContext = await playwright.request.newContext({
    baseURL,
  });
  if (formId) {
    await api.delete(`/admin/api/collections/forms/entries/${formId}`);
  }
  if (templateId) {
    await api.delete(`/admin/api/email-templates/${templateId}`);
  }
  await api.dispose();
});

for (const { name, width, height } of WIDTHS) {
  test(`delete guard warns of referencing form rule at ${name} (${width}px)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });

    await gotoAdmin(page, "/settings/email");
    await expect(
      page.getByRole("heading", { name: "Email", exact: true, level: 1 })
    ).toBeVisible({ timeout: 30_000 });

    const expectedReference = `Form: ${FORM_NAME}, ${RULE_NAME}`;

    if (width >= 768) {
      // Table view on desktop/tablet.
      const table = page.getByRole("table", { name: "Emails" });
      await expect(table).toBeVisible();

      const row = table.locator("tr").filter({ hasText: TEMPLATE_NAME });
      await expect(row).toBeVisible();
      await expect(row).toContainText(expectedReference);

      // Open Actions menu and click Delete.
      const actionButton = row.getByRole("button", {
        name: `Actions for ${TEMPLATE_NAME}`,
      });
      await actionButton.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
    } else {
      // Card view on phone.
      const card = page.getByRole("article").filter({ hasText: TEMPLATE_NAME });
      await expect(card).toBeVisible();
      await expect(card).toContainText(expectedReference);

      const actionButton = card.getByRole("button", {
        name: `Actions for ${TEMPLATE_NAME}`,
      });
      await actionButton.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
    }

    // Verify Delete Guard dialog.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Delete this email?" })
    ).toBeVisible();
    await expect(
      dialog.getByText("Deleting this template will affect what sends it:")
    ).toBeVisible();
    await expect(dialog.getByText(expectedReference)).toBeVisible();
    await expect(
      dialog.getByText(
        "These will stop sending emails once the template is deleted."
      )
    ).toBeVisible();

    // Attach screenshot for the PR.
    await testInfo.attach(`delete-guard-${width}`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    // Dismiss dialog cleanly.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
}
