/**
 * A Forms form placed on a page builder page, sent with JavaScript off: the
 * Form block draws the plugin's form on the server, and a plain HTML form
 * post is judged and kept by the plugin exactly as at its JSON address.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module forms-plugin-on-a-page.spec
 */
import { expect, type Browser, type Page } from "@playwright/test";

import { test } from "./support/test";

const API = "/admin/api";

/** A published Forms form and a published page placing it: their ids and the page's slug. */
async function seed(
  page: Page,
  settings: Record<string, unknown> = {}
): Promise<{ formId: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const form = await page.request.post(`${API}/collections/forms/entries`, {
    data: {
      name: `Quote ${stamp}`,
      slug: `quote-${stamp}`,
      status: "published",
      fields: [
        { type: "text", name: "name", label: "Name" },
        { type: "email", name: "email", label: "Email", required: true },
        {
          type: "select",
          name: "service",
          label: "Service",
          options: [
            { value: "design", label: "Design" },
            { value: "build", label: "Build" },
          ],
        },
      ],
      settings: {
        confirmationType: "message",
        successMessage: `Thanks ${stamp}, we'll reply soon.`,
        ...settings,
      },
    },
  });
  expect(form.ok(), `seeding the form: ${form.status()}`).toBe(true);
  const formId = String(
    ((await form.json()) as { item: { id: string } }).item.id
  );
  const slug = `quote-page-${stamp}`;
  const created = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title: `Quote page ${stamp}`,
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "quote",
            type: "core/form",
            version: 2,
            props: { form: { provider: "forms", ref: formId } },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return { formId, slug };
}

/** A visitor with JavaScript off. */
async function visitor(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: { cookies: [], origins: [] },
    ...(baseURL === undefined ? {} : { baseURL }),
  });
  return { context, page: await context.newPage() };
}

/** The submissions kept for `formId`. */
async function submissions(page: Page, formId: string) {
  const read = await page.request.get(
    `${API}/collections/form-submissions/entries?where[form][equals]=${formId}&limit=10`
  );
  expect(read.ok()).toBe(true);
  return ((await read.json()) as { items: { data: Record<string, unknown> }[] })
    .items;
}

test.describe("a Forms form on a page, with JavaScript off", () => {
  test("is drawn from the plugin, sent, and kept as the plugin keeps it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { formId, slug } = await seed(page);
    const { context, page: visitorPage } = await visitor(browser, baseURL);
    try {
      await visitorPage.goto(`/${slug}`);
      await expect(visitorPage.getByLabel("Service")).toBeVisible();
      // The browser refuses the empty required email with its own message.
      await visitorPage.getByRole("button", { name: "Submit" }).click();
      await expect(visitorPage).toHaveURL(new RegExp(`/${slug}$`));

      await visitorPage.getByLabel("Name").fill("Ada");
      await visitorPage.getByLabel("Email (required)").fill("ada@example.com");
      await visitorPage.getByLabel("Service").selectOption("build");
      await visitorPage.getByRole("button", { name: "Submit" }).click();

      await expect(visitorPage).toHaveURL(new RegExp(`#form-quote-sent$`));
      const message = visitorPage.locator("#form-quote-sent");
      await expect(message).toContainText("we'll reply soon.");
      await expect(message).toBeFocused();
      const kept = await submissions(page, formId);
      expect(kept).toHaveLength(1);
      expect(kept[0]?.data).toMatchObject({
        name: "Ada",
        email: "ada@example.com",
        service: "build",
      });
    } finally {
      await context.close();
    }
  });

  test("refuses a second answer to a one-response form, and shows a closed form's message", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { formId, slug } = await seed(page, {
      oneResponse: "email",
      oneResponseField: "email",
    });
    const { context, page: visitorPage } = await visitor(browser, baseURL);
    try {
      for (const expected of ["sent", "closed"]) {
        await visitorPage.goto(`/${slug}`);
        await visitorPage
          .getByLabel("Email (required)")
          .fill("ada@example.com");
        await visitorPage.getByRole("button", { name: "Submit" }).click();
        await expect(visitorPage).toHaveURL(
          new RegExp(`#form-quote-${expected}$`)
        );
      }
      await expect(visitorPage.locator("#form-quote-closed")).toHaveText(
        "This form isn't taking answers right now."
      );
      expect(await submissions(page, formId)).toHaveLength(1);

      const closed = await page.request.patch(
        `${API}/collections/forms/entries/${formId}`,
        {
          data: {
            status: "closed",
            closedMessage: "Quotes are closed for the holidays.",
            _overwrite: true,
          },
        }
      );
      expect(closed.ok(), `closing the form: ${closed.status()}`).toBe(true);
      // A described form is kept for up to a minute; a fresh page shows it.
      await expect
        .poll(
          async () => {
            await visitorPage.goto(`/${slug}?fresh=${Date.now()}`);
            return await visitorPage.locator("body").innerText();
          },
          { timeout: 90_000, intervals: [5_000] }
        )
        .toContain("Quotes are closed for the holidays.");
    } finally {
      await context.close();
    }
  });
});
