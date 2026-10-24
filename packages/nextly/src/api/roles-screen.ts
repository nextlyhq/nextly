/**
 * What the roles screen shows for each collection and Single.
 *
 * `GET /roles/screen` answers, for every registered collection and Single:
 * its slug and kind, the label the admin shows it by, the plugin that
 * contributes it (or none), and the access operations whose code declares a
 * rule. The screen sets one level per entity from this, and marks an entity
 * whose code also narrows who may act on it.
 *
 * The entity list is the registered content, enumerated once by
 * `registeredContentSnapshot()`: the same list `GET /me/capabilities` answers
 * over. Labels and admin options come from a projection of the registries
 * that reads only those columns.
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
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getHandlerConfig } from "../route-handler/auth-handler";
import { registeredContentSnapshot } from "../services/lib/registered-content-slugs";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondList } from "./response-shapes";
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
  for (const plugin of getHandlerConfig()?.plugins ?? []) {
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

  const { kinds, degraded } = await registeredContentSnapshot();
  // The screen sets a level for EVERY entity, so a registry that could not be
  // enumerated would leave some unlisted, read as having no access to set.
  if (degraded) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "A content registry could not be enumerated, so the roles screen would list only some entities.",
    });
  }

  const [collections, singles] = await Promise.all([
    getService("collectionRegistryService").getAllPresentations(),
    getService("singleRegistryService").getAllPresentations(),
  ]);
  const collectionBySlug = new Map(collections.map(c => [c.slug, c]));
  const singleBySlug = new Map(singles.map(s => [s.slug, s]));
  const pluginCollections = pluginsBySlug("collections");
  const pluginSingles = pluginsBySlug("singles");
  const rules = getRBACService();

  const items: RolesScreenEntity[] = [];
  for (const [slug, kind] of kinds) {
    const target = rules?.getRegisteredTarget(slug);
    const operations =
      kind === "collection" ? COLLECTION_ACTIONS : SINGLE_ACTIONS;
    const declaredRules = target
      ? operations.filter(operation => declaresRule(target, operation))
      : [];
    if (kind === "collection") {
      // A slug registered between the two reads has no presentation yet; it
      // is named by its slug rather than left out.
      const labels = collectionBySlug.get(slug)?.labels ?? {
        singular: slug,
        plural: slug,
      };
      items.push({
        slug,
        kind,
        labels,
        plugin: pluginCollections.get(slug) ?? null,
        declaredRules,
      });
    } else {
      items.push({
        slug,
        kind,
        labels: { singular: singleBySlug.get(slug)?.label ?? slug },
        plugin: pluginSingles.get(slug) ?? null,
        declaredRules,
      });
    }
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
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
