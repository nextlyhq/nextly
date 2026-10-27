/**
 * Signed-in callers who hold the permissions a test names, and nothing else,
 * or who hold the super-admin role.
 *
 * A code rule only narrows a permission, so a test that wants a rule to admit
 * a signed-in user gives them the permission first. The user and its roles are
 * written directly, as a test seeds a caller, and each permission is created
 * only where the boot did not seed it already. A gate looks a caller up, so a
 * test that needs a super-admin seeds one here rather than naming the role on
 * the user it hands in.
 */
import { createHash, randomUUID } from "node:crypto";

import { getDialectTables } from "../../database/index";
import type { TestNextly } from "../../plugins/test-nextly";
import { permissionSlug } from "../../schemas/_zod/rbac";
import { ServiceContainer } from "../../services/index";

interface PermissionsApi {
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

interface Inserts {
  insert(table: unknown): { values(row: unknown): Promise<unknown> };
}

/**
 * The tables of the database `t` runs on, named by its adapter rather than
 * the environment, since a test may hand `createTestNextly` an adapter of a
 * dialect the environment does not name.
 */
const tablesOf = (t: TestNextly) => getDialectTables(t.adapter.dialect);

/**
 * A short name for the role holding `action` for `userId`: role names and
 * slugs are capped at 50 characters, and a test's user id may be long.
 */
const roleKey = (action: string, userId: string) =>
  `${action}-${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;

/** The permission's id, created where the boot did not seed it. */
async function permissionId(
  api: PermissionsApi,
  action: string,
  resource: string
): Promise<string> {
  const slug = permissionSlug(action, resource);
  const seeded = await api.permissions.find({ limit: 1000 });
  const found = seeded.items.find(permission => permission.slug === slug);
  if (found) return found.id;
  const created = await api.permissions.create({
    data: { action, resource, name: `${action} ${resource}`, slug },
  });
  return created.item.id;
}

/**
 * Gives the existing user `userId` a role holding `action` on each of
 * `resources`. Called once per action, so a user may hold several.
 */
export async function grantTo(
  t: TestNextly,
  userId: string,
  action: string,
  resources: readonly string[]
): Promise<void> {
  const api = t.nextly as unknown as PermissionsApi;
  const permissionIds: string[] = [];
  for (const resource of resources) {
    permissionIds.push(await permissionId(api, action, resource));
  }
  const key = roleKey(action, userId);
  const role = await api.roles.create({
    data: { name: `May ${key}`, slug: `may-${key}`, permissionIds },
  });
  const db = t.adapter.getDrizzle() as unknown as Inserts;
  await db.insert(tablesOf(t).userRoles).values({
    id: randomUUID(),
    userId,
    roleId: role.item.id,
    createdAt: new Date(),
  });
}

/** Writes an active user with the fixed id `id` and no roles. */
async function insertUser(t: TestNextly, id: string): Promise<void> {
  const db = t.adapter.getDrizzle() as unknown as Inserts;
  const now = new Date();
  await db.insert(tablesOf(t).users).values({
    id,
    email: `${id}@example.test`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * A new signed-in user, with the fixed id `id`, who holds `action` on each of
 * `resources`. The id is fixed because a test's rules often name the caller
 * they admit (`user.id === "permitted"`).
 */
export async function userWhoMay(
  t: TestNextly,
  id: string,
  action: string,
  resources: readonly string[]
): Promise<string> {
  await insertUser(t, id);
  await grantTo(t, id, action, resources);
  return id;
}

/**
 * A new signed-in user, with the fixed id `id`, who holds the super-admin
 * role, for a test whose reader must be allowed everything. The role is the
 * one the install keeps, created where the boot did not seed it.
 */
export async function superAdminUser(
  t: TestNextly,
  id: string
): Promise<string> {
  await insertUser(t, id);
  const role = await new ServiceContainer(
    t.adapter
  ).roles.ensureSuperAdminRole();
  const db = t.adapter.getDrizzle() as unknown as Inserts;
  await db.insert(tablesOf(t).userRoles).values({
    id: randomUUID(),
    userId: id,
    roleId: role.id,
    createdAt: new Date(),
  });
  return id;
}
