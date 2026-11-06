/**
 * A placed component's exposed fields, edited on the canvas and in the panel.
 *
 * Each case seeds its own component and page through the admin API, opens the
 * page in the builder, and checks what an author sees and what is stored: an
 * edit belongs to the one placement it was made on, never to the component or
 * to another placement of it.
 *
 * @module tests/builder-placement-fields.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasRoot, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const COMPONENT_TITLE = "Placement header";

/**
 * A header exposing its headline (text), its level (a choice), its button's
 * link and whether the button is shown. The paragraph is not exposed: it is
 * the component's own text.
 */
function headerDefinition() {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      {
        id: "headline",
        type: "core/heading",
        version: 1,
        props: { text: "Site name", level: "h2" },
      },
      {
        id: "strap",
        type: "core/text",
        version: 1,
        props: { text: "Made with care" },
      },
      {
        id: "cta",
        type: "core/button",
        version: 1,
        props: { label: "Get started", href: "/signup" },
      },
    ],
    exposed: [
      {
        id: "headline",
        label: "Headline",
        nodeId: "headline",
        propPath: "text",
        type: "text",
      },
      {
        id: "level",
        label: "Heading level",
        nodeId: "headline",
        propPath: "level",
        type: "select",
        options: [
          { value: "h2", label: "H2" },
          { value: "h3", label: "H3" },
        ],
      },
      {
        id: "ctaLink",
        label: "Button link",
        nodeId: "cta",
        propPath: "href",
        type: "link",
      },
      {
        id: "ctaShown",
        label: "Button shown",
        nodeId: "cta",
        propPath: "visibility",
        type: "visibility",
      },
    ],
  };
}

/** A passage, as the rich-text editor stores one. */
function passage(text: string) {
  return {
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
      ],
    },
  };
}

/** The header with a rich-text intro under its headline, the intro exposed. */
function introDefinition() {
  const header = headerDefinition();
  return {
    ...header,
    nodes: [
      header.nodes[0],
      {
        id: "intro",
        type: "core/rich-text",
        version: 1,
        props: { content: passage("The component's intro.") },
      },
    ],
    exposed: [
      header.exposed[0],
      {
        id: "intro",
        label: "Intro",
        nodeId: "intro",
        propPath: "content",
        type: "richText",
      },
    ],
  };
}

/** A stored passage's words, its text nodes joined in order. */
function textOf(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const node = value as { text?: unknown; root?: unknown; children?: unknown };
  if (typeof node.text === "string") return node.text;
  const children = Array.isArray(node.children) ? node.children : [];
  return [node.root, ...children].map(textOf).join("");
}

function placement(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId: "" },
    ...extra,
  };
}

/** Seed a published header and a page placing it; returns the page's id. */
async function seed(
  page: Page,
  placements: readonly ReturnType<typeof placement>[],
  definition: unknown = headerDefinition()
): Promise<{ pageId: string; componentId: string }> {
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const component = await page.request.post(COMPONENTS, {
    data: {
      title: COMPONENT_TITLE,
      slug: `placement-header-${tag}`,
      content: definition,
      status: "published",
    },
  });
  expect(component.ok(), `seeding the component: ${component.status()}`).toBe(
    true
  );
  const componentId = ((await component.json()) as { item: { id: string } })
    .item.id;
  const nodes = placements.map(entry => ({
    ...entry,
    props: { ...entry.props, componentId },
  }));
  const created = await page.request.post(PAGES, {
    data: {
      title: "Placement fields",
      slug: `placement-fields-${tag}`,
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  const pageId = ((await created.json()) as { item: { id: string } }).item.id;
  return { pageId, componentId };
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(await part(page, "p1", "text")).toBeVisible({ timeout: 30_000 });
}

/**
 * The element of a placement that renders `prop`, on the canvas. A
 * component's nodes each carry the placement's id; the heading marks its text
 * on its own root.
 */
async function part(page: Page, placementId: string, prop: string) {
  const root = await canvasRoot(page);
  return root
    .locator(
      `[data-nx-instance="${placementId}"][data-nx-prop="${prop}"], [data-nx-instance="${placementId}"] [data-nx-prop="${prop}"]`
    )
    .first();
}

/** The heading a placement draws: its text, read from the canvas. */
async function headline(page: Page, placementId: string): Promise<Locator> {
  return part(page, placementId, "text");
}

/** Select a placement by clicking its heading, and wait for its panel. */
async function selectPlacement(page: Page, placementId: string) {
  await (await headline(page, placementId)).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(COMPONENT_TITLE) })
  ).toBeVisible();
}

