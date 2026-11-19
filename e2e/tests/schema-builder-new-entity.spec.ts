/**
 * Creating a collection in the Schema Builder makes it a pending change: the
 * dialog's Create opens its editor with nothing written, and the first save
 * creates it. Leaving before that save asks first, and discarding leaves
 * nothing behind.
 *
 * Checked through the server's own answer for the collection, so "nothing
 * written" means the server has no such collection, not that the page says so.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { removeRuntimeCollection } from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for
// the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/**
 * Whether the server holds what `path` names: a 404 is absent, a success is present, and any
 * other answer fails the test rather than reading as absent.
 */
async function serverHolds(
  api: APIRequestContext,
  path: string
): Promise<boolean> {
  const answer = await api.get(path);
  if (answer.status() === 404) return false;
  expect(answer.ok(), `${path}: ${answer.status()}`).toBe(true);
  return true;
}

/** Whether the server holds a collection under `slug`. */
async function serverHas(
  api: APIRequestContext,
  slug: string
): Promise<boolean> {
  return serverHolds(api, `/admin/api/collections/${slug}`);
}

/**
 * Creates a collection in the dialog under `slug`, and waits for its editor.
 * The address is typed rather than derived, so the test owns it. `inApp` opens
 * the dialog as the admin's own links do, keeping this tab's unsaved entities,
 * which a page load would start without.
 */
