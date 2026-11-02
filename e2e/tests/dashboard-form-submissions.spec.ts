/**
 * New form submissions in a browser: the form-builder plugin's card, placed by
 * the test through the layout, lists a new submission with who sent it and its
 * form, the row opens the submission, and the header's summary counts it.
 *
 * The suite's user is the first account, a super-admin, who reads every form.
 * The form is published through the entries API with a stamp of its own, so
 * the run's other submissions only add rows beside it.
 *
 * @module tests/dashboard-form-submissions.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const CARD = "form-builder/new-submissions";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Puts the card on the reader's dashboard at its starting size. */
async function place(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-new-submissions",
            widgetId: CARD,
            ...(await defaultSizeOf(page, CARD)),
            removed: false,
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

/** A published form asking for a name and a message, and one new submission to it. */
async function seed(page: Page, stamp: string) {
  const form = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/forms/entries`, {
      data: {
        name: `Contact ${stamp}`,
        slug: `contact-${stamp}`,
        status: "published",
        fields: [
          { type: "text", name: "name", label: "Name", required: true },
          { type: "textarea", name: "message", label: "Message" },
        ],
      },
    })
  );
  const submission = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/form-submissions/entries`, {
      data: {
        form: form.item.id,
        data: { name: `Ana ${stamp}`, message: "Price list, please" },
        status: "new",
        submittedAt: new Date().toISOString(),
      },
    })
  );
  return { formId: form.item.id, submissionId: submission.item.id };
}

for (const theme of ["light", "dark"] as const) {
  test(`lists a new submission whose row opens it, and counts it in the header (${theme})`, async ({
    page,
  }) => {
    const stamp = Date.now().toString(36);
    await gotoAdmin(page, "/", theme);
    const { submissionId } = await seed(page, stamp);
    await place(page);
    await gotoAdmin(page, "/", theme);

    const card = page.getByTestId(`widget-cell-${CARD}`);
    await expect(
      card
        .getByRole("heading", { name: "New form submissions" })
        .filter({ visible: true })
    ).toBeVisible();
    const row = card
      .getByRole("link", { name: new RegExp(`Ana ${stamp}`) })
      .filter({ visible: true });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Contact ${stamp} · Price list, please`);

    await expect(
      page
        .getByTestId("dashboard-header")
        .filter({ visible: true })
        .getByText(/\d+ new submissions/)
        .filter({ visible: true })
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expectNoAxeViolations(page);

    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/form-submissions/${submissionId}$`)
    );
  });
}
