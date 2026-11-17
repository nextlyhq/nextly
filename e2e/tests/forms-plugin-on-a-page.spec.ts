/**
 * A Forms form placed on a page builder page: the Form block draws the
 * plugin's form on the server, and a plain HTML form post is judged and kept
 * by the plugin exactly as at its JSON address.
 *
 * - With JavaScript on, a page placing the form is published in the builder,
 *   and a visitor's send lands in the form's responses.
 * - A one-response form refuses a second answer with the receiver's plain
 *   words, and a closed form shows its own closed message.
 * - With JavaScript off, the same, from the page's HTML alone. Skipped until
 *   the published route renders the page's body in its first HTML.
 *
 * The page holds the form as the Form block's picker stores it, seeded
 * through the admin API: picking it in the builder's panel is not here yet.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module forms-plugin-on-a-page.spec
 */
import { expect, type Browser, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";

/** A published Forms form: its id. */
async function seedForm(
  page: Page,
  stamp: string,
  settings: Record<string, unknown> = {}
): Promise<string> {
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
  return String(((await form.json()) as { item: { id: string } }).item.id);
}

/** A page placing the form `formId` in its Form block: its id and slug. */
async function seedPage(
  page: Page,
  stamp: string,
  formId: string,
  status: "published" | "draft"
): Promise<{ pageId: string; slug: string }> {
  const slug = `quote-page-${stamp}`;
  const created = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title: `Quote page ${stamp}`,
      slug,
      status,
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
  const pageId = String(
    ((await created.json()) as { item: { id: string } }).item.id
  );
  return { pageId, slug };
}

const stampOf = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** A published Forms form and a published page placing it. */
async function seed(
  page: Page,
  settings: Record<string, unknown> = {}
): Promise<{ formId: string; slug: string }> {
  const stamp = stampOf();
  const formId = await seedForm(page, stamp, settings);
  const { slug } = await seedPage(page, stamp, formId, "published");
  return { formId, slug };
}

/** A visitor, signed in to nothing, with JavaScript on or off. */
async function visitor(
  browser: Browser,
  baseURL: string | undefined,
  javaScriptEnabled: boolean
) {
  const context = await browser.newContext({
    javaScriptEnabled,
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

/**
 * Fill the page's form, after the browser has refused it with the required
 * email empty, send it, and see the form's own message and the kept answers.
 */
async function sendAndSeeItKept(
  page: Page,
  visitorPage: Page,
  formId: string,
  slug: string,
  javaScriptEnabled: boolean
): Promise<void> {
  await visitorPage.goto(`/${slug}`);
  await expect(visitorPage.getByLabel("Service")).toBeVisible();
  // The browser refuses the empty required email with its own message.
  await visitorPage.getByRole("button", { name: "Submit" }).click();
  await expect(visitorPage).toHaveURL(new RegExp(`/${slug}$`));
  await expect(visitorPage.locator('input[name="email"]:invalid')).toHaveCount(
    1
  );

  await visitorPage.getByLabel("Name").fill("Ada");
  // By its spoken name: the label's text also holds the star a screen
  // reader skips, so "Email (required)" is not its text.
  await visitorPage
    .getByRole("textbox", { name: "Email (required)" })
    .fill("ada@example.com");
  await visitorPage.getByLabel("Service").selectOption("build");
  await visitorPage.getByRole("button", { name: "Submit" }).click();

  await expect(visitorPage).toHaveURL(new RegExp(`#form-quote-sent$`));
  const message = visitorPage.locator("#form-quote-sent:visible");
  await expect(message).toContainText("we'll reply soon.");
  // The focus on the answer is the browser's own, from the address's
  // fragment, read from the page's HTML alone. With script on it does not
  // land today: the published route streams the body in a part script
  // reveals. So it is checked with JavaScript off.
  if (!javaScriptEnabled) await expect(message).toBeFocused();
  const kept = await submissions(page, formId);
  expect(kept).toHaveLength(1);
  expect(kept[0]?.data).toMatchObject({
    name: "Ada",
    email: "ada@example.com",
    service: "build",
  });
}

/**
 * A one-response form refuses the same email a second time, keeping one
 * answer; closed in Forms, the page shows the form's own closed message.
 */
async function refusesASecondAnswerThenShowsClosed(
  page: Page,
  visitorPage: Page
): Promise<void> {
  // The closed message waits out the minute a described form is kept.
  test.setTimeout(180_000);
  const { formId, slug } = await seed(page, {
    oneResponse: "email",
    oneResponseField: "email",
  });
  for (const expected of ["sent", "closed"]) {
    await visitorPage.goto(`/${slug}`);
    await visitorPage
      .getByRole("textbox", { name: "Email (required)" })
      .fill("ada@example.com");
    await visitorPage.getByRole("button", { name: "Submit" }).click();
    await expect(visitorPage).toHaveURL(new RegExp(`#form-quote-${expected}$`));
  }
  await expect(visitorPage.locator("#form-quote-closed:visible")).toHaveText(
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
}

test.describe("a Forms form on a page, with JavaScript on", () => {
  test("published in the builder, is drawn from the plugin, sent, and kept as the plugin keeps it", async ({
    page,
    browser,
    baseURL,
  }) => {
    // The builder's first load compiles on a cold dev server.
    test.setTimeout(120_000);
    const stamp = stampOf();
    const formId = await seedForm(page, stamp);
    const { pageId, slug } = await seedPage(page, stamp, formId, "draft");
    const { context, page: visitorPage } = await visitor(
      browser,
      baseURL,
      true
    );

    try {
      await gotoAdmin(
        page,
        `/collections/pages/${pageId}/builder?field=content`
      );
      await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
        timeout: 30_000,
      });
      await page
        .locator('[data-topbar="end"]')
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(
        page
          .locator('[data-topbar="start"]')
          .getByText(/^Page status:/)
          .locator("..")
      ).toHaveText("Page status: Published");

      await sendAndSeeItKept(page, visitorPage, formId, slug, true);
    } finally {
      await context.close();
    }
  });

  test("refuses a second answer to a one-response form, and shows a closed form's message", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { context, page: visitorPage } = await visitor(
      browser,
      baseURL,
      true
    );
    try {
      await refusesASecondAnswerThenShowsClosed(page, visitorPage);
    } finally {
      await context.close();
    }
  });
});

test.describe("a Forms form on a page, with JavaScript off", () => {
  // Every test here needs the page readable from its HTML alone, and the
  // published route streams the page's body in a part only script reveals.
  // These run once the published-page hidden-body fix lands.
  test.skip(
    true,
    "The published route sends the page body hidden until JavaScript runs; " +
      "enabled once it renders in the first HTML."
  );

  test("is drawn from the plugin, sent, and kept as the plugin keeps it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { formId, slug } = await seed(page);
    const { context, page: visitorPage } = await visitor(
      browser,
      baseURL,
      false
    );
    try {
      await sendAndSeeItKept(page, visitorPage, formId, slug, false);
    } finally {
      await context.close();
    }
  });

  test("refuses a second answer to a one-response form, and shows a closed form's message", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { context, page: visitorPage } = await visitor(
      browser,
      baseURL,
      false
    );
    try {
      await refusesASecondAnswerThenShowsClosed(page, visitorPage);
    } finally {
      await context.close();
    }
  });
});
