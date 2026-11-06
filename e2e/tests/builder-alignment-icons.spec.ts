/**
 * Alignment and direction set with icons, in the inspector's Style tab.
 *
 * Each group is a radio group of icons: a value is chosen by a click and by
 * the arrow keys, one tab stop for the group, and what is chosen is what the
 * page stores. Seeds its own page through the admin API.
 *
 * @module tests/builder-alignment-icons.spec
 */
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { block, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SECTION = "00000000-0000-4000-8000-00000000b001";
const HEADING = "00000000-0000-4000-8000-00000000b002";

async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pad = "24px";
  const created = await request.post(ENTRIES, {
    data: {
      title: `Alignment ${stamp}`,
      slug: `alignment-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: SECTION,
            type: "core/section",
            version: 1,
            props: { as: "section", contained: true },
            styles: {
              base: {
                base: {
                  display: "flex",
                  padding: {
                    blockStart: pad,
                    blockEnd: pad,
                    inlineStart: pad,
                    inlineEnd: pad,
                  },
                },
              },
            },
            slots: {
              children: [
                {
                  id: HEADING,
                  type: "core/heading",
                  version: 1,
                  props: { text: "Aligned heading", level: "h2" },
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** One node's stored base styles, read back through the API. */
async function storedStyles(
  request: APIRequestContext,
  pageId: string,
  nodeId: string
): Promise<Record<string, unknown>> {
  // By its id, not from a list page the shared database may push it off.
  const response = await request.get(`${ENTRIES}/${pageId}?status=all`);
  expect(response.ok(), `reading the page: ${response.status()}`).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as {
    content?: string | { nodes?: Record<string, unknown>[] };
  };
  const content =
    typeof item.content === "string"
      ? (JSON.parse(item.content) as { nodes?: Record<string, unknown>[] })
      : item.content;
  const walk = (
    nodes: Record<string, unknown>[]
  ): Record<string, unknown> | undefined => {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      const slots = (node.slots ?? {}) as Record<
        string,
        Record<string, unknown>[]
      >;
      for (const children of Object.values(slots)) {
        const found = walk(children);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const node = walk(content?.nodes ?? []);
  const styles = node?.styles as
    | { base?: { base?: Record<string, unknown> } }
    | undefined;
  return styles?.base?.base ?? {};
}

async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

async function openStyle(
  page: Page,
  pageId: string,
  nodeId: string,
  section: string
) {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  // Through the editor driver, which finds a block in the canvas's frame.
  await (await block(page, nodeId))
    .first()
    .click(nodeId === SECTION ? { position: { x: 4, y: 4 } } : {});
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page.getByRole("tab", { name: "Style" }).click();
  const heading = page.getByRole("button", { name: new RegExp(`^${section}`) });
  if ((await heading.getAttribute("data-state")) !== "open")
    await heading.click();
}

/** Each icon of a group chosen by a click, each showing as chosen. */
/**
 * One property's icon group, found by the property's field rather than by
 * the group's name, which takes the provenance dot's words ("Set here") once
 * a value is stored.
 */
function groupOf(page: Page, property: string): Locator {
  return page.locator(`[data-property="${property}"]`).getByRole("radiogroup");
}

async function clickEach(page: Page, property: string): Promise<string> {
  const radios = groupOf(page, property).getByRole("radio");
  const count = await radios.count();
  expect(count, `${property} has icons`).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    await radios.nth(index).click();
    await expect(radios.nth(index)).toHaveAttribute("aria-checked", "true");
  }
  return (await radios.nth(count - 1).getAttribute("aria-label")) ?? "";
}

test.describe("alignment and direction icons", () => {
  test("set a flex container's layout by mouse and by keyboard, as stored", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openStyle(page, pageId, SECTION, "Layout");

    for (const property of [
      "flexDirection",
      "flexWrap",
      "justifyContent",
      "alignItems",
    ]) {
      await clickEach(page, property);
    }

    // By keyboard: the group is one tab stop, and the arrows move the choice.
    const justify = groupOf(page, "justifyContent");
    await justify.getByRole("radio", { name: "Start" }).click();
    const reachable = justify.locator('[role="radio"][tabindex="0"]');
    await expect(reachable).toHaveCount(1);
    await reachable.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      justify.getByRole("radio", { name: "Center" })
    ).toHaveAttribute("aria-checked", "true");
    await expect(justify.getByRole("radio", { name: "Center" })).toBeFocused();

    await saveDraft(page);
    const stored = await storedStyles(page.request, pageId, SECTION);
    expect(stored.justifyContent).toBe("center");
    expect(stored.alignItems).toBe("baseline");
    expect(stored.flexWrap).toBe("wrap-reverse");
    expect(stored.flexDirection).toBe("column-reverse");
  });

  test("set a heading's text alignment, as stored", async ({ page }) => {
    const pageId = await createPage(page.request);
    await openStyle(page, pageId, HEADING, "Typography");

    const align = page.getByRole("radiogroup", { name: "Text align" });
    await align.getByRole("radio", { name: "Center" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(align.getByRole("radio", { name: "End" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await saveDraft(page);
    expect((await storedStyles(page.request, pageId, HEADING)).textAlign).toBe(
      "end"
    );
  });

  test("has no WCAG 2.2 AA violations with the icon groups showing", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openStyle(page, pageId, SECTION, "Layout");
    await expect(groupOf(page, "justifyContent")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(".nx-inspector")
      .withTags(AA_TAGS)
      .analyze();
    expect(results.passes.length).toBeGreaterThan(5);
    expect(
      results.violations.map(violation => ({
        id: violation.id,
        targets: violation.nodes.flatMap(node => node.target.map(String)),
      }))
    ).toEqual([]);
  });
});
