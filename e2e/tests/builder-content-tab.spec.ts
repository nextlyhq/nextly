/**
 * The Content tab over every core block, in the real editor.
 *
 * For each block: every prop it declares has a control (none is drawn as
 * unsupported), every visible label names a field that is there, axe finds
 * nothing at WCAG 2.2 AA in the inspector, and one prop is edited, saved, read
 * back from the stored page and shown again after a reload. A block with no
 * props shows no controls at all.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The id every test selects; a parent, where the block needs one, is another. */
const TARGET = "00000000-0000-4000-8000-00000000c001";
const PARENT = "00000000-0000-4000-8000-00000000c002";

/** Padding and a floor, so even an empty block has a surface to click. */
const CLICKABLE = {
  base: {
    base: {
      minHeight: "48px",
      padding: {
        blockStart: "12px",
        blockEnd: "12px",
        inlineStart: "12px",
        inlineEnd: "12px",
      },
    },
  },
};

/** One prop to edit through its control, and what the page stores after. */
type Edit =
  | {
      kind: "type";
      label: string;
      prop: string;
      value: string;
      stored: unknown;
    }
  | { kind: "check"; label: string; prop: string; stored: boolean }
  | { kind: "richText"; label: string; prop: string; text: string };

interface Case {
  readonly type: string;
  readonly props: Record<string, unknown>;
  /** The block it must sit in, with that block's own props. */
  readonly parent?: { type: string; props: Record<string, unknown> };
  readonly slots?: boolean;
  /** Absent for a block that declares no props. */
  readonly edit?: Edit;
}

const RICH_TEXT = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "A passage.", format: 0 }],
      },
    ],
  },
};

const CONTAINED = (stored: boolean): Edit => ({
  kind: "check",
  label: "Contained",
  prop: "contained",
  stored,
});

/** Every core block, with the props it is stored with and one edit. */
const CASES: readonly Case[] = [
  {
    type: "core/section",
    props: { as: "section", contained: true },
    slots: true,
    edit: CONTAINED(false),
  },
  {
    type: "core/box",
    props: { as: "div" },
    slots: true,
    edit: CONTAINED(true),
  },
  {
    type: "core/columns",
    props: { as: "div" },
    slots: true,
    edit: CONTAINED(true),
  },
  {
    type: "core/column",
    props: { as: "div" },
    slots: true,
    parent: { type: "core/columns", props: { as: "div" } },
    edit: CONTAINED(true),
  },
  {
    type: "core/card",
    props: { as: "div" },
    slots: true,
    edit: CONTAINED(true),
  },
  {
    type: "core/accordion",
    props: { as: "div" },
    slots: true,
    edit: CONTAINED(true),
  },
  {
    type: "core/accordion-item",
    props: { title: "What is included?", open: false },
    slots: true,
    parent: { type: "core/accordion", props: { as: "div" } },
    edit: {
      kind: "type",
      label: "Title",
      prop: "title",
      value: "What ships?",
      stored: "What ships?",
    },
  },
  { type: "core/spacer", props: {} },
  {
    type: "core/heading",
    props: { text: "A section title", level: "h2" },
    edit: {
      kind: "type",
      label: "Text",
      prop: "text",
      value: "An edited title",
      stored: "An edited title",
    },
  },
  {
    type: "core/text",
    props: { text: "A paragraph of text." },
    edit: {
      kind: "type",
      label: "Text",
      prop: "text",
      value: "An edited paragraph.",
      stored: "An edited paragraph.",
    },
  },
  {
    type: "core/rich-text",
    props: { content: RICH_TEXT },
    edit: {
      kind: "richText",
      label: "Content",
      prop: "content",
      text: " More.",
    },
  },
  {
    type: "core/list",
    props: { kind: "unordered", items: ["First", "Second"] },
    edit: {
      kind: "type",
      label: "Start",
      prop: "start",
      value: "3",
      stored: 3,
    },
  },
  {
    type: "core/image",
    props: { src: "/example.jpg", alt: "An example image" },
    edit: {
      kind: "type",
      label: "Alt",
      prop: "alt",
      value: "An edited description",
      stored: "An edited description",
    },
  },
  {
    type: "core/button",
    props: { label: "Get started", href: "/signup" },
    edit: {
      kind: "type",
      label: "Label",
      prop: "label",
      value: "Start now",
      stored: "Start now",
    },
  },
  {
    type: "core/form",
    props: {
      method: "post",
      submitText: "Send",
      fields: [{ label: "Name", name: "name", type: "text", required: true }],
    },
    edit: {
      kind: "type",
      label: "Submit text",
      prop: "submitText",
      value: "Send it",
      stored: "Send it",
    },
  },
  {
    type: "core/gallery",
    props: { as: "div" },
    slots: true,
    edit: CONTAINED(true),
  },
  { type: "core/divider", props: {} },
  {
    type: "core/quote",
    props: {
      text: "Simplicity is the soul of efficiency.",
      attribution: "Austin Freeman",
    },
    edit: {
      kind: "type",
      label: "Attribution",
      prop: "attribution",
      value: "R. Austin Freeman",
      stored: "R. Austin Freeman",
    },
  },
  {
    type: "core/embed",
    props: { src: "https://example.com/player", title: "A product demo" },
    edit: {
      kind: "type",
      label: "Title",
      prop: "title",
      value: "An edited demo",
      stored: "An edited demo",
    },
  },
  {
    type: "core/collection-loop",
    props: { collection: "posts", limit: 3 },
    slots: true,
    edit: {
      kind: "type",
      label: "Limit",
      prop: "limit",
      value: "5",
      stored: 5,
    },
  },
];

