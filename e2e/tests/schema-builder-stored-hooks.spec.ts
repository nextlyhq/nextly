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
    config: { sourceField: "headline", targetField: "path" },
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

async function giveHooks(api: APIRequestContext, slug: string): Promise<void> {
  await expectOk(
    await api.patch(`${API}/collections/${slug}`, {
      data: { hooks: STORED_HOOKS },
    }),
    "storing the hooks"
  );
  // Read back once, so a server that reshaped them on the way in fails here
  // and not as a difference the Builder seems to have made.
  expect(await storedHooks(api, slug)).toEqual(STORED_HOOKS);
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

async function makeCollection(page: Page, prefix: string): Promise<string> {
  const slug = `${prefix}_${Date.now()}`;
  // Stored as a field the Builder made is stored, with its flags written out,
  // so a Builder save finds no schema change that is not the test's own.
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
  await giveHooks(page.request, slug);
  return slug;
}

async function openHooksTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: "Hooks (3)" })
    .click();
}

test("a hook given through the API shows in the editor", async ({ page }) => {
  const slug = await makeCollection(page, "stored_hooks_view");
  try {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await openHooksTab(page);

    const dialog = page.getByRole("dialog");
    const list = dialog.getByRole("list", {
      name: "Stored hooks, in the order they run",
    });
    // In run order, which is the stored `order`, not the stored position.
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

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
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
