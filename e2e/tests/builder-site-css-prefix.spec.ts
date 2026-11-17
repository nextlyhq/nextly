/**
 * The site's CSS variable prefix, in a browser: Settings → Site → Advanced
 * shows `--site-` with what a change asks of the site's own CSS, refuses
 * `--nx-`, `--tw-` and a prefix that isn't one with a reason, and changes it
 * to `--brand-` once confirmed. The canvas and the published page are then
 * written under `--brand-` and look the same, and a colour's "Code name"
 * reads `--brand-…`.
 *
 * @module tests/builder-site-css-prefix.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { block } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The site's variables and prefix are changed and put back here.
test.describe.configure({ lock: [LOCK.siteStyle], timeout: 240_000 });

const ENTRIES = "/admin/api/collections/pages/entries";
const SITE_STYLE = "/admin/api/singles/site-style";
const PREFIX_ROUTE =
  "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/css-prefix";
const TEXT_ID = "prefix-text";
const WORDS = "Words in the brand colour";
const BRAND = {
  name: "color.brand",
  kind: "color",
  values: { light: "#1d2b6b" },
};

/** Set the prefix the one way it changes: Settings' route. */
async function setPrefix(
  request: APIRequestContext,
  prefix: string
): Promise<void> {
  const csrf = await request.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which an API
  // request does not send: named here as the site's own.
  const origin = new URL(csrf.url()).origin;
  const answer = await request.post(PREFIX_ROUTE, {
    data: { prefix },
    headers: { "x-csrf-token": token, origin },
  });
  expect(
    answer.ok(),
    `setting the prefix: ${answer.status()} ${await answer.text()}`
  ).toBe(true);
}

async function storedTokens(request: APIRequestContext): Promise<unknown> {
  const response = await request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

async function writeTokens(
  request: APIRequestContext,
  tokens: unknown
): Promise<void> {
  const written = await request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** A published page of one text in the brand colour, with no header or footer. */
async function createPage(request: APIRequestContext): Promise<{
  id: string;
  slug: string;
}> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `prefix-${stamp}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Prefix ${stamp}`,
      slug,
      status: "published",
      noHeaderFooter: true,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: TEXT_ID,
            type: "core/text",
            version: 1,
            props: { text: WORDS },
            styles: { base: { base: { color: { $token: "color.brand" } } } },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** How one element is drawn: its colour and the two prefixes' definitions. */
async function drawn(element: Locator): Promise<{
  color: string;
  site: string;
  brand: string;
}> {
  return element.evaluate(node => {
    const style = getComputedStyle(node);
    return {
      color: style.color,
      site: style.getPropertyValue("--site-color-brand").trim(),
      brand: style.getPropertyValue("--brand-color-brand").trim(),
    };
  });
}

async function showSettings(page: Page): Promise<Locator> {
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * The site's variables as the test found them, put back after it, with the
 * prefix back at `--site-` first (only Settings' route may change it).
 */
let found: { tokens: unknown } | null = null;
/** The page the test made, removed first: it uses the variable put back. */
let made: string | null = null;

test.afterEach(async ({ page }) => {
  if (made !== null) {
    const removed = await page.request.delete(`${ENTRIES}/${made}`);
    expect(removed.ok(), `removing the page: ${removed.status()}`).toBe(true);
    made = null;
  }
  if (found === null) return;
  const { tokens } = found;
  found = null;
  await setPrefix(page.request, "--site-");
  // The variables go back without their prefix, which the site style refuses
  // to change outside Settings; a prefix they held goes back through it.
  const held =
    typeof tokens === "object" && tokens !== null
      ? (tokens as Record<string, unknown>)
      : null;
  const { prefix, ...rest } = held ?? {};
  await writeTokens(page.request, held === null ? tokens : rest);
  if (typeof prefix === "string") await setPrefix(page.request, prefix);
});

test("the prefix changes to --brand- in Settings, and the canvas and the published page follow it looking the same", async ({
  page,
}) => {
  found = { tokens: await storedTokens(page.request) };
  await writeTokens(page.request, { tokens: [BRAND] });
  const { id, slug } = await createPage(page.request);
  made = id;

  // The published page before: visited once, so a cached copy exists that
  // the change must not leave standing.
  await page.goto(`/${slug}`);
  const published = page.getByText(WORDS);
  await expect(published).toBeVisible();
  const before = await drawn(published);
  expect(before.site).not.toBe("");

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  const text = await block(page, TEXT_ID);
  await expect(text).toBeVisible({ timeout: 60_000 });
  const canvasBefore = await drawn(text);
  expect(canvasBefore.color).toBe(before.color);

  const dialog = await showSettings(page);
  await dialog.getByRole("tab", { name: "Site" }).click();
  const site = dialog.getByRole("tabpanel", { name: "Site" });
  await expect(site.getByRole("heading", { name: "Advanced" })).toBeVisible();
  const field = site.getByLabel("CSS variable prefix");
  await expect(field).toHaveValue("--site-");
  await expect(
    site.getByText(
      "Your site's own CSS that uses --site- names must change too."
    )
  ).toBeVisible();
  const change = site.getByRole("button", { name: "Change prefix" });

  for (const [typed, reason] of [
    [
      "--nx-",
      "--nx- is kept for the admin's own styles. Choose another prefix.",
    ],
    ["--tw-", "--tw- is used by Tailwind. Choose another prefix."],
    [
      "brand",
      "A prefix starts with two dashes, uses only lowercase letters, numbers and dashes, and ends with a dash, like --brand-.",
    ],
  ] as const) {
    await field.fill(typed);
    // By its words: the Site tab carries an alert of its own (changes apply
    // to the live site at once).
    await expect(site.getByText(reason, { exact: true })).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(change).toBeDisabled();
  }

  await field.fill("--brand-");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await change.click();
  const question = page.getByRole("alertdialog");
  await expect(question).toContainText("Change the prefix to --brand-?");
  await expect(question).toContainText(
    "Your site's own CSS that uses --site- names must change too."
  );
  const saved = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith("/site/css-prefix") &&
      !(response.request().postData() ?? "").includes("dryRun") &&
      response.ok()
  );
  await question.getByRole("button", { name: "Change prefix" }).click();
  await saved;
  await expect(
    site.getByRole("status").filter({ hasText: "Saved" })
  ).toBeVisible();
  await expect(
    site.getByText(
      "Your site's own CSS that uses --brand- names must change too."
    )
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The canvas: written under --brand- at once, and drawn the same.
  await expect
    .poll(async () => (await drawn(await block(page, TEXT_ID))).brand)
    .not.toBe("");
  const canvasAfter = await drawn(await block(page, TEXT_ID));
  expect(canvasAfter.site).toBe("");
  expect(canvasAfter.color).toBe(canvasBefore.color);

  // Design → Colours: the colour's code name reads the new prefix.
  const panel = page.getByRole("region", { name: "Design panel" });
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Colours/ }).click();
  await panel.getByRole("button", { name: /^Brand/ }).click();
  await expect(
    page.locator(".nx-vars-editor .nx-vars-editor__code code")
  ).toHaveText("--brand-color-brand");
  await page.keyboard.press("Escape");

  // The published page: written under --brand- on the next visit, the same.
  await page.goto(`/${slug}`);
  await expect(published).toBeVisible();
  const after = await drawn(published);
  expect(after.brand).not.toBe("");
  expect(after.site).toBe("");
  expect(after.color).toBe(before.color);
});