/** One exposed row of the panel, by its label. */
function row(page: Page, label: string): Locator {
  return page
    .locator(".nx-inspector__field--exposed")
    .filter({ has: page.getByText(label, { exact: true }) });
}

async function save(page: Page, pageId: string): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${pageId}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

/** The page's placements as stored, by id. */
async function storedPlacements(
  page: Page,
  pageId: string
): Promise<Record<string, { props: Record<string, unknown> }>> {
  // Every status: the page is a draft, which a plain read leaves out.
  const read = await page.request.get(`${PAGES}/${pageId}?status=all`);
  expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as { nodes: { id: string; props: Record<string, unknown> }[] };
  return Object.fromEntries(content.nodes.map(node => [node.id, node]));
}

test.describe("a placement's exposed fields", () => {
  test.describe.configure({ timeout: 180_000 });

  test("exposed text is edited on the canvas and stored on that placement only", async ({
    page,
  }) => {
    const { pageId, componentId } = await seed(page, [
      placement("p1"),
      placement("p2"),
    ]);
    await openBuilder(page, pageId);

    const first = await headline(page, "p1");
    await first.dblclick();
    await expect(first).toHaveAttribute("contenteditable", /.+/);
    await page.keyboard.type("Acme launch");
    await page.keyboard.press("Enter");

    await expect(await headline(page, "p1")).toHaveText("Acme launch");
    await expect(await headline(page, "p2")).toHaveText("Site name");

    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    expect(stored.p1?.props.overrides).toEqual({ headline: "Acme launch" });
    expect(stored.p2?.props.overrides).toBeUndefined();

    // The component itself is untouched.
    const component = await page.request.get(
      `${COMPONENTS}/${componentId}?status=all`
    );
    expect(component.ok()).toBe(true);
    const definition = JSON.stringify(await component.json());
    expect(definition).toContain("Site name");
    expect(definition).not.toContain("Acme launch");

    await page.reload();
    await expect(await headline(page, "p1")).toHaveText("Acme launch", {
      timeout: 30_000,
    });
  });

  test("a double-click on text the component does not expose selects the placement and says whose it is", async ({
    page,
  }) => {
    const { pageId } = await seed(page, [placement("p1")]);
    await openBuilder(page, pageId);

    await (await part(page, "p1", "text")).waitFor();
    const strap = (await canvasRoot(page))
      .locator('[data-nx-instance="p1"]')
      .filter({ hasText: "Made with care" })
      .last();
    await strap.dblclick();

    await expect(page.getByText(/^Part of Placement header\./)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: new RegExp(COMPONENT_TITLE) })
    ).toBeVisible();
    await expect(strap).not.toHaveAttribute("contenteditable", /.+/);
  });

  test("each field is edited in the panel, saved, and still there after a reload", async ({
    page,
  }) => {
    const { pageId } = await seed(page, [placement("p1")]);
    await openBuilder(page, pageId);
    await selectPlacement(page, "p1");
    // The exposed parts of the selected placement wear their own outline; the
    // component's own text does not.
    await expect(await headline(page, "p1")).toHaveAttribute(
      "data-nx-exposed",
      ""
    );
    // The placement is ONE frame around its parts, tagged with its name, and
    // the heading, a selected part as well as an exposed one, keeps its dash
    // inside it. The marks are drawn over the canvas frame.
    await expect(await headline(page, "p1")).toHaveAttribute(
      "data-nx-selected",
      /.*/
    );
    const frame = page.locator('.nx-canvas-mark[data-mark="selected"]');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("data-component", "");
    await expect(frame).toHaveAttribute(
      "data-placement-label",
      `◇ ${COMPONENT_TITLE}`
    );
    // One dash for each exposed part, the selected heading's included.
    const exposedParts = await (await canvasRoot(page))
      .locator("[data-nx-exposed]")
      .count();
    expect(exposedParts).toBeGreaterThan(0);
    await expect(
      page.locator('.nx-canvas-mark[data-mark="exposed"]')
    ).toHaveCount(exposedParts);
    await expect(
      (await canvasRoot(page))
        .locator('[data-nx-instance="p1"]')
        .filter({ hasText: "Made with care" })
        .last()
    ).not.toHaveAttribute("data-nx-exposed", /.*/);

    const headlineField = page.getByRole("textbox", { name: "Headline" });
    await headlineField.fill("From the panel");
    await headlineField.press("Enter");
    await expect(await headline(page, "p1")).toHaveText("From the panel");

    await page.getByRole("combobox", { name: "Heading level" }).click();
    await page.getByRole("option", { name: "H3" }).click();

    const link = page.getByRole("textbox", { name: "Button link" });
    await link.fill("javascript:alert(1)");
    await link.press("Enter");
    const refusal = page.locator(".nx-inspector__problem");
    await expect(refusal).toContainText("Button link needs a link");
    await link.fill("/pricing");
    await link.press("Enter");
    await expect(refusal).toHaveCount(0);

    await page.getByRole("switch", { name: "Button shown" }).click();

    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    expect(stored.p1?.props.overrides).toEqual({
      headline: "From the panel",
      level: "h3",
      ctaLink: "/pricing",
      ctaShown: false,
    });

    await page.reload();
    await expect(await headline(page, "p1")).toHaveText("From the panel", {
      timeout: 30_000,
    });
    await selectPlacement(page, "p1");
    await expect(page.getByRole("textbox", { name: "Headline" })).toHaveValue(
      "From the panel"
    );
    await expect(
      page.getByRole("textbox", { name: "Button link" })
    ).toHaveValue("/pricing");
    await expect(
      page.getByRole("switch", { name: "Button shown" })
    ).not.toBeChecked();
    await expect(row(page, "Heading level")).toContainText("H3");
  });

  test("an exposed passage is edited on the canvas, held in the panel meanwhile, on that placement only", async ({
    page,
  }) => {
    const { pageId } = await seed(
      page,
      [placement("p1"), placement("p2")],
      introDefinition()
    );
    await openBuilder(page, pageId);

    const passageOnCanvas = await part(page, "p1", "content");
    await passageOnCanvas.dblclick();
    // Editable once the shared editor has attached to the canvas's element.
    await expect(passageOnCanvas).toHaveAttribute("contenteditable", "true");
    // The placement's panel holds the same passage while the canvas has it.
    const held = page.locator('.nx-inspector p[data-held="canvas"]');
    await expect(held).toBeVisible();

    for (let line = 0; line < 12; line += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("End");
    await page.keyboard.type(" Ours.");
    await page.keyboard.press("Escape");

    await expect(await part(page, "p1", "content")).toContainText(
      "The component's intro. Ours."
    );
    await expect(await part(page, "p2", "content")).toHaveText(
      "The component's intro."
    );
    await expect(held).toHaveCount(0);
    await expect(row(page, "Intro")).toContainText("Set on this page");

    // One step: a single undo takes the whole edit back, and redo restores it.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(await part(page, "p1", "content")).toHaveText(
      "The component's intro."
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(await part(page, "p1", "content")).toContainText("Ours.");

    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    const overrides = stored.p1?.props.overrides as
      | Record<string, unknown>
      | undefined;
    expect(textOf(overrides?.intro)).toBe("The component's intro. Ours.");
    expect(stored.p2?.props.overrides).toBeUndefined();

    await page.reload();
    await expect(await part(page, "p1", "content")).toContainText("Ours.", {
      timeout: 30_000,
    });
  });

  test("an exposed passage is edited in the panel with the rich-text editor, on that placement only", async ({
    page,
  }) => {
    const { pageId } = await seed(
      page,
      [placement("p1"), placement("p2")],
      introDefinition()
    );
    await openBuilder(page, pageId);
    await selectPlacement(page, "p1");

    const intro = page
      .locator(".nx-inspector")
      .getByRole("textbox", { name: "Intro" });
    await expect(intro).toContainText("The component's intro.");
    await intro.click();
    // Editable once the shared editor has attached to it.
    await expect(intro).toHaveAttribute("contenteditable", "true");
    // The passage's end, not its first line's: the panel's field wraps, and
    // no one key reaches a passage's end on every platform.
    for (let line = 0; line < 12; line += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("End");
    await page.keyboard.type(" Ours.");
    await intro.blur();

    // Drawn on the canvas for this placement, and only this one.
    await expect(await part(page, "p1", "content")).toContainText(
      "The component's intro. Ours."
    );
    await expect(await part(page, "p2", "content")).toHaveText(
      "The component's intro."
    );
    await expect(row(page, "Intro")).toContainText("Set on this page");

    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    const overrides = stored.p1?.props.overrides as
      | Record<string, unknown>
      | undefined;
    expect(textOf(overrides?.intro)).toBe("The component's intro. Ours.");
    expect(stored.p2?.props.overrides).toBeUndefined();

    await page.reload();
    await expect(await part(page, "p1", "content")).toContainText("Ours.", {
      timeout: 30_000,
    });
    await selectPlacement(page, "p1");
    await expect(
      page.locator(".nx-inspector").getByRole("textbox", { name: "Intro" })
    ).toContainText("The component's intro. Ours.");
  });

  test("clearing and resetting are different: Cleared shows nothing, Reset brings back the inherited value", async ({
    page,
  }) => {
    const { pageId } = await seed(page, [
      placement("p1", {
        props: { componentId: "", overrides: { headline: "Mine" } },
      }),
    ]);
    await openBuilder(page, pageId);
    await selectPlacement(page, "p1");
    const badge = row(page, "Headline").locator(".nx-inspector__source");
    await expect(badge).toHaveText("Set on this page");

    const field = page.getByRole("textbox", { name: "Headline" });
    await field.fill("");
    await field.press("Enter");
    await expect(badge).toHaveText("Cleared on this page");
    // Cleared draws no headline at all: neither the old value nor the
    // component's own.
    const placed = (await canvasRoot(page)).locator('[data-nx-instance="p1"]');
    await expect(placed.filter({ hasText: "Site name" })).toHaveCount(0);
    await expect(placed.filter({ hasText: "Mine" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reset Headline" }).click();
    await expect(badge).toHaveText("From the component");
    await expect(await headline(page, "p1")).toHaveText("Site name");
    await expect(field).toHaveValue("Site name");

    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    expect(stored.p1?.props.overrides).toBeUndefined();
  });

  test("a placement locked in Layers shows its fields read-only, and the canvas does not edit them", async ({
    page,
  }) => {
    const { pageId } = await seed(page, [placement("p1", { locked: true })]);
    await openBuilder(page, pageId);
    await selectPlacement(page, "p1");

    // Said once, by the card's lock line, which the held fields point at.
    const headlineField = page.getByRole("textbox", { name: "Headline" });
    await expect(headlineField).toBeDisabled();
    await expect(
      page.locator("fieldset[disabled]").first()
    ).toHaveAccessibleDescription(/^Locked: it can.t be moved/);
    await expect(
      page.getByRole("textbox", { name: "Button link" })
    ).toBeDisabled();
    await expect(
      page.getByRole("switch", { name: "Button shown" })
    ).toBeDisabled();

    const text = await headline(page, "p1");
    await text.dblclick();
    await expect(text).not.toHaveAttribute("contenteditable", /.+/);
  });
});
