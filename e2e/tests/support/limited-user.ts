import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

import { createSignedInUser, uniqueTag } from "./accounts";

/**
 * A browser signed in as someone other than a super-admin.
 *
 * Each spec file's own session is a super-admin (see `./test`), who holds
 * every permission, so nothing it opens can ever be refused. This makes a role
 * holding exactly the permissions a test names, a user holding that role, and
 * a fresh browser context signed in as that user, all over HTTP (see
 * `./accounts`): the playground renders no sign-in page.
 *
 * Signing in spends two of the account's auth attempts, so call it once per
 * spec file, not once per test.
 */

export interface LimitedUser {
  context: BrowserContext;
  email: string;
  userId: string;
  roleId: string;
}

export async function signInAsLimitedUser(
  browser: Browser,
  /** A request context signed in as the super-admin, to create the role and user. */
  admin: APIRequestContext,
  baseURL: string,
  permissions: readonly string[]
): Promise<LimitedUser> {
  const { roleIds, ...user } = await signInWithRoles(browser, admin, baseURL, [
    permissions,
  ]);
  return { ...user, roleId: roleIds[0] };
}

/**
 * {@link signInAsLimitedUser} for a user holding several roles, one for each
 * list of permissions, so a test can show what holding them together gives.
 */
export async function signInWithRoles(
  browser: Browser,
  /** A request context signed in as the super-admin, to create the roles and user. */
  admin: APIRequestContext,
  baseURL: string,
  roles: readonly (readonly string[])[]
): Promise<Omit<LimitedUser, "roleId"> & { roleIds: string[] }> {
  const tag = uniqueTag();

  // Roles take permission ids, not slugs. The list pages at ten by default,
  // which would silently miss most of them.
  const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
  expect(list.ok(), await list.text()).toBe(true);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; slug: string }>;
  };
  const idsOf = (permissions: readonly string[]) =>
    permissions.map(slug => {
      const found = items.find(item => item.slug === slug);
      if (!found) throw new Error(`[e2e] No permission "${slug}" to grant.`);
      return found.id;
    });

  const roleIds: string[] = [];
  for (const [index, permissions] of roles.entries()) {
    const role = await admin.post("/admin/api/roles", {
      data: {
        name: `E2E limited ${tag} ${index + 1}`,
        slug: `e2e-limited-${tag}-${index + 1}`,
        permissionIds: idsOf(permissions),
      },
    });
    expect(role.status(), await role.text()).toBe(201);
    roleIds.push(((await role.json()) as { item: { id: string } }).item.id);
  }

  const { storageState, email, userId } = await createSignedInUser(
    admin,
    baseURL,
    {
      email: `limited-${tag}@nextly.local`,
      name: "Limited User",
      roleIds,
    }
  );
  const context = await browser.newContext({ baseURL, storageState });

  // The session is this user's (checked by `createSignedInUser`); this checks
  // it is also not a super-admin's, so every refusal a test expects can happen.
  const me = await context.request.get("/admin/api/me/permissions");
  expect(me.ok(), await me.text()).toBe(true);
  expect(((await me.json()) as { isSuperAdmin: boolean }).isSuperAdmin).toBe(
    false
  );

  return { context, email, userId, roleIds };
}
