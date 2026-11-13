/**
 * A collection's stored hooks, seen in the Builder and kept by its saves.
 *
 * Stored hooks rewrite or refuse writes on the server and are set through the
 * API. The Builder shows them read-only in the collection's settings, in the
 * order the server runs them, and a save from the Builder leaves the stored
 * list exactly as it was: it never sends hooks, so it can neither drop one
 * this admin does not know nor renumber their run order.
 *
 * A collection made at runtime, because the playground's own collections are
 * code-first and open read-only.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  expectOk,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// Creating a collection changes the schema and the dashboard's cards, as for the
// other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/**
 * Stored deliberately out of run order, with one hook turned off and one id no
 * version of Nextly provides: the three things a save that re-sent the loaded
 * list could change.
 */
const STORED_HOOKS = [
  {
    hookId: "auto-slug",
    hookType: "beforeChange",
    enabled: true,
    config: {
      sourceField: "headline",
      targetField: "path",
      overwriteExisting: false,
    },
    order: 1,
  },
  {
    hookId: "audit-fields",
    hookType: "beforeChange",
    enabled: false,
    config: { createdByField: "createdBy", updatedByField: "updatedBy" },
    order: 0,
  },
  {
    hookId: "send-sms",
    hookType: "afterChange",
    enabled: true,
    config: { to: "+15550100" },
    order: 2,
  },
];

async function giveHooks(
  api: APIRequestContext,
  slug: string,
  hooks: readonly unknown[]
): Promise<void> {
  await expectOk(
    await api.patch(`${API}/collections/${slug}`, {
      data: { hooks },
    }),
    "storing the hooks"
  );
  // Read back once, so a server that reshaped them on the way in fails here
  // and not as a difference the Builder seems to have made.
  expect(await storedHooks(api, slug)).toEqual(hooks);
}

async function storedHooks(
  api: APIRequestContext,
  slug: string
): Promise<unknown> {
  const response = await api.get(`${API}/collections/${slug}`);
  await expectOk(response, "reading the collection");
  const body = (await response.json()) as { hooks?: unknown };
  return body.hooks;
}

async function makeCollection(
  page: Page,
  prefix: string,
  hooks: readonly unknown[] = STORED_HOOKS
): Promise<string> {
  const slug = `${prefix}_${Date.now()}`;
  // Stored as a field the Builder made is stored, with its flags written out,
  // so a Builder save finds no schema change that is not the test's own.
  // The guard covers creation too: creating is three requests, and a failure
  // after the first leaves a collection behind before the caller's `finally`
  // has started. A removal that itself fails does not hide the first error.
  try {
    // Stored as a field the Builder made is stored, with its flags written
    // out, so a Builder save finds no schema change that is not the test's own.
    await createRuntimeCollection(page.request, slug, [
      {
        name: "headline",
        type: "text",
        label: "Headline",
        required: false,
        unique: false,
        index: false,
      },
    ]);
    await giveHooks(page.request, slug, hooks);
  } catch (error) {
    await removeRuntimeCollection(page.request, slug).catch(() => undefined);
    throw error;
  }
  return slug;
}

async function openHooksTab(page: Page, count: number): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: `Hooks (${count})` })
    .click();
}

test("a hook given through the API shows in the editor", async ({ page }) => {
  const slug = await makeCollection(page, "stored_hooks_view");
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await openHooksTab(page, STORED_HOOKS.length);

    const dialog = page.getByRole("dialog");
    const list = dialog.getByRole("list", {
      name: "Stored hooks, grouped by when they run",
    });
    // Grouped by stored phase, and by the stored `order` within one.
    await expect(list.getByRole("heading")).toHaveText([
      "Set Audit Fields",
      "Auto-generate Slug",
      "send-sms",
    ]);
    await expect(list).toContainText(
      "Fills path from headline, unless path already has a value."
    );
    await expect(list).toContainText(
      "Not a hook this version of Nextly knows, so it runs nothing."
    );
    await expect(
      list.getByRole("listitem").filter({ hasText: "Set Audit Fields" })
    ).toContainText("Off");

    // Nothing in the tab can change a hook.
    const tabPanel = dialog.getByRole("tabpanel");
    for (const role of ["textbox", "checkbox", "switch", "combobox"] as const) {
      await expect(tabPanel.getByRole(role)).toHaveCount(0);
    }
    await expect(tabPanel.getByRole("button")).toHaveCount(0);

    // Each theme is chosen as the admin chooses it, through its stored
    // setting, so the dark pass audits the dark palette rather than a dark
    // system preference the light setting overrides.
    for (const theme of ["light", "dark"] as const) {
      await gotoAdmin(page, `/builder/collections/${slug}`, theme);
      await openHooksTab(page, STORED_HOOKS.length);
      // The admin marks its containers `dark` in the dark theme only.
      const themed = page.locator(".nextly-admin").first();
      if (theme === "dark") await expect(themed).toHaveClass(/\bdark\b/);
      else await expect(themed).not.toHaveClass(/\bdark\b/);
      await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    }
  } finally {
    await removeRuntimeCollection(page.request, slug);
  }
});

