/**
 * What the roles screen shows for each collection and Single.
 *
 * `GET /roles/screen` answers, for every registered collection and Single:
 * its slug and kind, the label the admin shows it by, the plugin that
 * contributes it (or none), and the access operations whose code declares a
 * rule. The screen sets one level per entity from this, and marks an entity
 * whose code also narrows who may act on it.
 *
 * The entity list and the labels come from one read of each registry, a
 * projection of only the slug and label columns, so the two cannot
 * describe different moments: a slug added or removed between two separate
 * reads would otherwise be left out, or listed under no label. Each slug's kind
 * is decided by `contentKinds`, the precedence `registeredContentSnapshot()`
 * applies for `GET /me/capabilities`.
 *
 * @module api/roles-screen
 */

import { declaresRule } from "../auth/access/decide";
import {
  COLLECTION_ACTIONS,
  SINGLE_ACTIONS,
} from "../auth/access/route-gate-adapters";
import { getRBACService } from "../auth/code-access";
import { getService } from "../di";
import { collectPluginContributedSlugs } from "../domains/webhooks/recording-provenance";
import { getCachedNextly } from "../init";
import { bootedPlugins } from "../route-handler/auth-handler";
import { contentKinds } from "../services/lib/registered-content-slugs";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondList, SKIP_DATE_FORMATTING_HEADER } from "./response-shapes";
import { requireRoutePermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/** One collection or Single, as the roles screen shows it. */
export interface RolesScreenEntity {
  slug: string;
  kind: "collection" | "single";
  /** The label the admin shows it by; a Single has one form only. */
  labels: { singular: string; plural?: string };
  /** The plugin that contributes it, or null for the app's own. */
  plugin: string | null;
  /** The operations whose code-defined access declares a rule. */
  declaredRules: string[];
}

/**
 * The plugin each contributed slug belongs to, by kind.
 *
 * Membership is the plugins' own contribution lists, read through
 * `collectPluginContributedSlugs`, which resolves each to the slug that lands
 * in the config, renames included; it is asked one plugin at a time so each
 * slug keeps its plugin's name. `admin.group` is not read: it is a display
 * label a plugin may leave out or share.
 */
function pluginsBySlug(kind: "collections" | "singles"): Map<string, string> {
  const owners = new Map<string, string>();
  // The plugins the runtime booted with, which an app whose route was created
  // without a config still has.
  for (const plugin of bootedPlugins()) {
    for (const slug of collectPluginContributedSlugs([plugin], kind)) {
      if (!owners.has(slug)) owners.set(slug, plugin.name);
    }
  }
  return owners;
}

export const getRolesScreen = withErrorHandler(async (req: Request) => {
  // The screen edits roles, so it asks what reading the roles list asks.
  await requireRoutePermission(req, "read", "roles");
  await getCachedNextly();

  // A registry that cannot be read refuses the request rather than leaving
  // its entities unlisted, read as having no access to set.
  const [collections, singles] = await Promise.all([
    getService("collectionRegistryService").getAllLabels(),
    getService("singleRegistryService").getAllLabels(),
  ]);
  const kinds = contentKinds(
    collections.map(collection => collection.slug),
    singles.map(single => single.slug)
  );
  const pluginCollections = pluginsBySlug("collections");
  const pluginSingles = pluginsBySlug("singles");
  const rules = getRBACService();

  /** The operations whose code declares a rule for `slug`. */
  const declaredRulesOf = (
    slug: string,
    operations: readonly (typeof COLLECTION_ACTIONS)[number][]
  ): string[] => {
    const target = rules?.getRegisteredTarget(slug);
    return target
      ? operations.filter(operation => declaresRule(target, operation))
      : [];
  };

  const items: RolesScreenEntity[] = [];
  for (const { slug, labels } of collections) {
    if (kinds.get(slug) !== "collection") continue;
    items.push({
      slug,
      kind: "collection",
      labels,
      plugin: pluginCollections.get(slug) ?? null,
      declaredRules: declaredRulesOf(slug, COLLECTION_ACTIONS),
    });
  }
  for (const { slug, label } of singles) {
    // A slug a collection also holds is that collection's.
    if (kinds.get(slug) !== "single") continue;
    items.push({
      slug,
      kind: "single",
      labels: { singular: label },
      plugin: pluginSingles.get(slug) ?? null,
      declaredRules: declaredRulesOf(slug, SINGLE_ACTIONS),
    });
  }
  items.sort((a, b) => a.slug.localeCompare(b.slug));

  return respondList(
    items,
    {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
    {
      // Labels are configuration, not stored dates: one that happens to read
      // as a timestamp is shown as registered, not rewritten into a timezone.
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        [SKIP_DATE_FORMATTING_HEADER]: "1",
      },
    }
  );
});
