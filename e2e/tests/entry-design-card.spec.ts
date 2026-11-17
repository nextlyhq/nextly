/**
 * A post's Design card at 1280px, laid out by a real browser.
 *
 * A post drawn by the Posts collection template shows the card in the
 * document panel, headed with the template's name and saying every post uses
 * it. Its Preview opens the post's preview beside the form and folds the
 * panel, the same as the document bar's Preview: the split opens, the panel
 * leaves the screen, and the bar's own pane toggle reads pressed.
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
 * with a step that puts back what was there: the template removed when this
 * file made it, or set back to a draft when this file published another
 * spec's.
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
  if (!wasPublished) {
    const published = await api.patch(`${TEMPLATES}/${id}`, {
      data: { status: "published" },
    });
    expect(published.ok(), await published.text()).toBe(true);
  }
  return {
    title,
    restore: async () => {
      if (made.ok()) {
        const removed = await api.post(ACTIONS, {
          data: { action: { kind: "delete-template", id } },
          headers: await pluginWriteHeaders(api),
        });
        expect(removed.ok(), await removed.text()).toBe(true);
      } else if (!wasPublished) {
        const draft = await api.patch(`${TEMPLATES}/${id}`, {
          data: { status: "draft" },
        });
        expect(draft.ok(), await draft.text()).toBe(true);
      }
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
    const barToggle = page
      .getByTestId("document-bar")
      .locator('[data-preview-lead="pane"]');
    await expect(barToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-preview-split="open"]')).toHaveCount(0);

    await card.getByRole("button", { name: "Preview", exact: true }).click();

    await expect(page.locator('[data-preview-split="open"]')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(barToggle).toHaveAttribute("aria-pressed", "true");
  } finally {
    await restore();
  }
});
