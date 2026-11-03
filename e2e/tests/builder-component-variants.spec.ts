/**
 * A component's variants, end to end: a designer defines and names one in the
 * component's own view, a placement picks it and overrides a field, a rename
 * keeps the placement on it, and a delete warns with the count and leaves the
 * placement on the defaults with its own value.
 *
 * Each test seeds its own component and page through the admin API, so
 * nothing here reads or writes what another spec owns.
 *
 * @module tests/builder-component-variants
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { block, canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const COMPONENT_TITLE = "Variant card";

/** A heading whose text and level placements and variants may set. */
function cardDefinition(variants?: Record<string, unknown>) {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      {
        id: "card-heading",
        type: "core/heading",
        version: 1,
        props: { text: "Plain card", level: "h2" },
      },
    ],
    exposed: [
      {
        id: "headline",
        label: "Headline",
        nodeId: "card-heading",
        propPath: "text",
        type: "text",
      },
      {
        id: "level",
        label: "Heading level",
        nodeId: "card-heading",
        propPath: "level",
        type: "select",
        options: [
          { value: "h2", label: "H2" },
          { value: "h3", label: "H3" },
        ],
      },
    ],
    ...(variants === undefined ? {} : { variants }),
  };
}

function tag(): string {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/** A published component of its own; answers its id. */
async function createComponent(
  page: Page,
  variants?: Record<string, unknown>
): Promise<string> {
  const created = await page.request.post(COMPONENTS, {
    data: {
      title: COMPONENT_TITLE,
      slug: `variant-card-${tag()}`,
      content: cardDefinition(variants),
      status: "published",
    },
  });
  expect(created.ok(), `creating the component: ${created.status()}`).toBe(
    true
  );
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** A page placing the component under each id given, with its props. */
async function createPage(
  page: Page,
  componentId: string,
  placements: Record<string, Record<string, unknown>>
): Promise<string> {
  const nodes = Object.entries(placements).map(([id, props]) => ({
    id,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId, ...props },
  }));
  const created = await page.request.post(PAGES, {
    data: {
      title: "Variant placements",
      slug: `variant-placements-${tag()}`,
      content: { formatVersion: 1, kind: "page", nodes },
      status: "published",
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openComponent(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/components/${id}/builder`);
  await expect(await block(page, "card-heading")).toBeVisible({
    timeout: 30_000,
  });
}

async function openPage(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(await headline(page, "p1")).toBeVisible({ timeout: 30_000 });
}

/** The heading a placement draws, on the canvas. */
async function headline(page: Page, placementId: string): Promise<Locator> {
  const root = await canvasRoot(page);
  return root
    .locator(
      `[data-nx-instance="${placementId}"][data-nx-prop="text"], [data-nx-instance="${placementId}"] [data-nx-prop="text"]`
    )
    .first();
}

async function selectPlacement(page: Page, placementId: string) {
  await (await headline(page, placementId)).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(COMPONENT_TITLE) })
  ).toBeVisible();
}

function variants(page: Page): Locator {
  return page.getByRole("region", { name: "Variants" });
}

/** One variant's row in the component's view, by its current name. */
function variantRow(page: Page, name: string): Locator {
  return variants(page)
    .getByRole("listitem")
    .filter({
      has: page.getByRole("textbox", { name: `Name of the variant ${name}` }),
    });
}

/** Save the document open in the builder, waiting for the write to land. */
async function save(page: Page, id: string): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
  // "Save draft" on a document never published, "Save" on one that is.
  await page.getByRole("button", { name: /^Save( draft)?$/ }).click();
  await saved;
}

/** The component's variants as stored. */
async function storedVariants(
  page: Page,
  id: string
): Promise<
  Record<string, { label: string; overrides: Record<string, unknown> }>
> {
  const read = await page.request.get(`${COMPONENTS}/${id}?draft=true`);
  expect(read.ok(), `reading the component: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as {
    variants?: Record<
      string,
      { label: string; overrides: Record<string, unknown> }
    >;
  };
  return content.variants ?? {};
}

/** The page's placements as stored, by id. */
async function storedPlacements(
  page: Page,
  pageId: string
): Promise<Record<string, { props: Record<string, unknown> }>> {
  const read = await page.request.get(`${PAGES}/${pageId}?draft=true`);
  expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as { nodes: { id: string; props: Record<string, unknown> }[] };
  return Object.fromEntries(content.nodes.map(node => [node.id, node]));
}

test.describe("a component's variants", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a designer defines a variant, names it and gives it a value, kept after a reload", async ({
    page,
  }) => {
    const id = await createComponent(page);
    await openComponent(page, id);

    const section = variants(page);
    await expect(section).toContainText("No variants yet");
    await section.getByRole("button", { name: "Add variant" }).click();

    // The new variant opens with its name selected, so typing renames it.
    const name = section.getByRole("textbox", {
      name: "Name of the variant Variant 1",
    });
    await expect(name).toBeFocused();
    await expect(variantRow(page, "Variant 1")).toContainText("No changes yet");
    await page.keyboard.type("Featured");
    await page.keyboard.press("Enter");
    const row = variantRow(page, "Featured");
    await expect(row).toHaveCount(1);

    const value = row.getByRole("textbox", { name: "Headline" });
    await expect(value).toHaveValue("Plain card");
    await value.fill("Big news");
    await value.press("Enter");
    await expect(row).toContainText("1 change");
    await expect(
      row.getByRole("img", { name: "Set by this variant" })
    ).toBeVisible();
    // The canvas previews the open variant, and a tag over it says so.
    await expect(await block(page, "card-heading")).toContainText("Big news");
    await expect(
      page.getByRole("status").filter({ hasText: "Previewing Featured" })
    ).toBeVisible();
    // Closed, the canvas draws the component's own value again.
    await row
      .getByRole("button", { name: "Hide the values of Featured" })
      .click();
    await expect(await block(page, "card-heading")).toContainText("Plain card");
    await expect(
      page.getByRole("status").filter({ hasText: "Previewing" })
    ).toHaveCount(0);

    // A second variant may not take the same name, whatever its case.
    await section.getByRole("button", { name: "Add variant" }).click();
    const second = section.getByRole("textbox", {
      name: "Name of the variant Variant 2",
    });
    await second.fill(" featured ");
    await second.press("Enter");
    await expect(section.getByRole("alert")).toContainText(
      "There is already a variant called “Featured”"
    );
    await expect(second).toHaveValue("Variant 2");

    await save(page, id);
    const stored = await storedVariants(page, id);
    const [key] = Object.entries(stored).find(
      ([, variant]) => variant.label === "Featured"
    ) ?? [undefined];
    expect(key).toMatch(/^v-[0-9a-f]{12}$/);
    expect(stored[key as string]?.overrides).toEqual({ headline: "Big news" });

    await page.reload();
    await expect(await block(page, "card-heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(variantRow(page, "Featured")).toContainText("1 change");
    await expect(variantRow(page, "Variant 2")).toContainText("No changes yet");
  });

  test("a placement picks a variant, overrides a field, and keeps it through a rename", async ({
    page,
  }) => {
    const componentId = await createComponent(page, {
      featured: { label: "Featured", overrides: { headline: "Big news" } },
      quiet: { label: "Quiet", overrides: {} },
    });
    const pageId = await createPage(page, componentId, { p1: {}, p2: {} });
    await openPage(page, pageId);
    await selectPlacement(page, "p1");

    const picker = page.getByRole("combobox", { name: "Variant" });
    await expect(picker).toHaveText("Default");
    await picker.click();
    await expect(
      page.getByRole("option", { name: "Quiet (no changes)" })
    ).toBeVisible();
    await page.getByRole("option", { name: "Featured" }).click();
    await expect(await headline(page, "p1")).toHaveText("Big news");
    await expect(await headline(page, "p2")).toHaveText("Plain card");

    // Its own value over the variant's, on this placement only.
    await page.getByRole("combobox", { name: "Heading level" }).click();
    await page.getByRole("option", { name: "H3" }).click();
    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    expect(stored.p1?.props).toMatchObject({
      variant: "featured",
      overrides: { level: "h3" },
    });
    expect(stored.p2?.props.variant).toBeUndefined();

    // Renamed in the component's view, the placement still uses it.
    await openComponent(page, componentId);
    const name = page.getByRole("textbox", {
      name: "Name of the variant Featured",
    });
    await name.fill("Spotlight");
    await name.press("Enter");
    await save(page, componentId);

    await openPage(page, pageId);
    await expect(await headline(page, "p1")).toHaveText("Big news");
    await selectPlacement(page, "p1");
    await expect(page.getByRole("combobox", { name: "Variant" })).toHaveText(
      "Spotlight"
    );
  });

  test("deleting a used variant warns with the count, and its placement falls back keeping its own value", async ({
    page,
  }) => {
    const componentId = await createComponent(page, {
      featured: {
        label: "Featured",
        overrides: { headline: "Big news", level: "h3" },
      },
    });
    const pageId = await createPage(page, componentId, {
      p1: { variant: "featured", overrides: { level: "h2" } },
    });
    await openComponent(page, componentId);

    await variantRow(page, "Featured")
      .getByRole("button", { name: "Delete the variant Featured" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Delete the variant “Featured”?",
    });
    await expect(dialog).toContainText(
      /Used (at least )?1 time in (at least )?1 document\./
    );
    await expect(dialog).toContainText("keep its own changes");
    await dialog.getByRole("button", { name: "Delete variant" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(variants(page)).toContainText("No variants yet");
    await save(page, componentId);
    expect(await storedVariants(page, componentId)).toEqual({});

    await openPage(page, pageId);
    await expect(await headline(page, "p1")).toHaveText("Plain card");
    await selectPlacement(page, "p1");
    const notice = page.getByRole("status").filter({
      hasText: "Variant removed, showing defaults",
    });
    await expect(notice).toBeVisible();
    // Its own value is still in force.
    await expect(
      page.getByRole("combobox", { name: "Heading level" })
    ).toHaveText("H2");

    await notice
      .getByRole("button", { name: "Clear the removed variant" })
      .click();
    await expect(notice).toHaveCount(0);
    // The component has no variants left, so there is nothing to pick.
    await expect(page.getByRole("combobox", { name: "Variant" })).toHaveCount(
      0
    );
    await save(page, pageId);
    const stored = await storedPlacements(page, pageId);
    expect(stored.p1?.props.variant).toBeUndefined();
    expect(stored.p1?.props.overrides).toEqual({ level: "h2" });
  });
});
