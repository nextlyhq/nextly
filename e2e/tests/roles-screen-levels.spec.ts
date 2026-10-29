/**
 * The roles screen sets each collection and Single by level, and what it
 * saves is exactly that level's permissions.
 *
 * Read back through the API, not from the screen: a level that showed
 * selected but saved another set of permissions is the defect, and only the
 * stored role can show it. Each test also reads a row it did not touch, so a
 * level that wrote over another row's grants fails too.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
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