test("a field change saved, the hooks read back unchanged", async ({
  page,
}) => {
  const slug = await makeCollection(page, "stored_hooks_field");
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    // A label is a setting, so this saves without a schema change.
    await page.getByTestId("field-row-headline").click();
    await page
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Title line");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(async () => {
        const schema = await page.request.get(
          `${API}/collections/schema/${slug}`
        );
        const body = (await schema.json()) as {
          fields?: { name: string; label?: string }[];
        };
        return body.fields?.find(f => f.name === "headline")?.label ?? null;
      })
      .toBe("Title line");
    expect(await storedHooks(page.request, slug)).toEqual(STORED_HOOKS);
  } finally {
    await removeRuntimeCollection(page.request, slug);
  }
});

test("a field added and applied, the hooks read back unchanged", async ({
  page,
}) => {
  // A schema-changing save takes the other road: a preview, the confirmation,
  // the apply, and then the settings write that follows it.
  const slug = await makeCollection(page, "stored_hooks_apply");
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
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

    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The apply is followed by the collection's settings write. What decides
    // whether a save can change the stored hooks is what that write SENDS, so
    // its body is checked to carry no `hooks` at all: that holds whatever the
    // server answers, and on the dev server it can be refused while the schema
    // file it reads is being rewritten beside it. The hooks are also read back
    // once it has answered, so a write that changed them is not missed by
    // reading too early.
    const settingsWrite = page.waitForResponse(
      response =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `${API}/collections/${slug}`,
      { timeout: 60_000 }
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Apply and restart" })
      .click();
    const written: unknown = (await settingsWrite).request().postDataJSON();
    // The captured request is the settings write itself, which sends labels.
    expect(written).toHaveProperty("labels");
    expect(written).not.toHaveProperty("hooks");

    await expect
      .poll(
        async () => {
          const schema = await page.request.get(
            `${API}/collections/schema/${slug}`
          );
          const body = (await schema.json()) as {
            fields?: { name: string }[];
          };
          return body.fields?.some(f => f.name === "subtitle") ?? false;
        },
        { timeout: 30_000 }
      )
      .toBe(true);
    expect(await storedHooks(page.request, slug)).toEqual(STORED_HOOKS);
  } finally {
    await removeRuntimeCollection(page.request, slug);
  }
});

test("a settings change saved, the hooks read back unchanged", async ({
  page,
}) => {
  const slug = await makeCollection(page, "stored_hooks_settings");
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Description").fill("Pages with stored hooks");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(async () => {
        const response = await page.request.get(`${API}/collections/${slug}`);
        const body = (await response.json()) as { description?: string };
        return body.description ?? null;
      })
      .toBe("Pages with stored hooks");
    expect(await storedHooks(page.request, slug)).toEqual(STORED_HOOKS);
  } finally {
    await removeRuntimeCollection(page.request, slug);
  }
});

test("a long list of hooks keeps the dialog's controls on screen", async ({
  page,
}) => {
  // Long setting values on many hooks: unbounded, the list would push the
  // dialog's tabs and footer past the window's edges.
  const many = Array.from({ length: 30 }, (_, order) => ({
    hookId: "unique-validation",
    hookType: "beforeChange",
    enabled: true,
    config: { field: "headline", errorMessage: "Taken. ".repeat(20) },
    order,
  }));
  const slug = await makeCollection(page, "stored_hooks_many", many);
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await openHooksTab(page, many.length);

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("tab", { name: `Hooks (${many.length})` })
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true })
    ).toBeInViewport();
    // The list scrolls inside the dialog instead.
    const region = dialog.getByRole("region", { name: "Stored hooks" });
    await region.focus();
    await page.keyboard.press("End");
    await expect(region.getByRole("listitem").last()).toBeInViewport();
  } finally {
    await removeRuntimeCollection(page.request, slug);
  }
});