async function createInDialog(
  page: Page,
  slug: string,
  { inApp = false }: { inApp?: boolean } = {}
): Promise<void> {
  if (inApp) {
    await page.evaluate(
      path => window.history.pushState(null, "", path),
      "/admin/builder/collections/new"
    );
  } else {
    await gotoAdmin(page, "/builder/collections/new");
  }
  const dialog = page.getByRole("dialog", { name: "New collection" });
  await dialog.getByLabel("Name", { exact: true }).fill("Pending product");
  const address = dialog.getByLabel("API address");
  await address.fill(slug);
  const create = dialog.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeEnabled({ timeout: 15_000 });
  await create.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/builder/collections/${slug}$`)
  );
  await expect(page.getByText("1 unsaved change")).toBeVisible({
    timeout: 30_000,
  });
}

test("creates, finds the pending changes, saves", async ({ page }) => {
  const slug = `new_entity_${Date.now()}`;
  const api = page.context().request;
  try {
    await createInDialog(page, slug);
    // Created in the editor only: the server has no such collection yet.
    expect(await serverHas(api, slug)).toBe(false);

    await page.getByRole("button", { name: "Add field", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search field types" });
    await expect(search).toBeFocused();
    await search.fill("text");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Label" }).fill("Subtitle");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add field", exact: true })
      .click();
    await page.getByRole("button", { name: "Close field settings" }).click();
    await expect(page.getByText("2 unsaved changes")).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await expect(
      review.getByRole("heading", { name: `Create the collection ${slug}?` })
    ).toBeVisible();
    await expect(review).toContainText("subtitle");
    await review.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText("No unsaved changes")).toBeVisible({
      timeout: 60_000,
    });
    const saved = await api.get(`/admin/api/collections/schema/${slug}`);
    expect(saved.ok()).toBe(true);
    const { fields } = (await saved.json()) as {
      fields: Array<{ name: string }>;
    };
    expect(fields.map(field => field.name)).toContain("subtitle");
  } finally {
    await removeRuntimeCollection(api, slug);
  }
});

test("leaving an unsaved new collection asks first, and leaves nothing behind", async ({
  page,
}) => {
  const slug = `new_entity_leave_${Date.now()}`;
  const api = page.context().request;
  try {
    await createInDialog(page, slug);
    // An in-app move, as the admin's own links make.
    await page.evaluate(
      path => window.history.pushState(null, "", path),
      "/admin/builder/collections"
    );
    const guard = page.getByRole("alertdialog", { name: "Unsaved Changes" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(/\/admin\/builder\/collections$/);

    expect(await serverHas(api, slug)).toBe(false);
  } finally {
    await removeRuntimeCollection(api, slug);
  }
});

test("creates, saves, and finds the address fixed", async ({ page }) => {
  const slug = `new_entity_fixed_${Date.now()}`;
  const api = page.context().request;
  try {
    await createInDialog(page, slug);
    // Before the first save the address can still change.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let settings = page.getByRole("dialog");
    await expect(settings.getByLabel("Slug")).toBeEditable();
    await settings.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await review.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("No unsaved changes")).toBeVisible({
      timeout: 60_000,
    });
    expect(await serverHas(api, slug)).toBe(true);

    // Saved, the address is fixed, saying what changing it would break.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    settings = page.getByRole("dialog");
    const address = settings.getByLabel("Slug");
    await expect(address).toHaveValue(slug);
    await expect(address).not.toBeEditable();
    await expect(address).toHaveAccessibleDescription(
      "Fixed once saved: its API routes, and every client that calls them, use this address."
    );
  } finally {
    await removeRuntimeCollection(api, slug);
  }
});

// ---------------------------------------------------------------------------
// A field group made from the field picker: held unsaved for the entity being
// edited, created by its save before it, let go by its Discard all, and kept as
// a field group of its own when the entity is left.
// ---------------------------------------------------------------------------

/**
 * Marks this tab, so a later `expectSameTab` proves no page load came between:
 * the unsaved entities live in the tab, and a load would empty them, passing
 * any check that one is gone for the wrong reason.
 */
async function markTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { nextlyTabMark?: boolean }).nextlyTabMark = true;
  });
}

async function expectSameTab(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => (window as unknown as { nextlyTabMark?: boolean }).nextlyTabMark
    )
  ).toBe(true);
}

/** Whether the server holds a field group under `slug`. */
async function serverHasFieldGroup(
  api: APIRequestContext,
  slug: string
): Promise<boolean> {
  return serverHolds(api, `/admin/api/field-groups/${slug}`);
}

/** Deletes a field group a test made, unless it never got that far. */
async function removeFieldGroup(
  api: APIRequestContext,
  slug: string
): Promise<void> {
  const removed = await api.delete(`/admin/api/field-groups/${slug}`);
  if (removed.status() === 404) return;
  expect(removed.ok(), await removed.text()).toBe(true);
}

/** Opens the field picker's field-group chooser in the editor. */
async function openFieldGroupChooser(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search field types" });
  await search.fill("field group");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Search field groups" })
  ).toBeVisible();
}

/**
 * Makes a field group from the picker under `slug`, named `name`, and adds the
 * field that embeds it.
 */
async function newFieldGroupFromPicker(
  page: Page,
  slug: string,
  name: string
): Promise<void> {
  await openFieldGroupChooser(page);
  await page.getByRole("button", { name: "New field group" }).click();
  const dialog = page.getByRole("dialog", { name: "New field group" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("API address").fill(slug);
  const create = dialog.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeEnabled({ timeout: 15_000 });
  await create.click();
  await expect(page.getByRole("textbox", { name: "Label" })).toHaveValue(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add field", exact: true })
    .click();
  await page.getByRole("button", { name: "Close field settings" }).click();
}

test("creates a field group from the picker, saves the host, and finds both", async ({
  page,
}) => {
  const stamp = Date.now();
  const host = `fg_host_${stamp}`;
  const group = `fg_hero_${stamp}`;
  const api = page.context().request;
  try {
    await createInDialog(page, host);
    await newFieldGroupFromPicker(page, group, "Hero");
    // Made in the editor only: the server has no such field group yet.
    expect(await serverHasFieldGroup(api, group)).toBe(false);

    // A second one under the same address is refused in the dialog.
    await openFieldGroupChooser(page);
    await expect(
      page.getByRole("option", {
        name: new RegExp(`${group}\\) · not saved yet`),
      })
    ).toBeVisible();
    await page.getByRole("button", { name: "New field group" }).click();
    const again = page.getByRole("dialog", { name: "New field group" });
    await again.getByLabel("Name", { exact: true }).fill("Hero again");
    const address = again.getByLabel("API address");
    await address.fill(group);
    await expect(address).toHaveAccessibleDescription(
      "Another field group already uses this address.",
      { timeout: 15_000 }
    );
    await expect(
      again.getByRole("button", { name: "Create", exact: true })
    ).toBeDisabled();
    await again.getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await expect(
      review.getByRole("list", { name: "Created first" })
    ).toHaveText("Create the field group Hero");
    await review.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("No unsaved changes")).toBeVisible({
      timeout: 60_000,
    });

    expect(await serverHasFieldGroup(api, group)).toBe(true);
    const saved = await api.get(`/admin/api/collections/schema/${host}`);
    const { fields } = (await saved.json()) as {
      fields: Array<{ name: string; component?: string }>;
    };
    expect(fields).toContainEqual(
      expect.objectContaining({ name: "hero", component: group })
    );
  } finally {
    await removeRuntimeCollection(api, host);
    await removeFieldGroup(api, group);
  }
});

test("leaving the host keeps its new field group, which its own editor opens and saves", async ({
  page,
}) => {
  const stamp = Date.now();
  const host = `fg_left_${stamp}`;
  const group = `fg_kept_${stamp}`;
  const api = page.context().request;
  try {
    await createInDialog(page, host);
    await newFieldGroupFromPicker(page, group, "Kept");

    await page.evaluate(
      path => window.history.pushState(null, "", path),
      `/admin/builder/field-groups/${group}`
    );
    const guard = page.getByRole("alertdialog", { name: "Unsaved Changes" });
    await guard.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/builder/field-groups/${group}$`)
    );

    // Opened as an unsaved field group of its own: its first save creates it.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await review.getByRole("button", { name: "Create", exact: true }).click();
    await expect
      .poll(() => serverHasFieldGroup(api, group), {
        timeout: 60_000,
      })
      .toBe(true);
    expect(await serverHas(api, host)).toBe(false);
  } finally {
    await removeRuntimeCollection(api, host);
    await removeFieldGroup(api, group);
  }
});

