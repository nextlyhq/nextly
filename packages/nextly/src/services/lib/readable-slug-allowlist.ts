/**
 * The slugs a caller may READ, as a registry allowlist.
 *
 * 🔴 One implementation, because two list endpoints ask it and a disagreement
 * between them is a disclosure rather than a cosmetic difference. Collections
 * and singles both scope their listing by this, and the registries turn it
 * into a WHERE clause so the row COUNT describes the same set as the rows —
 * which is the property that breaks when a caller filters the page instead.
 *
 * 🔴 Derived from `readableEntities`, the same decision the dashboard scope
 * and every version read take, and NOT from the stored `{slug}:read` grants.
 * It used to be the grants alone, and that answered a different question
 * from the rest of the read path in both directions: a Single authorised
 * entirely by its code-defined `access.read` has no grant row to find, so the
 * list dropped an entity the caller could open and the dashboard offered a
 * card over an empty list; and a grant the code rule refuses was listed
 * anyway. `api/dashboard.ts` made this move for the dashboard first, for the
 * same reasons, and the list endpoints are the last readers that had not.
 *
 * Its own module rather than a member of `permissions`, because that is what
 * makes it testable: a function calling its neighbours through module-local
 * references cannot have them substituted, so a test would exercise the real
 * permission service and answer from a container it has no business needing.
 *
 * @module services/lib/readable-slug-allowlist
 */
import {
  readableEntities,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";

import { registeredSlugsOfKind } from "./registered-content-slugs";

/**
 * `undefined` for no filter, `[]` for nothing visible, or the readable slugs.
 *
 * The three answers are distinct and collapsing any two is a defect:
 *
 * - `undefined` — no filter. An unauthenticated caller, gated at the route
 *   layer, and nobody else.
 * - `[]` — nothing is visible. A caller the decision admits to nothing, and
 *   also a registry that could not be enumerated: an access decision fails
 *   closed, because admitting nothing is safe and admitting everything is not.
 *   Returned as an empty list rather than as `undefined`, because the
 *   registries read the difference: one means "every row", the other "no
 *   rows".
 * - a non-empty list — exactly the resources of `kind` this caller may read.
 *
 * A super admin is not a case here. The shared decision already composes the
 * bypass -- `canReadEntity` delegates a session whole to `checkAccess`, which
 * admits a super admin before it consults a rule or a grant -- so a session
 * super admin is answered with every registered slug by the same machinery
 * that answers everyone else. Deciding the bypass here as well was a second
 * super-admin path for the list endpoints alone, one the dashboard scope and
 * the version reads did not share, and a change to what the bypass means
 * would have split the lists from them again. It also keeps a key honest: an
 * API key is judged on its own stamped scope whoever owns it, and there is no
 * shortcut here for a bypass to leak through.
 */
export async function readableSlugAllowlist(
  caller: ReadAccessCaller | undefined,
  kind: "collection" | "single"
): Promise<string[] | undefined> {
  if (!caller) return undefined;

  const registry = await registeredSlugsOfKind(kind);
  if (!registry.reachable) return [];

  const readable = await readableEntities(registry.slugs, caller);
  return registry.slugs.filter(slug => readable.has(slug));
}
