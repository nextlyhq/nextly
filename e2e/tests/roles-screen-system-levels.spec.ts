/**
 * The roles screen sets media, settings and the Email hub by level, as it
 * sets a collection, and what it saves is exactly that level's plain
 * permissions.
 *
 * A role still holding a retired `manage-settings` permission, as one an
 * install has not yet converted with `nextly upgrade`, reads Can edit on
 * Settings with a note naming the command. Saving the role keeps that access,
 * stored as the plain permissions; a changed row saves the plain permissions
 * it then shows. Read back through the API, as the levels spec reads them: only
 * the stored role shows what a save did.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { fileAccount, test } from "./support/test";

let admin: APIRequestContext;
/** Permission ids by slug (`read-settings`), as the roles route takes them. */
let permissionIds: Map<string, string>;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
  expect(list.ok(), await list.text()).toBe(true);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; slug: string }>;
  };
  permissionIds = new Map(items.map(item => [item.slug, item.id]));
});

test.afterAll(async () => {
  await admin?.dispose();
});

/** A new role holding exactly `slugs`, made over the API. */
async function roleHolding(slugs: readonly string[]): Promise<string> {
  const tag = uniqueTag();
  const created = await admin.post("/admin/api/roles", {
    data: {
      name: `E2E system levels ${tag}`,
      slug: `e2e-system-levels-${tag}`,
      permissionIds: slugs.map(slug => {
        const id = permissionIds.get(slug);
        if (id === undefined) throw new Error(`[e2e] No permission "${slug}".`);
        return id;
      }),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The suite's own database, never the one `pnpm dev:app` uses. */
const E2E_DB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/playground/data/e2e.db"
);

/**
 * A role still holding the retired `manage-settings` permission, as an
 * install not yet converted holds one. Written to the database directly,
 * since the roles route now stores the plain permissions in its place.
 */
async function unconvertedRole(): Promise<string> {
  const roleId = await roleHolding(["read-tags"]);
  const permissionId = permissionIds.get("manage-settings");
  if (permissionId === undefined) {
    throw new Error('[e2e] No permission "manage-settings".');
  }
  // The dev server holds the same file: wait for its lock rather than fail.
  const db = new DatabaseSync(E2E_DB);
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    db.prepare(
      "INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)"
    ).run(randomUUID(), roleId, permissionId);
  } finally {
    db.close();
  }
  // POPULATION CONTROL: the server reads the role as holding it.
  expect(await storedActions(roleId, "settings")).toEqual(["manage"]);
  return roleId;
}

/** The actions the stored role holds on `resource`, sorted. */
async function storedActions(
  roleId: string,
  resource: string
): Promise<string[]> {
  const answer = await admin.get(`/admin/api/roles/${roleId}/permissions`);
  expect(answer.ok(), await answer.text()).toBe(true);
  const { permissions } = (await answer.json()) as {
    permissions: Array<{ action: string; resource: string }>;
  };
  return permissions
    .filter(permission => permission.resource === resource)
    .map(permission => permission.action)
    .sort();
}

const level = (page: Page, label: string, slug: string) =>
  page.getByRole("radiogroup", { name: `${label} (${slug}) level` });

/** Opens the role, lets `change` set it, and saves. */
async function editAndSave(
  page: Page,
  roleId: string,
  change: () => Promise<void>
): Promise<void> {
  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  await expect(level(page, "Settings", "settings")).toBeVisible();
  await change();
  await page.getByRole("button", { name: "Update Role" }).click();
  await page.waitForURL("**/admin/security/roles");
}

test("saves Can edit on Email providers as its four plain permissions", async ({
  page,
}) => {
  const roleId = await roleHolding(["read-email-providers", "read-media"]);

  await editAndSave(page, roleId, () =>
    level(page, "Email providers", "email-providers")
      .getByRole("radio", { name: "Can edit" })
      .click()
  );

  expect(await storedActions(roleId, "email-providers")).toEqual([
    "create",
    "delete",
    "read",
    "update",
  ]);
  // The row it did not touch is as it was.
  expect(await storedActions(roleId, "media")).toEqual(["read"]);
});

test("keeps read and update on Settings as Custom when another row is saved", async ({
  page,
}) => {
  const roleId = await roleHolding(["read-settings", "update-settings"]);

  await editAndSave(page, roleId, async () => {
    const settings = page
      .locator('[data-slot="permission-level-row"]')
      .filter({ has: level(page, "Settings", "settings") });
    // POPULATION CONTROL: the row reads Custom, and says it cannot change
    // the schema, before the save.
    await expect(settings.getByText("Custom", { exact: true })).toBeVisible();
    await expect(
      settings.getByText("Can change settings, but not collections or Singles.")
    ).toBeVisible();
    await level(page, "Media", "media")
      .getByRole("radio", { name: "Can view" })
      .click();
  });

  expect(await storedActions(roleId, "settings")).toEqual(["read", "update"]);
  expect(await storedActions(roleId, "media")).toEqual(["read"]);
});

test("shows a role still holding manage-settings at Can edit, with a note naming nextly upgrade", async ({
  page,
}) => {
  const roleId = await unconvertedRole();

  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  await expect(
    level(page, "Settings", "settings").getByRole("radio", { name: "Can edit" })
  ).toBeChecked();
  const settings = page
    .locator('[data-slot="permission-level-row"]')
    .filter({ has: level(page, "Settings", "settings") });
  await expect(settings.getByText(/nextly upgrade/)).toBeVisible();
  // POPULATION CONTROL: a row with no retired permission has no such note.
  await expect(
    page
      .locator('[data-slot="permission-level-row"]')
      .filter({ has: level(page, "Media", "media") })
      .getByText(/nextly upgrade/)
  ).toHaveCount(0);
});

test("keeps manage-settings' access when the role is saved without changing Settings", async ({
  page,
}) => {
  const roleId = await unconvertedRole();

  await editAndSave(page, roleId, () =>
    level(page, "Media", "media")
      .getByRole("radio", { name: "Can view" })
      .click()
  );

  // The access is kept, stored as the plain permissions it stood for.
  expect(await storedActions(roleId, "settings")).toEqual([
    "create",
    "delete",
    "read",
    "update",
  ]);
  expect(await storedActions(roleId, "media")).toEqual(["read"]);
});

test("saves the plain permissions once Settings is changed from manage-settings", async ({
  page,
}) => {
  const roleId = await unconvertedRole();

  await editAndSave(page, roleId, () =>
    level(page, "Settings", "settings")
      .getByRole("radio", { name: "Can view" })
      .click()
  );

  expect(await storedActions(roleId, "settings")).toEqual(["read"]);
});
