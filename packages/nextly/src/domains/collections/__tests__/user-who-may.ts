/**
 * A signed-in user, with a fixed id, who holds one permission (read, create…)
 * on the named collections or Singles and nothing else.
 *
 * A code rule only narrows the permission, so a test that wants a rule to
 * admit someone must first give them the permission. The id is fixed
 * because the tests' rules often name the caller they admit (`user.id ===
 * "permitted"`). The user and its role are written directly, as a test seeds
 * a caller, and the permission is created only where the boot did not seed it.
 */
import { getDialectTables } from "../../../database/index";
import type { TestNextly } from "../../../plugins/test-nextly";

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

async function permissionId(
  api: PermissionsApi,
  action: string,
  resource: string
): Promise<string> {
  const slug = `${action}-${resource}`;
  const seeded = await api.permissions.find({ limit: 1000 });
  const found = seeded.items.find(permission => permission.slug === slug);
  if (found) return found.id;
  const created = await api.permissions.create({
    data: { action, resource, name: `${action} ${resource}`, slug },
  });
  return created.item.id;
}

export async function userWhoMay(
  t: TestNextly,
  id: string,
  action: string,
  resources: readonly string[]
): Promise<string> {
  const api = t.nextly as unknown as PermissionsApi;
  const permissionIds: string[] = [];
  for (const resource of resources) {
    permissionIds.push(await permissionId(api, action, resource));
  }
  const role = await api.roles.create({
    data: {
      name: `May ${action} ${id}`,
      slug: `${action}-holder-${id}`,
      permissionIds,
    },
  });
  const db = t.adapter.getDrizzle() as unknown as Inserts;
  const tables = getDialectTables();
  const now = new Date();
  await db.insert(tables.users).values({
    id,
    email: `${id}@example.test`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tables.userRoles).values({
    id: `user-role-${id}`,
    userId: id,
    roleId: role.item.id,
    createdAt: now,
  });
  return id;
}
