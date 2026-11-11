/**
 * Whose entities a list of collections, Singles or field groups shows: the
 * site's own, or the plugins'.
 *
 * The admin lists a plugin's entities under that plugin rather than among the
 * site's content. Asked as a query condition rather than by narrowing a page
 * the client was already sent, so each list's count describes its own rows.
 *
 * @module dispatcher/handlers/list-owner
 */
import { NextlyError } from "../../errors";
import { pluginEntitySlugs } from "../../plugins/admin-meta";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { getHandlerConfig } from "../../route-handler/auth-handler";

/** The two owners a list can be asked for. */
const LIST_OWNERS = ["site", "plugins"] as const;

export type ListOwner = (typeof LIST_OWNERS)[number];

/** The kinds of entity a plugin contributes, as `pluginEntitySlugs` names them. */
export type OwnedEntityKind = "collections" | "singles" | "fieldGroups";

/**
 * The `owner` list parameter: `site`, `plugins`, or absent (no constraint,
 * as before the parameter existed). Anything else is refused, so a misspelt
 * owner does not silently list everything.
 */
export function readListOwner(raw: string | undefined): ListOwner | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!(LIST_OWNERS as readonly string[]).includes(raw)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "owner",
          code: "INVALID_VALUE",
          message: `Must be one of: ${LIST_OWNERS.join(", ")}.`,
        },
      ],
      logContext: { reason: "unknown list owner", owner: raw },
    });
  }
  return raw as ListOwner;
}

/**
 * Every slug the installed plugins register entities of this kind under, the
 * host's renames applied. Disabled plugins count: their entities are still
 * served, and still theirs.
 */
export function pluginOwnedSlugs(
  kind: OwnedEntityKind,
  plugins: readonly PluginDefinition[]
): string[] {
  const owned = new Set<string>();
  for (const plugin of plugins) {
    for (const slug of pluginEntitySlugs(plugin)[kind]) owned.add(slug);
  }
  return [...owned];
}

/**
 * The slug lists a list query takes for an owner, from the reader's
 * allowlist (`undefined` for no allowlist) and the plugins' slugs.
 *
 * Neither owner ever widens what the reader may see:
 * - `plugins` narrows the allowlist to the plugins' slugs, so a reader allowed
 *   none of them gets an empty allowlist, which lists nothing;
 * - `site` keeps the allowlist as it was and denies the plugins' slugs;
 * - no owner passes the allowlist through and denies nothing.
 */
export function ownerSlugLists(
  owner: ListOwner | undefined,
  pluginSlugs: readonly string[],
  allowlist: string[] | undefined
): { slugAllowlist?: string[]; slugDenylist?: string[] } {
  if (owner === "plugins") {
    const owned = new Set(pluginSlugs);
    return {
      slugAllowlist:
        allowlist === undefined
          ? [...pluginSlugs]
          : allowlist.filter(slug => owned.has(slug)),
    };
  }
  if (owner === "site") {
    return { slugAllowlist: allowlist, slugDenylist: [...pluginSlugs] };
  }
  return { slugAllowlist: allowlist };
}

/**
 * The slug lists a list handler hands its registry for an owner, the
 * plugins' slugs read from the installed plugins only when an owner asks.
 */
export function slugListsForOwner(
  owner: ListOwner | undefined,
  kind: OwnedEntityKind,
  allowlist: string[] | undefined
): { slugAllowlist?: string[]; slugDenylist?: string[] } {
  const pluginSlugs = owner
    ? pluginOwnedSlugs(kind, getHandlerConfig()?.plugins ?? [])
    : [];
  return ownerSlugLists(owner, pluginSlugs, allowlist);
}
