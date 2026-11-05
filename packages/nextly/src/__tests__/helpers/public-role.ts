/**
 * Granting the Public role a permission, for integration tests whose visitor
 * writes.
 *
 * A visitor is judged by the Public role wherever a call asks to be checked:
 * a read needs Public to hold the read (which boot grants where the read rule
 * answers `true`), and a write needs Public to hold the write as well as a
 * rule answering `true`. Boot grants no write, so a test whose visitor writes
 * grants it here, the way a site admin would: through the role screen's
 * writer, keeping every grant boot seeding made.
 *
 * The harness must have run the boot's seeding (`seedPublic: true`), since
 * that is what makes the Public role.
 */
import { PUBLIC_ROLE_SLUG } from "../../domains/auth/services/public-role";
import type { TestNextly } from "../../plugins/test-nextly";

/** Grants the Public role every permission in `slugs` (`create-posts`, ...). */
export async function grantPublic(
  t: TestNextly,
  slugs: readonly string[]
): Promise<void> {
  const role = (await t.nextly.roles.find({ limit: 100 })).items.find(
    found => found.slug === PUBLIC_ROLE_SLUG
  );
  if (!role) {
    throw new Error("no Public role: create the harness with seedPublic: true");
  }
  const roleId = String(role.id);
  const wanted = new Set(slugs);
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    for (const permission of found.items) {
      if (wanted.delete(permission.slug)) ids.push(String(permission.id));
    }
    if (!found.meta.hasNext) break;
  }
  // A slug that names no permission would leave the visitor refused for a
  // reason the test never meant, so it fails here instead.
  if (wanted.size > 0) {
    throw new Error(`no such permission: ${[...wanted].join(", ")}`);
  }
  const held = await t.nextly.roles.getPermissions({ id: roleId });
  await t.nextly.roles.setPermissions({
    roleId,
    permissionIds: [
      ...new Set([...held.map(permission => String(permission.id)), ...ids]),
    ],
  });
}
