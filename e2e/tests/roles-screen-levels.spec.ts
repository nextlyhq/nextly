/**
 * The roles screen sets each collection and Single by level, and what it
 * saves is exactly that level's permissions.
 *
 * Read back through the API, not from the screen: a level that showed
 * selected but saved another set of permissions is the defect, and only the
 * stored role can show it. Each test also reads a row it did not touch, so a
 * level that wrote over another row's grants fails too.
 *
 * The built-in roles each have a face of their own: super-admin is a line and
 * nothing to change, the Public role offers visitors' levels alone, and a
 * preset is read-only and changed by copying it.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { superAdminRoleId, uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { fileAccount, test } from "./support/test";

let admin: APIRequestContext;
/** Permission ids by slug (`read-posts`), as the roles route takes them. */
let permissionIds: Map<string, string>;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  // The list pages at ten by default, which would miss most of them.
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
      name: `E2E levels ${tag}`,
      slug: `e2e-levels-${tag}`,
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

/** Opens the role, lets `change` set it, and saves. */
async function editAndSave(
  page: Page,
  roleId: string,
  change: () => Promise<void>
): Promise<void> {
  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  await expect(
    page.getByRole("radiogroup", { name: "Post (posts) level" })
  ).toBeVisible();
  await change();
  await page.getByRole("button", { name: "Update Role" }).click();
  // The form goes back to the list once the role is saved.
  await page.waitForURL("**/admin/security/roles");
}

const POST_LEVELS: ReadonlyArray<[string, string[]]> = [
  ["No access", []],
  ["Can view", ["read"]],
  ["Can edit", ["create", "delete", "read", "update"]],
  [
    "Can publish",
    ["create", "delete", "publish", "read", "unpublish", "update"],
  ],
];

for (const [level, actions] of POST_LEVELS) {
  test(`saves ${level} on Posts as exactly its permissions`, async ({
    page,
  }) => {
    // Starts at a level other than each one set, beside another row's grant.
    const roleId = await roleHolding(
      level === "Can view"
        ? ["read-posts", "update-posts", "read-tags"]
        : ["read-posts", "read-tags"]
    );

    await editAndSave(page, roleId, () =>
      page
        .getByRole("radiogroup", { name: "Post (posts) level" })
        .getByRole("radio", { name: level })
        .click()
    );

    expect(await storedActions(roleId, "posts")).toEqual(actions);
    expect(await storedActions(roleId, "tags")).toEqual(["read"]);
  });
}

test("saves a Single's Can edit as view and edit alone", async ({ page }) => {
  const roleId = await roleHolding(["read-tags"]);

  await editAndSave(page, roleId, () =>
    page
      .getByRole("radiogroup", { name: "Homepage (homepage) level" })
      .getByRole("radio", { name: "Can edit" })
      .click()
  );

  expect(await storedActions(roleId, "homepage")).toEqual(["read", "update"]);
});

test("keeps a Custom row exactly as it was when another row is saved", async ({
  page,
}) => {
  const roleId = await roleHolding(["read-posts", "create-posts"]);

  await editAndSave(page, roleId, async () => {
    // POPULATION CONTROL: the Posts row reads Custom before the save.
    await expect(
      page
        .getByText("View and create", { exact: true })
        .filter({ visible: true })
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Tag (tags) level" })
      .getByRole("radio", { name: "Can view" })
      .click();
  });

  expect(await storedActions(roleId, "posts")).toEqual(["create", "read"]);
  expect(await storedActions(roleId, "tags")).toEqual(["read"]);
});

test("sets a level from the select on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const roleId = await roleHolding(["read-tags"]);

  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  await page.getByRole("combobox", { name: "Post (posts) level" }).click();
  await page.getByRole("option", { name: "Can view" }).click();
  await page.getByRole("button", { name: "Update Role" }).click();
  await page.waitForURL("**/admin/security/roles");

  expect(await storedActions(roleId, "posts")).toEqual(["read"]);
  expect(await storedActions(roleId, "tags")).toEqual(["read"]);
});

test("marks a collection whose code narrows it, naming what the code limits", async ({
  page,
}) => {
  // The playground's translator notes declare an update rule in code.
  const roleId = await roleHolding(["read-tags"]);

  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  const row = page
    .locator('[data-slot="permission-level-row"]')
    .filter({ hasText: "translator-notes" });

  await expect(row.getByText("Narrowed in code")).toBeVisible();
  await expect(
    row.getByText(
      "This collection's code also limits who can edit it. The level here is the most a role can be given."
    )
  ).toBeVisible();
  // POPULATION CONTROL: a collection whose code declares no rule is not marked.
  await expect(
    page
      .locator('[data-slot="permission-level-row"]')
      .filter({ hasText: "tags" })
      .getByText("Narrowed in code")
  ).toHaveCount(0);
});

