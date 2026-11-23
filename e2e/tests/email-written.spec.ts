/**
 * A written email against a real server: its blocks reorder by pointer, by
 * keyboard and by touch at a phone's width; a link lands on the text that
 * was selected when the Link dialog opened; a block's condition is stored;
 * the email converts to code; and axe finds nothing at AA at phone, tablet
 * and desktop widths in both themes.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { AA_TAGS, settleTransitions } from "./support/axe-scan.mjs";
import { LOCK } from "./support/locks";
import { expectOk } from "./support/runtime-collection";
import { fileAccount, test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.email] });

const RUN = Date.now().toString(36);
let made = 0;

/** A heading block holding `text`. */
const heading = (text: string) => ({
  type: "heading",
  text: [{ type: "text", text }],
});

/** The parts of a stored template these tests read back. */
interface StoredTemplate {
  format?: string;
  htmlContent?: string;
  blocks?: { blocks: Array<Record<string, unknown>> } | null;
}

/** The stored template, read back through the API. */
async function stored(
  api: APIRequestContext,
  id: string
): Promise<StoredTemplate> {
  const res = await api.get(`/admin/api/email-templates/${id}`);
  await expectOk(res, "read the written email");
  const body = (await res.json()) as {
    item?: StoredTemplate;
    data?: StoredTemplate;
  } & StoredTemplate;
  return body.item ?? body.data ?? body;
}

/**
 * Makes a written email of three headings and a text, with a yes-or-no
 * variable, and returns its id; the test's teardown deletes it.
 */
async function makeWritten(api: APIRequestContext): Promise<string> {
  made += 1;
  const res = await api.post("/admin/api/email-templates", {
    data: {
      name: `Written ${RUN}-${made}`,
      slug: `written-${RUN}-${made}`,
      subject: "Your order",
      htmlContent: "",
      format: "written",
      variables: [
        { name: "vip", description: "", type: "boolean", label: "VIP" },
      ],
      blocks: {
        version: 1,
        blocks: [
          heading("First"),
          heading("Second"),
          heading("Third"),
          { type: "text", text: [{ type: "text", text: "Track it here" }] },
        ],
      },
    },
  });
  await expectOk(res, "create a written email");
  return ((await res.json()) as { item: { id: string } }).item.id;
}

/** Opens the written email in the workbench. */
async function openWritten(
  page: Page,
  id: string,
  theme: Theme = "light"
): Promise<void> {
  await gotoAdmin(page, `/settings/email/messages/edit/${id}`, theme);
  await expect(
    page.getByRole("group", { name: "Heading block" }).first()
  ).toBeVisible({ timeout: 30_000 });
}

/** The headings, top to bottom, as the cards show them. */
async function headingOrder(page: Page): Promise<string[]> {
  return page
    .getByRole("textbox", { name: "Heading", exact: true })
    .allTextContents();
}

/** Saves the email with the workbench's Save button. */
async function save(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Save", exact: true })
    .filter({ visible: true })
    .first()
    .click();
}

let api: APIRequestContext;
const ids: string[] = [];

// A session-bound API context, as every admin write needs: without one the
// setup posts unauthenticated and nothing here runs against real data.
test.beforeEach(async ({ playwright, baseURL }, testInfo) => {
  if (!baseURL) throw new Error("[e2e] No baseURL configured.");
  api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
});

test.afterEach(async () => {
  // Each one asserted: a silently refused teardown leaves the email in the
  // shared database for every later run.
  for (const id of ids.splice(0)) {
    await expectOk(
      await api.delete(`/admin/api/email-templates/${id}`),
      "delete the written email"
    );
  }
  await api.dispose();
});

