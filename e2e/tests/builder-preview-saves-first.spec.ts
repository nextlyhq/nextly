/**
 * Preview in the page builder shows what the canvas shows.
 *
 * The preview renders the saved page only, so with unsaved changes Preview
 * claims the tab, saves a draft, then opens the preview in that tab, and its
 * menu's "Preview this version" says "Saves a draft first". Started from the
 * press and from the menu item alike. On a published page the draft waits
 * beside the live version, so the edit is in the preview and nowhere a
 * visitor looks.
 *
 * Asked of the real server: the preview is the tab the button opened, and the
 * live page is read by a visitor with no session.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000c641";
const LIVE_TEXT = "The heading visitors see";
const EDIT = " and the edit";

/** The site's address, which a preview link is built on. */
async function useThisSite(page: Page, baseURL: string): Promise<void> {
  const saved = await page.request.patch("/admin/api/general-settings", {
    data: { siteUrl: baseURL },
  });
  expect(saved.ok(), `saving the site URL: ${saved.status()}`).toBe(true);
}

/** A published page holding one heading, with its id and address. */
async function publishedPage(
  page: Page
): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `preview-saves-${stamp}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Preview saves ${stamp}`,
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: LIVE_TEXT, level: "h1" },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return { id, slug };
}

/** The published row as stored, without the working draft laid over it. */
async function publishedRow(
  api: APIRequestContext,
  id: string
): Promise<{ status: string; text: unknown }> {
  const response = await api.get(`${ENTRIES}/${encodeURIComponent(id)}`);
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    status: string;
    content?: { nodes?: { props?: { text?: unknown } }[] };
  };
  return { status: body.status, text: body.content?.nodes?.[0]?.props?.text };
}

for (const start of ["the press", "the menu"] as const) {
  test(`Preview from ${start} saves a draft, previews it, and leaves the live page as it was`, async ({
    page,
    context,
    playwright,
  }, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL!;
    await useThisSite(page, baseURL);
    const { id, slug } = await publishedPage(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    const heading = canvasBlock(page, HEADING).first();
    await expect(heading).toBeVisible({ timeout: 60_000 });
    const bar = page.locator('[data-topbar="end"]');

    // Nothing unsaved: the saved version is what the canvas shows.
    await expect(
      bar.getByRole("button", { name: "Preview", exact: true })
    ).toBeVisible();

    await heading.dblclick();
    await expect(heading).toHaveAttribute("contenteditable", /.+/);
    await page.keyboard.press("End");
    await page.keyboard.type(EDIT);
    await page.keyboard.press("Escape");
    await expect(heading).toContainText(`${LIVE_TEXT}${EDIT}`);

    // The menu says the preview saves a draft first, now there is work to save.
    await bar.getByRole("button", { name: "Preview options" }).click();
    const thisVersion = page.getByRole("menuitem", {
      name: /Preview this version/,
    });
    await expect(thisVersion).toContainText("Saves a draft first");
    if (start === "the press") await page.keyboard.press("Escape");
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      start === "the press"
        ? bar.getByRole("button", { name: "Preview", exact: true }).click()
        : thisVersion.click(),
    ]);

    // The preview tab shows the edit, which only the saved draft holds.
    await expect(tab.getByText(`${LIVE_TEXT}${EDIT}`)).toBeVisible({
      timeout: 90_000,
    });
    expect(new URL(tab.url()).pathname).toBe(`/${slug}`);

    // Saved as a working draft: the draft holds the edit, while the published
    // row and its status are as they were.
    const draft = await storedPageNodes(page.request, ENTRIES, id);
    expect((draft[0]?.props as { text?: unknown } | undefined)?.text).toBe(
      `${LIVE_TEXT}${EDIT}`
    );
    expect(await publishedRow(page.request, id)).toEqual({
      status: "published",
      text: LIVE_TEXT,
    });

    // A visitor still reads the live page as it was.
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      const live = await visitor.get(`/${slug}`, { timeout: 60_000 });
      expect(live.status()).toBe(200);
      const html = await live.text();
      expect(html).toContain(LIVE_TEXT);
      expect(html).not.toContain(EDIT.trim());
    } finally {
      await visitor.dispose();
    }

    // Back in the builder, the work is saved, so Preview needs no save and
    // its menu no longer says it saves one.
    await tab.close();
    await bar.getByRole("button", { name: "Preview options" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Preview this version" })
    ).toBeVisible();
    await expect(page.getByText("Saves a draft first")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
}