test("folds a plugin under its name and saves its collections' levels and its own permission", async ({
  page,
}) => {
  // The form builder contributes forms and submissions, and declares an
  // export permission of its own, outside both collections.
  const roleId = await roleHolding(["read-forms", "read-form-submissions"]);

  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  const plugins = page.getByRole("region", { name: "Plugins" });
  const fold = plugins.getByRole("button", { name: /^Forms/ });
  // Folded, the group says in one word what the role holds across it.
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(fold).toContainText("Can view");

  await editAndSave(page, roleId, async () => {
    await page
      .getByRole("region", { name: "Plugins" })
      .getByRole("button", { name: /^Forms/ })
      .click();
    await page
      .getByRole("radiogroup", { name: "Form (forms) level" })
      .getByRole("radio", { name: "Can edit" })
      .click();
    await page
      .getByRole("switch", { name: "Forms: Export Submissions" })
      .click();
  });

  expect(await storedActions(roleId, "forms")).toEqual([
    "create",
    "delete",
    "read",
    "update",
  ]);
  expect(await storedActions(roleId, "form-submissions")).toEqual(["read"]);
  expect(await storedActions(roleId, "submissions")).toEqual(["export"]);
});

/** The role listed with `match`, read over the API. */
async function listedRole(
  match: (role: ListedRole) => boolean
): Promise<ListedRole> {
  const roles = await admin.get("/admin/api/roles?limit=100");
  expect(roles.ok(), await roles.text()).toBe(true);
  const { items } = (await roles.json()) as { items: ListedRole[] };
  const found = items.find(match);
  if (!found) throw new Error("[e2e] No such role listed.");
  return found;
}

interface ListedRole {
  id: string;
  slug: string;
  description?: string | null;
  builtIn?: "public" | "super-admin";
}

/** The ids of the permissions the stored role holds, sorted. */
async function storedIds(roleId: string): Promise<string[]> {
  const answer = await admin.get(`/admin/api/roles/${roleId}/permissions`);
  expect(answer.ok(), await answer.text()).toBe(true);
  const { permissions } = (await answer.json()) as {
    permissions: Array<{ id: string }>;
  };
  return permissions.map(permission => permission.id).sort();
}

test("shows super-admin as holding every permission, with nothing to change", async ({
  page,
}) => {
  const roleId = await superAdminRoleId(admin);

  await gotoAdmin(page, `/security/roles/edit/${roleId}`);
  await expect(
    page.getByText(
      "Super-admins have every permission, including new collections and plugins. This role can't be edited."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Post (posts) level" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update Role" })).toHaveCount(
    0
  );
});

test("saves the Public role's Can view, keeping a write a plugin gave it", async ({
  page,
}) => {
  const publicRole = await listedRole(role => role.builtIn === "public");
  const before = await storedIds(publicRole.id);
  // The form builder gives visitors create on submissions, which no visitor
  // level offers, so that row reads Custom.
  expect(await storedActions(publicRole.id, "form-submissions")).toContain(
    "create"
  );

  try {
    await editAndSave(page, publicRole.id, async () => {
      await expect(
        page.getByText("This is what visitors who aren't signed in can see.")
      ).toBeVisible();
      const tags = page.getByRole("radiogroup", { name: "Tag (tags) level" });
      // A visitor is offered no level that writes.
      await expect(tags.getByRole("radio")).toHaveCount(2);
      await tags.getByRole("radio", { name: "Can view" }).click();
    });

    expect(await storedActions(publicRole.id, "tags")).toEqual(["read"]);
    expect(await storedActions(publicRole.id, "form-submissions")).toContain(
      "create"
    );
  } finally {
    // Every other test meets visitors as the Public role left them.
    const restored = await admin.patch(
      `/admin/api/roles/${publicRole.id}/permissions`,
      { data: { permissionIds: before } }
    );
    expect(restored.ok(), await restored.text()).toBe(true);
  }
});

test("shows a preset read-only, and copies it into a new role to change", async ({
  page,
}) => {
  const editor = await listedRole(role => role.slug === "editor");

  await gotoAdmin(page, `/security/roles/edit/${editor.id}`);
  const posts = page.getByRole("radiogroup", { name: "Post (posts) level" });
  await expect(posts).toBeVisible();
  for (const radio of await posts.getByRole("radio").all()) {
    await expect(radio).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Update Role" })).toHaveCount(
    0
  );

  await page.getByRole("button", { name: "Copy to change" }).click();
  await page.waitForURL(`**/security/roles/create?copyFrom=${editor.id}`);
  // The copy arrives after the form opens: the description says it has.
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    editor.description ?? ""
  );
  const tag = uniqueTag();
  await page.getByRole("textbox", { name: /^Name/ }).fill(`E2E copy ${tag}`);
  await page.getByRole("textbox", { name: "Slug" }).fill(`e2e-copy-${tag}`);
  await page.getByRole("button", { name: "Create Role" }).click();
  await page.waitForURL("**/admin/security/roles");

  const copy = await listedRole(role => role.slug === `e2e-copy-${tag}`);
  expect(await storedIds(copy.id)).toEqual(await storedIds(editor.id));
});
