/**
 * A block a component locks in Layers, held on the page that places it.
 *
 * The page cannot unlock a component's block, so the editor holds the field
 * that drives it before anything is typed: the panel's row is read-only with
 * the reason, and the same text on the canvas says whose it is rather than
 * opening for editing. The field driving a free block of the same placement
 * stays editable. Seeded through the API, so the run judges what an author
 * meets, not how the component was built.
 */
import { expect, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const INSTANCE_TYPE = "nextly/component-instance";
const HELD = "Set by the component";

async function created(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await page.request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${answer.status()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

const heading = (id: string, text: string, extra: object = {}) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
  ...extra,
});

/** A component locking "Hero", both blocks exposed, and a page placing it. */
async function seed(page: Page, tag: string) {
  const title = `Promo ${tag}`;
  const componentId = await created(page, COMPONENTS, {
    title,
    slug: `promo-${tag}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        heading("hero", `Locked words ${tag}`, { locked: true, name: "Hero" }),
        heading("free", `Free words ${tag}`),
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "hero",
          propPath: "text",
          type: "text",
        },
        {
          id: "strap",
          label: "Strap",
          nodeId: "free",
          propPath: "text",
          type: "text",
        },
      ],
    },
  });
  const pageId = await created(page, PAGES, {
    title: `Held ${tag}`,
    slug: `held-${tag}`,
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "p1",
          type: INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
      ],
    },
  });
  return { title, pageId };
}

test.describe("a block a component locks", () => {
  test.describe.configure({ timeout: 180_000 });

  test("holds the field that drives it, with the reason, and leaves the free one", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const { title, pageId } = await seed(page, tag);
    await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
    const canvas = await canvasRoot(page);
    const free = canvas.getByText(`Free words ${tag}`, { exact: true }).first();
    await expect(free).toBeVisible({ timeout: 60_000 });
    await free.click();

    const reason = `${HELD} ${title}. Change it where the component is edited.`;
    const panel = page.getByRole("complementary", { name: "Inspector" });
    await expect(panel.getByText(reason)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByLabel("Title")).toBeDisabled();
    await expect(panel.getByLabel("Strap")).toBeEnabled();

    // The same text on the canvas says whose it is instead of opening.
    await canvas
      .getByText(`Locked words ${tag}`, { exact: true })
      .first()
      .dblclick();
    await expect(page.getByText(reason).last()).toBeVisible();
    await expect(
      canvas.locator('[contenteditable="true"]').filter({
        hasText: `Locked words ${tag}`,
      })
    ).toHaveCount(0);
  });
});
