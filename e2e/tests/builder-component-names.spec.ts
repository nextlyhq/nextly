/**
 * A placed component is named by what the author placed.
 *
 * The engine stores a placement as one node of its own instance type, whose
 * label would read "Component instance" everywhere a block is named. The
 * author placed a component with a title, so Layers, the bottom bar and the
 * entry screen's list of sections name it by that title, and a name the
 * author gave the placement wins over it.
 *
 * Each case seeds its own component and page through the admin API.
 *
 * @module tests/builder-component-names.spec
 */
import { expect, type Page } from "@playwright/test";

import { block } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const INSTANCE_TYPE = "nextly/component-instance";

async function created(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await page.request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${answer.status()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

/** A published component titled `title`, placed twice: once named, once not. */
async function seed(page: Page, title: string, tag: string): Promise<string> {
  const componentId = await created(page, COMPONENTS, {
    title,
    slug: `named-${tag}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "t",
          type: "core/heading",
          version: 1,
          props: { text: "Card title", level: "h2" },
        },
      ],
    },
  });
  return created(page, PAGES, {
    title: `Names ${tag}`,
    slug: `names-${tag}`,
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "lead",
          type: "core/heading",
          version: 1,
          props: { text: `Lead ${tag}`, level: "h2" },
        },
        {
          id: "p1",
          type: INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
        {
          id: "p2",
          type: INSTANCE_TYPE,
          version: 1,
          name: "Pricing teaser",
          props: { componentId },
        },
      ],
    },
  });
}

function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

test.describe("a placed component's name", () => {
  test("is its component's title in Layers and the bottom bar", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const title = `Offer card ${tag}`;
    const pageId = await seed(page, title, tag);

    await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
    await expect(await block(page, "lead")).toBeVisible({ timeout: 60_000 });
    await railButton(page, "Layers").click();
    const tree = page.getByRole("tree", { name: "Layers" });

    // The author's own name wins; the unnamed placement reads as its
    // component, not as the engine's word for a placement.
    // A row says "component" after a title, so the title is not read as a
    // block's own name.
    const rows = tree.getByRole("treeitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAccessibleName("Heading");
    await expect(rows.nth(1)).toHaveAccessibleName(`${title} component`);
    await expect(rows.nth(2)).toHaveAccessibleName("Pricing teaser component");

    await rows.nth(1).click();
    await expect(
      page.getByRole("list", { name: "Current location" }).getByRole("button")
    ).toHaveText(["Page", title]);

    // The editor's search finds it by that title too, and says what it is.
    await page.getByRole("button", { name: "Search and commands" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill(title);
    const found = palette
      .getByRole("group", { name: "On this page" })
      .getByRole("option");
    await expect(found).toHaveCount(1);
    await expect(found).toContainText(title);
    await expect(found).toContainText("Component");
  });

  test("is its component's title in the entry screen's sections", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const title = `Offer card ${tag}`;
    const pageId = await seed(page, title, tag);

    await gotoAdmin(page, `/collections/pages/${pageId}`);
    const rows = page.getByRole("list", { name: "Sections" }).getByRole("link");
    await expect(rows).toHaveText(
      [
        new RegExp(`^1\\s*Heading\\s*Lead ${tag}`),
        new RegExp(`^2\\s*${title}\\s*Card title`),
        /^3\s*Pricing teaser\s*Card title/,
      ],
      { timeout: 30_000 }
    );
  });
});
