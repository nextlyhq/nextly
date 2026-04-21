/**
 * Seed the three blog content roles: admin, editor, author.
 *
 * Idempotent: skips any role whose slug already exists in the DB, so
 * re-running the seed after adding a role manually in the admin UI
 * won't clobber it.
 *
 * Fine-grained permission assignment is intentionally not done here.
 * Permissions are auto-generated when collections register (see
 * PermissionSeedService in nextly core) and are wired to the
 * `super-admin` role on first boot. For custom roles, configure
 * permission rules via the admin UI at `/admin/roles/<slug>` or
 * programmatically with `nextly.roles.setPermissions({ roleId, ... })`.
 * We keep this seed minimal so template users have three clearly-named
 * buckets to start from, without locking in a permission matrix that
 * would be fragile across nextly versions.
 *
 * Role hierarchy via `level`: higher = more privilege. Super-admin
 * lives above these (seeded by nextly core itself).
 */

import type { getNextly } from "@revnixhq/nextly";

type Nextly = Awaited<ReturnType<typeof getNextly>>;

interface RoleDef {
  slug: string;
  name: string;
  description: string;
  level: number;
}

const ROLES: RoleDef[] = [
  {
    slug: "admin",
    name: "Administrator",
    description:
      "Full access to all content, taxonomy, media, and user management for this site.",
    level: 100,
  },
  {
    slug: "editor",
    name: "Editor",
    description:
      "Can create, edit, and publish any post. Manages categories, tags, and media.",
    level: 50,
  },
  {
    slug: "author",
    name: "Author",
    description:
      "Can draft and edit their own posts. Reads published posts and taxonomy.",
    level: 10,
  },
];

export async function seedRoles(
  nextly: Nextly
): Promise<Record<string, string>> {
  const roleIdBySlug: Record<string, string> = {};

  for (const role of ROLES) {
    const existing = await nextly.roles
      .find({ limit: 1, page: 1, search: role.slug })
      .catch(() => ({ docs: [] as Array<{ slug?: string; id?: string }> }));

    const match = existing.docs.find(
      r => (r as { slug?: string }).slug === role.slug
    );
    if (match) {
      roleIdBySlug[role.slug] = (match as { id: string }).id;
      continue;
    }

    const created = await nextly.roles.create({
      data: {
        name: role.name,
        slug: role.slug,
        description: role.description,
        level: role.level,
      },
    });
    roleIdBySlug[role.slug] = created.id as string;
    console.log(`  Seeded role: ${role.slug}`);
  }

  return roleIdBySlug;
}