test("leaving the host elsewhere lists its new field group, unowned, in another's picker", async ({
  page,
}) => {
  const stamp = Date.now();
  const host = `fg_away_${stamp}`;
  const other = `fg_other_${stamp}`;
  const group = `fg_loose_${stamp}`;
  const api = page.context().request;
  try {
    await createInDialog(page, host);
    await newFieldGroupFromPicker(page, group, "Loose");
    await markTab(page);

    await page.evaluate(
      path => window.history.pushState(null, "", path),
      "/admin/builder/collections"
    );
    await page
      .getByRole("alertdialog", { name: "Unsaved Changes" })
      .getByRole("button", { name: "Discard Changes" })
      .click();

    await createInDialog(page, other, { inApp: true });
    await expectSameTab(page);
    await openFieldGroupChooser(page);
    await expect(
      page.getByRole("option", {
        name: new RegExp(`${group}\\) · not saved yet`),
      })
    ).toBeVisible();
    expect(await serverHasFieldGroup(api, group)).toBe(false);
  } finally {
    await removeRuntimeCollection(api, host);
    await removeRuntimeCollection(api, other);
    await removeFieldGroup(api, group);
  }
});

test("Discard all lets go of the host's new field group", async ({ page }) => {
  const stamp = Date.now();
  const host = `fg_gone_${stamp}`;
  const other = `fg_next_${stamp}`;
  const group = `fg_dropped_${stamp}`;
  const api = page.context().request;
  try {
    await createInDialog(page, host);
    await newFieldGroupFromPicker(page, group, "Dropped");
    await markTab(page);

    await page.getByRole("button", { name: "Discard all changes" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Discard / })
      .click();
    await expect(page).toHaveURL(/\/admin\/builder\/collections$/);

    await createInDialog(page, other, { inApp: true });
    await expectSameTab(page);
    await openFieldGroupChooser(page);
    await expect(
      page.getByRole("option", { name: new RegExp(group) })
    ).toHaveCount(0);
    expect(await serverHasFieldGroup(api, group)).toBe(false);
  } finally {
    await removeRuntimeCollection(api, host);
    await removeRuntimeCollection(api, other);
    await removeFieldGroup(api, group);
  }
});
