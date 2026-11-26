/**
 * Moves between a host and a field group it uses, in a real Builder: a field group used by two
 * collections and by a second field group, which a Single uses. In a collection's editor and in the
 * second field group's, a field moved into the field group and one moved out of it, by drag, by
 * Move to… and by the keys, is refused each time with a message naming the field group, both
 * collections, the second field group and the Single (through it), and nothing changes: the
 * draft stays as it was, with nothing to save.
 *
 * Everything is made at runtime through the calls the Schema Builder makes, since the
 * playground's own collections are code-first and open read-only.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  expectOk,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// Creating collections, field groups and a Single changes the schema and the dashboard's cards, as
// for the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/** Stored as a field the Builder made is stored, its flags written out. */
const plain = (
  name: string,
  label: string,
  more: Record<string, unknown> = {}
) => ({
  name,
  type: "text",
  label,
  required: false,
  unique: false,
  index: false,
  ...more,
});

/** A field placing the field group `slug`, as the Builder stores one. */
const placing = (slug: string) => ({
  ...plain("card", "Card"),
  type: "component",
  component: slug,
});

async function createFieldGroup(
  api: APIRequestContext,
  slug: string,
  label: string,
  fields: readonly Record<string, unknown>[]
): Promise<void> {
  await expectOk(
    await api.post(`${API}/field-groups`, { data: { slug, label, fields } }),
    `creating the field group ${slug}`
  );
}

async function createSingle(
  api: APIRequestContext,
  slug: string,
  fields: readonly Record<string, unknown>[]
): Promise<void> {
  await expectOk(
    await api.post(`${API}/singles`, {
      data: { slug, label: "Home", fields },
    }),
    `creating the Single ${slug}`
  );
}

/** Delete what a test made, unless it never got that far. */
async function remove(api: APIRequestContext, path: string): Promise<void> {
  const removed = await api.delete(`${API}/${path}`);
  if (removed.status() === 404) return;
  await expectOk(removed, `removing ${path}`);
}

const row = (page: Page, path: string) =>
  page.locator(`[role="treeitem"][data-path="${path}"]`);

/**
 * Drag a row by its handle onto another row, the pointer moved `levels` of indent sideways (20px
 * each) on the way, in small steps past the 8px it takes to start, as a person drags.
 */
async function drag(
  page: Page,
  from: string,
  onto: string,
  { levels = 0, drop = true } = {}
): Promise<void> {
  const handle = row(page, from).locator("xpath=preceding-sibling::span[1]");
  const start = await handle.boundingBox();
  const target = await row(page, onto).boundingBox();
  if (!start || !target) throw new Error("a row to drag is not drawn");
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(
    x + levels * 20 + (levels ? 6 : 0),
    target.y + target.height / 2,
    { steps: 16 }
  );
  if (drop) await page.mouse.up();
}

/** Open a row's menu by its key, as a keyboard does. */
async function openMenu(page: Page, path: string) {
  await row(page, path).focus();
  await page.keyboard.press("Shift+F10");
  return page.getByRole("menu");
}

