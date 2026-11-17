/**
 * A post's Design card at 1280px, laid out by a real browser.
 *
 * A post drawn by the Posts collection template shows the card in the
 * document panel, headed with the template's name and saying every post uses
 * it. Its Preview opens the post's preview beside the form and folds the
 * panel, the same as the document bar's Preview: the split opens, the panel
 * leaves the screen, and the bar's own Preview reads open. The pane leaves the
 * editor under 600px wide, so the bar has folded its Preview into the
 * document's menu by then, where it offers to hide the pane.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const TEMPLATES = `${API}/collections/templates/entries`;
const ACTIONS = `${API}/plugins/@nextlyhq/plugin-page-builder/templates/actions`;

/** The CSRF token and origin a cookie-signed write to a plugin route needs. */
async function pluginWriteHeaders(
  api: APIRequestContext
): Promise<Record<string, string>> {
  const csrf = await api.get(`${API}/auth/csrf`);
  const { token } = (await csrf.json()) as { token: string };
  return { "x-csrf-token": token, origin: new URL(csrf.url()).origin };
}

/** The site's address, which a preview is built on. */
async function useThisSite(page: Page, baseURL: string): Promise<void> {
  const saved = await page.request.patch(`${API}/general-settings`, {
    data: { siteUrl: baseURL },
  });
  expect(saved.ok(), `saving the site URL: ${saved.status()}`).toBe(true);
}

/**
 * Makes sure Posts has its one template, published, and answers its title
 * with a step that sets it back to a draft when this file published it.
 *
 * Never deleted, even when this file made it: a collection has one template,
 * and another file running beside this one may have picked it up as its own
 * by then. A draft template is what a file making it would have left.
 */
async function publishedPostsTemplate(
  api: APIRequestContext
): Promise<{ title: string; restore: () => Promise<void> }> {
  const made = await api.post(ACTIONS, {
    data: { action: { kind: "create-template", collection: "posts" } },
    headers: await pluginWriteHeaders(api),
  });
  const found = await api.get(
    // Drafts too: a template is made as a draft.
    `${TEMPLATES}?where[collection][equals]=posts&status=all&limit=1`
  );
  expect(found.ok(), await found.text()).toBe(true);
  const { items } = (await found.json()) as {
    items: { id: string; title: string; status?: string }[];
  };
  const template = items[0];
  // The control: whichever spec made it, Posts has one.
  expect(
    template,
    `Posts has no template: ${made.status()} ${await made.text()}`
  ).toBeDefined();
  const { id, title } = template!;
  const wasPublished = template!.status === "published";
  // `_overwrite`, so the status moves on the stored row rather than into a
  // working draft beside it.
  const setStatus = async (status: "draft" | "published") => {
    const saved = await api.patch(`${TEMPLATES}/${id}`, {
      data: { status, _overwrite: true },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  };
  if (!wasPublished) await setStatus("published");
  return {
    title,
    restore: async () => {
      if (!wasPublished) await setStatus("draft");
    },
  };
}

/** A published post of this run, by its id. */
async function publishedPost(api: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await api.post(`${API}/collections/posts/entries`, {
    data: {
      title: `Design card ${stamp}`,
      slug: `design-card-${stamp}`,
      status: "published",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

test("a post's Design card names its template, and its Preview opens beside the form", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await useThisSite(page, testInfo.project.use.baseURL!);
  const { title, restore } = await publishedPostsTemplate(page.request);
  try {
    const postId = await publishedPost(page.request);
    await gotoAdmin(page, `/collections/posts/${postId}`);
    // The author's choice is kept between visits; start from the panel shown.
    await page.evaluate(() =>
      window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "0")
    );
    await page.reload();

    const panel = page.getByRole("complementary", { name: "Document panel" });
    await expect(panel).toHaveAttribute("data-document-panel", "docked", {
      timeout: 30_000,
    });
    const card = panel.getByRole("region", { name: "Design", exact: true });
    await expect(card).toContainText(`Design: ${title}`);
    await expect(card).toContainText(
      "Every post uses it. Edit the template to change all posts."
    );
    await expect(
      card.getByRole("button", { name: "Give this post its own design" })
    ).toBeVisible();

    // The bar's own pane toggle, which the card's Preview must match.
    await expect(
      page.getByTestId("document-bar").locator('[data-preview-lead="pane"]')
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-preview-split="open"]')).toHaveCount(0);

    await card.getByRole("button", { name: "Preview", exact: true }).click();

    await expect(page.locator('[data-preview-split="open"]')).toBeVisible();
    await expect(panel).toHaveCount(0);
    // The bar's state is the pane's: its Preview, folded into the document's
    // menu at the editor's width beside the pane, now offers to hide it.
    await expect(page.locator("[data-document-editor-frame]")).toHaveAttribute(
      "data-panel-mode",
      "sheet"
    );
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Hide preview pane" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await restore();
  }
});
