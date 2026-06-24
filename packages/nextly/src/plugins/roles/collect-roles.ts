import type { NextlyServiceConfig } from "../../di/register";
import type { PluginRole } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

/** A role bundle resolved to its concrete, seedable shape (D67). */
export interface CollectedRole {
  slug: string;
  name: string;
  description?: string;
  /** Permission slugs (`${action}-${resource}`) this role bundles. */
  permissionSlugs: string[];
  level: number;
  /** Declaring owner — `"app"` or the plugin name (provenance for logs). */
  owner: string;
}

/** Role slugs the system owns; a plugin/app may not redeclare them. */
const RESERVED_ROLE_SLUGS = new Set(["super-admin"]);

/**
 * Fold every plugin's `contributes.roles` (and app-level `config.roles`) into a
 * deduped, collision-validated list of seedable role bundles (D67). Pure — no DB
 * access. Runs over ALL plugins incl. disabled ones so declarative roles stay
 * deterministic across environments (D49 — same policy as the permission fold).
 *
 * Throws on:
 *  - the same slug declared by two sources (duplicate-role);
 *  - a slug that collides with a reserved system role (e.g. `super-admin`).
 *
 * Permission-slug existence is validated later, at seed time (where the DB is) —
 * an unresolvable permission slug is logged and skipped, not a boot error.
 */
export function collectRoles(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): CollectedRole[] {
  const seen = new Map<string, string>(); // slug -> first owner
  const out: CollectedRole[] = [];

  const consider = (role: PluginRole, owner: string): void => {
    const { slug } = role;

    const prev = seen.get(slug);
    if (prev !== undefined) {
      throw new Error(
        `NEXTLY_ROLE_COLLISION: role slug "${slug}" is declared by both "${prev}" and "${owner}". Role slugs must be unique.`
      );
    }
    if (RESERVED_ROLE_SLUGS.has(slug)) {
      throw new Error(
        `NEXTLY_ROLE_COLLISION: "${owner}" declares role slug "${slug}", which is reserved for a built-in system role.`
      );
    }

    seen.set(slug, owner);
    out.push({
      slug,
      name: role.name,
      description: role.description,
      permissionSlugs: role.permissionSlugs ?? [],
      level: role.level ?? 0,
      owner,
    });
  };

  for (const role of config.roles ?? []) consider(role, "app");
  for (const plugin of plugins) {
    for (const role of plugin.contributes?.roles ?? []) {
      consider(role, plugin.name);
    }
  }

  return out;
}
