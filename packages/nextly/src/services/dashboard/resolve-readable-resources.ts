/**
 * What this caller may read, decided by the access layer per entity: the scope
 * every dashboard read is bounded by.
 *
 * In the dashboard services rather than an HTTP handler, because more than one
 * door asks it: the dashboard endpoints and the widget sources that answer the
 * same cards. Two copies of a scope decision agree on the day they are written
 * and drift after.
 *
 * @module services/dashboard/resolve-readable-resources
 */

import {
  readAccessCaller,
  readableEntities,
} from "../../auth/entity-read-access";
import { SETTINGS_ACTIVITY_NAMESPACES } from "../../domains/audit/settings-activity-namespaces";
import { registeredContentSlugs } from "../lib/registered-content-slugs";

import {
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "./readable-resources";

/**
 * Every name the dashboard can describe, offered for a read decision.
 *
 * Three sources, and the third is the one that is easy to miss.
 * {@link registeredContentSlugs} gives the collections and singles, so the set
 * being authorized is the set that would be counted -- it is shared with the
 * `system:versions` widget source, which bounds its cross-document read by the
 * same candidates. But the scope also bounds `/activity` and
 * `recentChanges24h`, which filter `activity_log.collection` -- and that column
 * is a FREE STRING whose namespace is deliberately wider than the registries.
 * `recordSettingsActivity` files settings mutations under names that are
 * neither a collection nor a single, so enumerating from the registries alone
 * removed every such row from the feed for every caller, super-admin included.
 * Rotating SMTP credentials is one of those rows. See
 * {@link SETTINGS_ACTIVITY_NAMESPACES}.
 *
 * Widening the CANDIDATES is not widening the answer: each name still goes to
 * `canReadEntity`, and each settings namespace has a real verdict there because
 * its `read-{name}` permission is seeded and already authorizes the
 * corresponding settings route.
 *
 * The per-collection COUNTS are unaffected by the third source.
 * `getRegisteredCollections` filters the registry list BY this scope, and
 * `filterByResource` can only ever narrow it -- a name that is not in the
 * registry cannot be added to it by appearing in the scope.
 */
async function registeredEntitySlugs(): Promise<string[]> {
  return [...SETTINGS_ACTIVITY_NAMESPACES, ...(await registeredContentSlugs())];
}

/**
 * Resolve what this caller may read, by ASKING the access layer.
 *
 * The decision is `canReadEntity`'s, taken once per registered entity, because
 * that is the only answer that agrees with what a row read will give. This used
 * to derive the set from permission SLUGS -- filtering `read-{slug}` for a key
 * and `{slug}:read` for a session -- and that is a second implementation of a
 * decision `checkAccess` already makes, which was more permissive than the
 * original in one direction and less in the other:
 *
 * - A collection whose `access.read` REFUSES the caller still has the
 *   `{slug}:read` row a slug filter admits it on, so `/stats` disclosed its
 *   count and `/activity` its entry titles, user names and emails, while
 *   `GET /api/collections/{slug}` correctly answered 403.
 * - A collection authorized ENTIRELY in code has no permission row to find, so
 *   a slug filter dropped a collection the caller can actually open.
 *
 * Asking removes both, and with them the two hand-rolled parsers and their
 * subtleties: there is no prefix to strip by length so that `read-site-settings`
 * keeps naming `site-settings`, because nothing is parsed. There is no
 * super-admin branch either -- `checkAccess` short-circuits on `isSuperAdmin`
 * before it reads any rule, so the bypass arrives through the same call as
 * everything else.
 *
 * One consequence is deliberate and worth naming: a super-admin's scope is now
 * the ENUMERATED set of registered entities rather than the unbounded `all`, so
 * an `activity_log` row naming a collection that is no longer registered is
 * filtered out. An unregistered slug has no rule and no registry entry to
 * decide against, and admitting what cannot be judged is the inversion this
 * whole endpoint was fixed to remove.
 */
export async function resolveReadableResources(
  caller: ReadCaller
): Promise<ReadableResources> {
  const slugs = await registeredEntitySlugs();
  return someResources(await readableEntities(slugs, readAccessCaller(caller)));
}
