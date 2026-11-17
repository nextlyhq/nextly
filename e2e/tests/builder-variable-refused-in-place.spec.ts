/**
 * A Design variable's value is checked where it is typed, and a removal is
 * left to the save to decide.
 *
 * - A value the save would refuse is refused in its own field, with the
 *   reason under it, before anything is sent. The variable stays, and the
 *   page can still be saved.
 * - On a site whose pages are not counted yet, a new variable is removed in
 *   one press and its confirm: the editor does not refuse it for want of a
 *   count, and the save counts the pages before it decides.
 *
 * Both put the site's variables back after.
 */
import { expect, type Page } from "@playwright/test";

import { block, openEditorWith, pressSave } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const NODES = ["First", "Second"].map((text, at) => ({
  id: `refused-${at}`,
  type: "core/text",
  version: 1,
  props: { text },
}));

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

async function writeTokens(page: Page, tokens: unknown): Promise<void> {
  // Dropping a variable is refused until every page is counted.
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
}

/** Add a spacing variable from the Design panel's Spacing tab, and answer its editor. */
async function addSpacing(page: Page) {
  await page
    .getByRole("region", { name: "Design panel" })
    .getByRole("tab", { name: /^Spacing/ })
    .click();
  await page.getByRole("button", { name: "Add spacing" }).click();
  const editor = page.getByRole("dialog", { name: /^Edit New spacing/ });
  await expect(editor).toBeVisible();
  return editor;
}

test("a value the save would refuse is refused in its field, and the page still saves", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  // Every site-style write the editor sends, by its body.
  const sent: string[] = [];
  page.on("request", request => {
    if (request.url().includes(SITE_STYLE) && request.method() !== "GET") {
      sent.push(request.postData() ?? "");
    }
  });
  try {
    await openEditorWith(page, NODES, "refused-1");
    await openDesign(page);
    const editor = await addSpacing(page);
    const light = editor.getByRole("textbox", { name: "Light" });
    await light.fill("12pxred");
    await light.press("Enter");
    // Said under the field, in words, with what to type instead.
    await expect(
      editor.getByText(
        '"12pxred" is measured in pxred, which is not a unit CSS knows, not a length. Type a number with a unit, such as 16px or 1.5rem.'
      )
    ).toBeVisible();
    await expect(light).toHaveAttribute("aria-invalid", "true");
    // A bare number becomes a length.
    await light.fill("20");
    await light.press("Enter");
    await expect(light).toHaveValue("20px");
    await expect(light).not.toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    // The variable stays, and the refused value was never sent.
    await expect(
      page.getByRole("button", { name: /^New spacing/ })
    ).toBeVisible();
    expect(sent.some(body => body.includes("12pxred"))).toBe(false);

    // An edit to the page, then Save: the page is saved.
    const second = await block(page, "refused-1");
    await second.click();
    await page.keyboard.press("Delete");
    const saved = page.waitForResponse(
      response =>
        response.url().includes(HOMEPAGE) &&
        ["PATCH", "PUT", "POST"].includes(response.request().method())
    );
    await pressSave(page);
    expect((await saved).ok()).toBe(true);
    await expect(
      page.getByText(/wasn't saved, so this page wasn't either/)
    ).toHaveCount(0);
  } finally {
    await writeTokens(page, before);
  }
});

test("on a site not counted yet, a new variable is removed in one press", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  // The usage read as a site whose pages have not been counted answers it:
  // nothing counted whole, so every zero is a floor.
  await page.route("**/variables/usage?**", async route => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as {
        whole: boolean;
        variables: Record<string, Record<string, unknown>>;
      };
      body.whole = false;
      for (const reach of Object.values(body.variables)) reach.complete = false;
      await route.fulfill({ response, json: body });
    } catch {
      await route.abort();
    }
  });
  try {
    await openEditorWith(page, NODES, "refused-1");
    await openDesign(page);
    const editor = await addSpacing(page);
    // Nothing is counting, so the line does not say it is.
    await expect(editor.getByText("Not counted yet")).toBeVisible();
    await expect(editor.getByText(/Counting where/)).toHaveCount(0);
    await editor.getByRole("button", { name: "Remove", exact: true }).click();
    // The confirm, at once: no "can't be removed yet".
    await expect(editor.getByText(/can't be removed/)).toHaveCount(0);
    await editor.getByRole("button", { name: /^Remove New spacing/ }).click();
    await expect(editor).toBeHidden();
    await expect(
      page.getByRole("button", { name: /^New spacing/ })
    ).toHaveCount(0);
  } finally {
    await page.unroute("**/variables/usage?**");
    await writeTokens(page, before);
  }
});