/** The page a case edits: its block, inside its parent where it needs one. */
function documentFor(each: Case): unknown {
  const node = {
    id: TARGET,
    type: each.type,
    version: 1,
    props: each.props,
    styles: CLICKABLE,
    ...(each.slots === true ? { slots: { children: [] } } : {}),
  };
  const top =
    each.parent === undefined
      ? node
      : {
          id: PARENT,
          type: each.parent.type,
          version: 1,
          props: each.parent.props,
          slots: { children: [node] },
        };
  return { formatVersion: 1, kind: "page", nodes: [top] };
}

async function createPage(
  request: APIRequestContext,
  each: Case
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Content tab ${stamp}`,
      slug: `content-tab-${stamp}`,
      status: "draft",
      content: documentFor(each),
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a ${each.type} page failed: ${created.status()} ${await created.text()}`
    );
  }
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The selected block's stored props, read back through the API. */
async function storedProps(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const response = await request.get(`${ENTRIES}?status=draft&limit=100`);
  const body = (await response.json()) as {
    items: { id: string; content?: { nodes?: unknown[] } }[];
  };
  const nodes = body.items.find(item => item.id === id)?.content?.nodes ?? [];
  const find = (list: unknown[]): Record<string, unknown> | undefined => {
    for (const each of list as {
      id: string;
      props?: Record<string, unknown>;
      slots?: Record<string, unknown[]>;
    }[]) {
      if (each.id === TARGET) return each.props ?? {};
      const inner = find(Object.values(each.slots ?? {}).flat());
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return find(nodes) ?? {};
}

async function openAndSelect(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  // Near the corner: a container's centre holds its empty slot.
  await page
    .locator(`.nx-canvas [data-nx-node="${TARGET}"]`)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
}

async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await saved;
}

/**
 * Every visible label in the inspector names an element that is there and
 * visible, by `for` or by `aria-labelledby`. Answers what does not resolve.
 */
async function unresolvedLabels(page: Page): Promise<string[]> {
  return page.locator(".nx-inspector").evaluate(root => {
    const visible = (element: Element | null): boolean =>
      element instanceof HTMLElement && element.checkVisibility();
    const problems: string[] = [];
    for (const label of root.querySelectorAll("label[for]")) {
      if (!visible(label)) continue;
      const target = document.getElementById(label.getAttribute("for") ?? "");
      if (!visible(target)) problems.push(`label "${label.textContent}"`);
    }
    for (const field of root.querySelectorAll("[aria-labelledby]")) {
      if (!visible(field)) continue;
      for (const ref of (field.getAttribute("aria-labelledby") ?? "").split(
        " "
      )) {
        if (document.getElementById(ref) === null) {
          problems.push(`aria-labelledby "${ref}"`);
        }
      }
    }
    return problems;
  });
}

async function axe(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .include(".nx-inspector")
    .withTags(AA_TAGS)
    .analyze();
  // A scan that reached nothing passes exactly as a clean one does.
  expect(results.passes.length).toBeGreaterThan(3);
  return results.violations.map(violation => ({
    id: violation.id,
    targets: violation.nodes.flatMap(node => node.target.map(String)),
  }));
}

/** Make the case's edit through its control, committed by leaving the field. */
async function makeEdit(page: Page, edit: Edit): Promise<void> {
  const field = page
    .locator(".nx-inspector")
    .getByLabel(edit.label, { exact: true });
  if (edit.kind === "check") {
    await field.click();
    return;
  }
  if (edit.kind === "richText") {
    await field.click();
    await page.keyboard.press("End");
    await page.keyboard.type(edit.text);
    await field.blur();
    return;
  }
  await field.fill(edit.value);
  await field.blur();
}

/** What the reopened control shows for the edit, for the case's kind. */
async function expectShown(page: Page, edit: Edit): Promise<void> {
  const field = page
    .locator(".nx-inspector")
    .getByLabel(edit.label, { exact: true });
  if (edit.kind === "check") {
    await expect(field).toHaveAttribute(
      "data-state",
      edit.stored ? "checked" : "unchecked"
    );
  } else if (edit.kind === "richText") {
    await expect(field).toContainText(edit.text.trim());
  } else {
    await expect(field).toHaveValue(edit.value);
  }
}

test.describe("the Content tab over every core block", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const each of CASES) {
    test(`edits ${each.type}`, async ({ page, request }) => {
      const id = await createPage(request, each);
      await openAndSelect(page, id);

      const inspector = page.locator(".nx-inspector");
      await expect(inspector.locator("[data-unsupported]")).toHaveCount(0);
      expect(await unresolvedLabels(page)).toEqual([]);
      expect(await axe(page)).toEqual([]);

      const edit = each.edit;
      if (edit === undefined) {
        // A block that declares no props draws no content controls.
        await expect(inspector.locator("[data-content-control]")).toHaveCount(
          0
        );
        return;
      }
      // The positive control for the unsupported check above: controls drew.
      await expect(
        inspector.locator("[data-content-control]").first()
      ).toBeVisible();

      await makeEdit(page, edit);
      await saveDraft(page);
      const stored = await storedProps(request, id);
      if (edit.kind === "richText") {
        expect(JSON.stringify(stored[edit.prop])).toContain(edit.text.trim());
      } else {
        expect(stored[edit.prop]).toEqual(edit.stored);
      }

      // Opened afresh, so what shows is what was stored.
      await openAndSelect(page, id);
      await expectShown(page, edit);
    });
  }
});
