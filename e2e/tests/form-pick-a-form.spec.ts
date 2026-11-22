/**
 * Picking a Forms form in the Form block, with the forms plugin the
 * playground registers.
 *
 * - The block's first setting is "Form: <pick a form>", listing the site's
 *   forms with drafts and closed ones marked, and saying where a picked
 *   form's parts come from, with "Edit this form ↗" and "or use a simple
 *   form".
 * - A picked form is drawn on the canvas as a visitor will see it, a draft
 *   with "Draft form: visitors can't send it until it's published".
 * - A picked form that was deleted says so on the canvas, with "Pick
 *   another form", and the live page shows nothing in its place.
 * - A simple form with no "Send to" says its answers have nowhere to go,
 *   and the page's checks list it.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module form-pick-a-form.spec
 */
import { expect, type Page } from "@playwright/test";

import { clickBlock, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";
import { includingHidden } from "./support/visible";

const API = "/admin/api";
const ENTRIES = `${API}/collections/pages/entries`;

/** A short value unique to one run. */
function stamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A Forms form in `status`: its id and its name. */
async function seedForm(
  page: Page,
  run: string,
  name: string,
  status: "published" | "draft" | "closed"
): Promise<{ id: string; name: string }> {
  const full = `${name} ${run}`;
  const created = await page.request.post(`${API}/collections/forms/entries`, {
    data: {
      name: full,
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${run}`,
      status,
      fields: [
        { type: "text", name: "name", label: `Your name ${run}` },
        { type: "email", name: "email", label: "Email", required: true },
      ],
      settings: { confirmationType: "message", successMessage: "Thanks." },
    },
  });
  expect(created.ok(), `seeding ${name}: ${created.status()}`).toBe(true);
  const id = String(
    ((await created.json()) as { item: { id: string } }).item.id
  );
  return { id, name: full };
}

/** A page holding one Form with `props`: its id and slug. */
async function seedPage(
  page: Page,
  run: string,
  props: Record<string, unknown>,
  status: "draft" | "published" = "draft"
): Promise<{ id: string; slug: string }> {
  const slug = `pick-a-form-${run}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Pick a form ${run}`,
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "contact", type: "core/form", version: 2, props }],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

const SIMPLE = {
  submitText: "Send",
  fields: [{ label: "Name", type: "text", required: true }],
};

test.describe("picking a Forms form in the Form block", () => {
  test("lists the site's forms first, draws a picked one, and goes back to a simple form", async ({
    page,
  }) => {
    const run = stamp();
    const quote = await seedForm(page, run, "Quote", "published");
    const news = await seedForm(page, run, "Newsletter", "draft");
    const event = await seedForm(page, run, "Event", "closed");
    const { id } = await seedPage(page, run, SIMPLE);
    await openBuilder(page, id);
    await clickBlock(page, "contact");

    const content = page.getByRole("tabpanel", { name: "Content" });
    const picker = content.getByRole("combobox", { name: "Form", exact: true });
    await expect(picker).toHaveText("Pick a form");
    await picker.click();
    await expect(
      page.getByRole("option", { name: quote.name, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: `${news.name} (Draft)` })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: `${event.name} (Closed)` })
    ).toBeVisible();
    await page.getByRole("option", { name: `${news.name} (Draft)` }).click();

    // Drawn on the canvas as a visitor will see it, and said to be a draft.
    await expect(canvasFrame(page).getByText(`Your name ${run}`)).toBeVisible();
    await expect(
      page.getByText("Draft form: visitors can't send it until it's published")
    ).toBeVisible();
    await expect(
      content.getByText(
        "Fields, emails, spam protection and saved responses come from Forms."
      )
    ).toBeVisible();
    await expect(
      content.getByRole("link", { name: "Edit this form ↗" })
    ).toHaveAttribute("href", new RegExp(`/${news.id}$`));

    // A published one is drawn with nothing said over it.
    await picker.click();
    await page.getByRole("option", { name: quote.name, exact: true }).click();
    // Absence must see hidden elements too: a notice drawn but hidden would
    // otherwise pass a visible-only locator.
    await expect(
      includingHidden(page).getByText(
        "Draft form: visitors can't send it until it's published"
      )
    ).toHaveCount(0);

    await content.getByRole("button", { name: "or use a simple form" }).click();
    await expect(canvasFrame(page).getByText(`Your name ${run}`)).toHaveCount(
      0
    );
    await expect(content.getByRole("list", { name: "Fields" })).toBeVisible();

    await pressSave(page);
    await expect
      .poll(async () => {
        const [form] = await storedPageNodes(page.request, ENTRIES, id);
        return (form as { props: Record<string, unknown> }).props;
      })
      .toEqual(expect.not.objectContaining({ form: expect.anything() }));
  });

  test("says a picked form was deleted, and the live page shows nothing there", async ({
    page,
    browser,
    baseURL,
  }) => {
    const run = stamp();
    const gone = await seedForm(page, run, "Gone", "published");
    const other = await seedForm(page, run, "Other", "published");
    const { id, slug } = await seedPage(
      page,
      run,
      { form: { provider: "forms", ref: gone.id } },
      "published"
    );
    const removed = await page.request.delete(
      `${API}/collections/forms/entries/${gone.id}`
    );
    expect(removed.ok(), `deleting: ${removed.status()}`).toBe(true);

    await openBuilder(page, id);
    const notice = page.locator('[data-form-notice="deleted"]');
    await expect(notice).toContainText("This form was deleted.");
    await notice.getByRole("combobox", { name: "Pick another form" }).click();
    await page.getByRole("option", { name: other.name, exact: true }).click();
    await expect(canvasFrame(page).getByText(`Your name ${run}`)).toBeVisible();
    await expect(notice).toHaveCount(0);

    // The live page, still holding the deleted form: nothing, and no error.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      ...(baseURL === undefined ? {} : { baseURL }),
    });
    try {
      const visitor = await context.newPage();
      const response = await visitor.goto(`/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(visitor.locator("form")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("says a simple form's answers have nowhere to go while Send to is empty", async ({
    page,
  }) => {
    const run = stamp();
    const { id } = await seedPage(page, run, SIMPLE);
    await openBuilder(page, id);
    await expect(page.locator('[data-form-notice="nowhere"]')).toHaveText(
      "Answers have nowhere to go yet: add an address, or install the Forms plugin to save them"
    );

    // The page's checks list it too, under Content and data.
    await page
      .locator('[data-topbar="end"]')
      .getByRole("button", { name: /^\d+ checks?\b/ })
      .click();
    const checks = page.getByRole("dialog", { name: "Page checks" });
    await expect(
      checks
        .getByRole("region", { name: "Content and data" })
        .getByRole("button", { name: /^Form answers have nowhere to go: / })
    ).toBeVisible();
  });
});