/** Nothing changed: the draft holds nothing to save. */
async function nothingToSave(page: Page): Promise<void> {
  await expect(
    page.getByText("No unsaved changes", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save", exact: true })
  ).toBeDisabled();
}

test.describe("moves between a host and a field group it uses", () => {
  const stamp = Date.now();
  const fieldGroup = `fga_${stamp}`;
  const second = `fgb_${stamp}`;
  const c1 = `fgc1_${stamp}`;
  const c2 = `fgc2_${stamp}`;
  const single = `fgs_${stamp}`;

  /**
   * The refusal of moving `field`, in the server's words, naming every user of the field group:
   * as shown (`shown`), and as the outline announces it after a drop or a key (`announced`).
   */
  function refusalOf(field: string): { shown: RegExp; announced: RegExp } {
    const users = [
      `the collection ${c1}`,
      `the collection ${c2}`,
      `the field group ${second}`,
      `the Single ${single} \\(through ${second}\\)`,
    ];
    // Each of the four once, in whatever order the server lists them, and no fifth.
    const named = users.map(user => `(?=.*${user}[,.])`).join("");
    const sentence = `${field} cannot be moved into or out of the field group ${fieldGroup}: a field group is changed only in its own editor\\. ${named}It is used by (?:the [^,.]+(?:, |\\.)){4}`;
    return {
      shown: new RegExp(`^${sentence}$`),
      announced: new RegExp(`^${sentence} Nothing moved\\.$`),
    };
  }

  /** The outline's live region announces `text`. */
  const announces = (page: Page, text: RegExp) =>
    expect(page.locator('[aria-live="polite"]')).toHaveText(text);

  test.beforeEach(async ({ page }) => {
    await createFieldGroup(page.request, fieldGroup, "Card", [
      plain("headline", "Headline"),
    ]);
    // Each host places the field group first, its own field below it: the key that moves a field
    // into the container right above it reaches the field group.
    await createFieldGroup(page.request, second, "Frame", [
      placing(fieldGroup),
      plain("caption", "Caption"),
    ]);
    for (const slug of [c1, c2]) {
      await createRuntimeCollection(page.request, slug, [
        placing(fieldGroup),
        plain("notes", "Notes"),
      ]);
    }
    await createSingle(page.request, single, [
      { ...plain("frame", "Frame"), type: "component", component: second },
    ]);
  });

  // In afterEach, so it runs when a test fails too; the users first, so each field group is free
  // to go. The migration files these writes leave stay in the playground's ignored folder, as the
  // outline spec explains: the running server's ledger records them as applied.
  test.afterEach(async ({ page }) => {
    await remove(page.request, `singles/${single}`);
    await removeRuntimeCollection(page.request, c1);
    await removeRuntimeCollection(page.request, c2);
    await remove(page.request, `field-groups/${second}`);
    await remove(page.request, `field-groups/${fieldGroup}`);
  });

  const EDITORS = [
    {
      editor: "a collection's editor",
      path: () => `/builder/collections/${c1}`,
      host: "notes",
      hostLabel: "Notes",
    },
    {
      editor: "the second field group's editor",
      path: () => `/builder/field-groups/${second}`,
      host: "caption",
      hostLabel: "Caption",
    },
  ];

  for (const { editor, path, host, hostLabel } of EDITORS) {
    test(`in ${editor}, every way into the field group is refused, naming every user`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await gotoAdmin(page, path());
      await expect(row(page, "card/headline")).toBeVisible();
      const into = refusalOf(hostLabel);

      // By drag, a level to the right of the field placing the field group: into it.
      await drag(page, host, "card", { levels: 1, drop: false });
      await expect(page.getByText(into.shown)).toBeVisible();
      await page.mouse.up();
      await announces(page, into.announced);
      await nothingToSave(page);

      // By Move to…: the field group's place is offered disabled, with the reason.
      await (await openMenu(page, host))
        .getByRole("menuitem", { name: "Move to…" })
        .click();
      const dialog = page.getByRole("dialog");
      const place = dialog.getByRole("radio", { name: /^Card/ });
      await expect(place).toBeDisabled();
      await expect(place).toHaveAccessibleDescription(into.shown);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // By key: into the container right above it.
      await row(page, host).focus();
      await page.keyboard.press("Alt+ArrowRight");
      await announces(page, into.announced);
      await nothingToSave(page);
    });

    test(`in ${editor}, every way out of the field group is refused, naming every user`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await gotoAdmin(page, path());
      await expect(row(page, "card/headline")).toBeVisible();
      const out = refusalOf("Headline");

      // By drag, its handle offered so a person who tries learns why it stays.
      await drag(page, "card/headline", host, { drop: false });
      await expect(page.getByText(out.shown)).toBeVisible();
      await page.mouse.up();
      await announces(page, out.announced);
      await nothingToSave(page);

      // By Move to…: offered disabled, the reason its description.
      const menu = await openMenu(page, "card/headline");
      const moveTo = menu.getByRole("menuitem", { name: "Move to…" });
      await expect(moveTo).toBeDisabled();
      await expect(moveTo).toHaveAccessibleDescription(out.shown);
      await page.keyboard.press("Escape");

      // By key: up, and out of its container.
      for (const key of ["Alt+ArrowUp", "Alt+ArrowLeft"]) {
        await row(page, "card/headline").focus();
        await page.keyboard.press(key);
        await announces(page, out.announced);
      }
      await nothingToSave(page);
    });
  }
});
