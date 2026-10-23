/**
 * The set-up a test of checked writes needs: the seeded permissions a real boot
 * makes, accounts that hold exactly the roles a case names, and those roles.
 *
 * Driven through the Direct API as trusted server code, so a fixture is made
 * the way an application would make it. The first account an install makes
 * holds super-admin, which answers every check; callers under test are made
 * after it.
 */

import { expect } from "vitest";

import type { TestNextly } from "../../plugins/test-nextly";

/** The part of the Direct API the set-up drives, typed where the shim is not. */
interface Direct {
  users: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

function direct(t: TestNextly): Direct {
  return t.nextly as unknown as Direct;
}

/** What a real boot does before serving anything; the harness boots without it. */
export async function seedPermissions(t: TestNextly): Promise<void> {
  const seeder = t.getService("permissionSeedService") as unknown as {
    seedSystemPermissions: () => Promise<unknown>;
    seedAllCollectionPermissions: () => Promise<unknown>;
  };
  await seeder.seedSystemPermissions();
  await seeder.seedAllCollectionPermissions();
}

/** An active account holding the given roles, by id. */
export async function account(
  t: TestNextly,
  email: string,
  roles: string[] = []
): Promise<string> {
  const created = await direct(t).users.create({
    data: {
      email,
      password: "Password123!",
      name: email,
      isActive: true,
      ...(roles.length > 0 ? { roles } : {}),
    },
  });
  return created.item.id;
}

/** A role holding exactly the named, seeded permissions, by id. */
export async function role(
  t: TestNextly,
  slug: string,
  permissionSlugs: string[]
): Promise<string> {
  const seeded = await direct(t).permissions.find({ limit: 1000 });
  const ids = permissionSlugs.map(wanted => {
    const found = seeded.items.find(p => p.slug === wanted);
    expect(found, `\`${wanted}\` must be seeded`).toBeDefined();
    return found!.id;
  });
  const created = await direct(t).roles.create({
    data: { name: slug, slug, permissionIds: ids },
  });
  return created.item.id;
}