test.describe("a written email at desktop width", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reorders blocks by dragging a handle", async ({ page }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    const handles = page.getByTitle("Drag to move");
    const from = await handles.nth(0).boundingBox();
    const to = await handles.nth(1).boundingBox();
    if (!from || !to) throw new Error("the handles are not drawn");
    // A drag starts past a few pixels of movement, and drops on the second
    // card's handle: the cards shift as it moves, so a point past the second
    // card would land beyond the third.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(() => headingOrder(page))
      .toEqual(["Second", "First", "Third"]);
  });

  test("reorders blocks by keyboard", async ({ page }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    const first = page.getByRole("group", { name: "Heading block" }).first();
    await first.getByRole("button", { name: "Move down" }).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => headingOrder(page))
      .toEqual(["Second", "First", "Third"]);
  });

  test("links the text that was selected when the Link dialog opened", async ({
    page,
  }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    const text = page.getByRole("textbox", { name: "Text", exact: true });
    await text.click();
    await page.keyboard.press("End");
    // "here", the last word, selected from the keyboard.
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    // The dialog takes the focus, and the selection must survive it.
    await dialog
      .getByRole("textbox", { name: "Address" })
      .fill("https://shop.example/track");
    await dialog.getByRole("button", { name: "Save link" }).click();
    // The editor draws a link as an anchor without an address, which has no
    // link role, so it is found as the anchor it is.
    await expect(text.locator("a", { hasText: "here" })).toBeVisible();
    await save(page);
    await expect
      .poll(async () => (await stored(api, id)).blocks?.blocks[3])
      .toEqual({
        type: "text",
        text: [
          { type: "text", text: "Track it " },
          {
            type: "text",
            text: "here",
            link: { url: "https://shop.example/track" },
          },
        ],
      });
  });

  test("stores a block's condition", async ({ page }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    await page
      .getByRole("button", { name: "Actions for this heading block" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Show only when…" }).click();
    const dialog = page.getByRole("dialog", { name: "Show only when" });
    await dialog.getByLabel("Variable").selectOption({ label: "VIP" });
    await dialog.getByLabel("is yes").check();
    await dialog.getByRole("button", { name: "Save condition" }).click();
    await expect(page.getByText("Shown only when VIP is yes")).toBeVisible();
    await save(page);
    await expect
      .poll(async () => (await stored(api, id)).blocks?.blocks[0])
      .toEqual({ ...heading("First"), show: { variable: "vip", when: "yes" } });
  });

  test("converts to code, keeping its blocks as HTML", async ({ page }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Convert to code…" }).click();
    const dialog = page.getByRole("dialog", { name: "Convert to code?" });
    await expect(dialog.getByText(/can't be undone/)).toBeVisible();
    await dialog.getByRole("button", { name: "Convert to code" }).click();
    await expect.poll(async () => (await stored(api, id)).format).toBe("code");
    const after = await stored(api, id);
    expect(after.blocks ?? null).toBeNull();
    expect(after.htmlContent).toContain("Second");
    // The workbench reloads it as coded: no blocks left to edit.
    await expect(
      page.getByRole("group", { name: "Heading block" })
    ).toHaveCount(0);
  });
});

test.describe("a written email on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("reorders blocks by touch, with Move up and Move down", async ({
    page,
  }) => {
    const id = await makeWritten(api);
    ids.push(id);
    await openWritten(page, id);
    // No drag handle on a phone: the moves are buttons a thumb can reach.
    await expect(page.getByTitle("Drag to move").first()).toBeHidden();
    const first = page.getByRole("group", { name: "Heading block" }).first();
    await first.getByRole("button", { name: "Move down" }).tap();
    await expect
      .poll(() => headingOrder(page))
      .toEqual(["Second", "First", "Third"]);
  });
});

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe finds nothing at AA at ${width} px, ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const id = await makeWritten(api);
      ids.push(id);
      await openWritten(page, id, theme);
      // Legacy mode, as the workbench's own scan uses: the default merges
      // the frames' results in a blank page, which never finishes once the
      // preview's srcdoc frame has been scanned, from tablet width up where
      // the preview shows. The scan is of the workbench; the email in the
      // sandboxed preview is not part of it.
      // Settled first, as the shared scan does: in dark, the admin's palette
      // transitions in, and a scan mid-way measures colours that never stay.
      await settleTransitions(page);
      const results = await new AxeBuilder({ page })
        .include('[data-testid="workbench-header"]')
        .include("main")
        .withTags(AA_TAGS)
        .setLegacyMode(true)
        .analyze();
      // A scan of nothing reports nothing, as a clean page does.
      expect(results.passes.length, "axe scanned nothing").toBeGreaterThan(10);
      expect(
        results.violations.map(violation => ({
          id: violation.id,
          nodes: violation.nodes.map(node => node.target.map(String)),
        }))
      ).toEqual([]);
    });
  }
}
