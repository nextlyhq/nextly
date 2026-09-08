/**
 * The slugs a caller may READ, as a registry allowlist.
 *
 * 🔴 One implementation, because two list endpoints ask it and a disagreement
 * between them is a disclosure rather than a cosmetic difference. Collections
 * and singles both scope their listing by this, and the registries turn it
 * into a WHERE clause so the row COUNT describes the same set as the rows —
 * which is the property that breaks when a caller filters the page instead.
 *
 * Its own module rather than a member of `permissions`, because that is what
 * makes it testable: a function calling its neighbours through module-local
 * references cannot have them substituted, so a test would exercise the real
 * permission service and answer from a container it has no business needing.
 *
 * @module services/lib/readable-slug-allowlist
 */
import { isSuperAdmin, listEffectivePermissions } from "./permissions";

/**
 * `undefined` for no filter, `[]` for nothing visible, or the readable slugs.
 *
 * The three answers are distinct and collapsing any two is a defect:
 *
 * - `undefined` — no filter. An unauthenticated caller, gated at the route
 *   layer, and a super admin, who may see everything.
 * - `[]` — nothing is visible. A caller holding no read grant at all. Returned
 *   as an empty list rather than as `undefined`, because the registries read
 *   the difference: one means "every row", the other means "no rows".
 * - a non-empty list — exactly the resources this caller may read.
 *
 * Derived from the `{resource}:{action}` pairs the permission service already
 * publishes, so a change to how a grant is spelled reaches both endpoints.
 */
export async function readableSlugAllowlist(
  userId: string | undefined
): Promise<string[] | undefined> {
  if (!userId) return undefined;
  if (await isSuperAdmin(userId)) return undefined;

  const permissionPairs = await listEffectivePermissions(userId);
  return Array.from(
    new Set(
      permissionPairs
        .filter(pair => pair.endsWith(":read"))
        .map(pair => pair.split(":")[0])
    )
  );
}
