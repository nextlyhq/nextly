/**
 * A component's own view: a designer exposes a field of each of the six types,
 * finds them after a reload, and removes one through a dialog that names the
 * variant losing its value.
 *
 * Each test makes a component of its own through the admin API, so nothing
 * here reads or writes what another spec owns.
 *
 * @module tests/builder-component-fields
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { block, layerRow, openLayers, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const COMPONENTS = "/admin/api/collections/components/entries";

/** One block of each kind a field can drive. */
const NODES = [
  {
    id: "cf-heading",
    type: "core/heading",
    version: 1,
    props: { text: "A heading to expose", level: "h2" },
  },
  { id: "cf-body", type: "core/rich-text", version: 1, props: {} },
  {
    id: "cf-photo",
    type: "core/image",
    version: 1,
    props: { alt: "A photo" },
  },
  {
    id: "cf-link",
    type: "core/button",
    version: 1,
    props: { label: "A button", href: "/somewhere" },
  },
];

/** A component of its own, through the API; answers its id. */
async function createComponent(
  page: Page,
  envelope: Record<string, unknown> = {}
): Promise<string> {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await page.request.post(COMPONENTS, {
    data: {
      title: `Fields ${tag}`,
      slug: `fields-${tag}`,
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: NODES,
        ...envelope,
      },
    },
  });
  expect(created.ok(), `creating the component: ${created.status()}`).toBe(
    true
  );
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openComponent(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/components/${id}/builder`);
  await expect(await block(page, "cf-heading")).toBeVisible({
    timeout: 30_000,
  });
}

/** The expose control of one prop's row, in the inspector. */
function exposeRow(page: Page, prop: string): Locator {
  return page.locator(`[data-expose-prop="${prop}"]`);
}

/**
 * Select a block through Layers: an empty rich-text or image block draws with
 * no height on the canvas, and its row is the one place an author finds it.
 */
async function select(page: Page, id: string): Promise<void> {
  await layerRow(page, id).click();
}

/** Expose one prop of the selected block, and name the field. */
async function expose(page: Page, prop: string, name: string): Promise<void> {
  const row = exposeRow(page, prop);
  // The component mark beside the property, a button that stays pressed.
  const toggle = row.getByRole("button", { name: /^Let each page/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const field = row.getByRole("textbox");
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press("Enter");
  await expect(field).toHaveValue(name);
}

function fieldsList(page: Page): Locator {
  return page.getByRole("region", { name: "Fields" });
}

test.describe("a component's exposed fields", () => {
  test.describe.configure({ timeout: 180_000 });

  test("exposes one field of each of the six types, and finds them after a reload", async ({
    page,
  }) => {
    const id = await createComponent(page);
    await openComponent(page, id);
    await openLayers(page);

    await select(page, "cf-heading");
    await expose(page, "text", "Headline");
    await expose(page, "level", "Heading level");
    await page
      .getByRole("button", { name: "Let each page hide Heading" })
      .click();

    await select(page, "cf-body");
    await expose(page, "content", "Body");

    await select(page, "cf-photo");
    await expose(page, "mediaId", "Photo");

    await select(page, "cf-link");
    await expose(page, "href", "Call to action");

    const saved = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
        ["PATCH", "PUT"].includes(response.request().method()) &&
        response.ok()
    );
    // Saved without publishing, wherever the top bar keeps the save.
    await pressSave(page);
    await saved;

    await page.reload();
    await expect(await block(page, "cf-heading")).toBeVisible({
      timeout: 30_000,
    });
    // Nothing selected: the inspector describes the component itself.
    const list = fieldsList(page);
    await expect(list.getByRole("listitem")).toHaveCount(6);
    for (const [name, type] of [
      ["Headline", "Text"],
      ["Heading level", "Choice"],
      ["Show heading", "Visibility"],
      ["Body", "Rich text"],
      ["Photo", "Image"],
      ["Call to action", "Link"],
    ] as const) {
      const item = list.getByRole("listitem").filter({
        has: page.getByRole("textbox", { name: `Name of the field ${name}` }),
      });
      await expect(item).toHaveCount(1);
      // The type is the row's icon, named for a screen reader.
      await expect(item.getByRole("img", { name: type })).toBeVisible();
    }

    // And on a prop row: the heading's text shows the field it is exposed as.
    await openLayers(page);
    await select(page, "cf-heading");
    await expect(exposeRow(page, "text").getByRole("textbox")).toHaveValue(
      "Headline"
    );
  });

  test("asks before removing a field, naming the variant that loses its value", async ({
    page,
  }) => {
    const id = await createComponent(page, {
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "cf-heading",
          propPath: "text",
          type: "text",
        },
      ],
      variants: {
        night: { label: "Night", overrides: { headline: "Late edition" } },
      },
    });
    await openComponent(page, id);

    const list = fieldsList(page);
    await list
      .getByRole("button", { name: "Remove the field Headline" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Remove the field “Headline”?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "every use of it that set this field loses its value"
    );
    await expect(dialog).toContainText(
      "Night: loses its value, and with nothing left it shows the defaults"
    );

    // Cancelled, nothing changes.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);

    await list
      .getByRole("button", { name: "Remove the field Headline" })
      .click();
    await dialog.getByRole("button", { name: "Remove field" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(list.getByRole("listitem")).toHaveCount(0);
    await expect(list).toContainText("No fields yet");
  });

  test("never gives a new field the id of one a published removal retired", async ({
    page,
  }) => {
    const headline = {
      id: "headline",
      label: "Headline",
      nodeId: "cf-heading",
      propPath: "text",
      type: "text",
    };
    const id = await createComponent(page, { exposed: [headline] });
    const entry = `${COMPONENTS}/${id}`;
    // Published with the field, then published without it: the removal
    // retires `headline`, and placements may still hold values under it.
    for (const exposed of [[headline], []]) {
      const written = await page.request.patch(entry, {
        data: {
          status: "published",
          content: {
            formatVersion: 1,
            kind: "component",
            nodes: NODES,
            exposed,
          },
        },
      });
      expect(written.ok(), `publishing: ${written.status()}`).toBe(true);
    }

    await openComponent(page, id);
    await openLayers(page);
    await select(page, "cf-heading");
    await expose(page, "text", "Headline");
    const saved = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
        ["PATCH", "PUT"].includes(response.request().method()) &&
        response.ok()
    );
    await pressSave(page);
    await saved;

    const stored = await page.request.get(`${entry}?draft=true`);
    expect(stored.ok(), `reading the draft: ${stored.status()}`).toBe(true);
    // A read by id answers the entry itself; a wrapped answer is read through.
    type Stored = { content?: { exposed?: { id: string; label: string }[] } };
    const body = (await stored.json()) as Stored & { item?: Stored };
    const fields = (body.item ?? body).content?.exposed ?? [];
    expect(fields.map(field => field.label)).toEqual(["Headline"]);
    expect(fields[0]?.id).not.toBe("headline");
  });
});
