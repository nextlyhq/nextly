/**
 * Codegen name collection.
 *
 * Pure helpers that derive the typed-slug unions emitted into the generated
 * `Config` interface (see {@link TypeGenerator.generateTypesFile}):
 *  - `permissionSlugs` — the CRUD and publish-lifecycle permissions
 *    auto-seeded per collection
 *    (`create|read|update|delete|publish|unpublish-<slug>`) and per single
 *    (`read|update|publish|unpublish-<slug>`)
 *    — mirroring `PermissionSeedService.seedCollectionPermissions` /
 *    `seedSinglePermissions` — plus every custom permission from
 *    {@link collectCustomPermissions} (app + plugin, D36).
 *  - `eventNames` — the lifecycle event (`plugin.initialized`), the per-collection
 *    domain events (`collection.<slug>.created|updated|deleted`), the core event
 *    families (D69 document/auth/media), and each plugin's declared custom events
 *    (`contributes.events[].name`, D9).
 *
 * Operates over the ALREADY-MERGED config (`config.collections`/`singles` include
 * plugin contributions by the time the CLI `loadConfig` returns), so plugin
 * entities are covered without re-running the schema fold here.
 *
 * @module plugins/codegen/collect-codegen-names
 */

import type { NextlyServiceConfig } from "../../di/register";
import {
  AuthEvents,
  DocumentEvents,
  MediaEvents,
} from "../../events/event-names";
import { collectCustomPermissions } from "../permissions/collect-permissions";
import type { PluginDefinition } from "../plugin-context";

export interface CodegenNames {
  /** Permission slugs (`${action}-${resource}`) — sorted + deduped. */
  permissionSlugs: string[];
  /** Event names — sorted + deduped. */
  eventNames: string[];
}

// Mirror the auto-seeder's action lists (permission-seed-service.ts). Generated
// permission-slug types come from here, so a drift shows up as a slug the app
// seeds but the types deny.
const COLLECTION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;
const SINGLE_ACTIONS = ["read", "update", "publish", "unpublish"] as const;

/**
 * Derive the permission-slug + event-name unions for codegen from the merged
 * config and resolved plugins. Pure. Reuses the single shared permission
 * collector so generated types match what boot actually seeds.
 */
export function collectCodegenNames(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): CodegenNames {
  const permissionSlugs = new Set<string>();
  const eventNames = new Set<string>();

  const collections = config.collections ?? [];
  const singles = config.singles ?? [];

  // CRUD plus the publish lifecycle, auto-seeded per collection, and the
  // per-collection domain events.
  for (const c of collections) {
    for (const action of COLLECTION_ACTIONS) {
      permissionSlugs.add(`${action}-${c.slug}`);
    }
    eventNames.add(`collection.${c.slug}.created`);
    eventNames.add(`collection.${c.slug}.updated`);
    eventNames.add(`collection.${c.slug}.deleted`);
  }

  // read/update plus the publish lifecycle, auto-seeded per single.
  for (const s of singles) {
    for (const action of SINGLE_ACTIONS) {
      permissionSlugs.add(`${action}-${s.slug}`);
    }
  }

  // Custom permissions (app config + every plugin) — the same collector boot
  // runs; it also fail-fasts on collisions, mirroring runtime validation.
  for (const perm of collectCustomPermissions(config, plugins)) {
    permissionSlugs.add(perm.slug);
  }

  // Lifecycle event + core event families.
  eventNames.add("plugin.initialized");
  for (const name of Object.values(DocumentEvents)) eventNames.add(name);
  for (const name of Object.values(AuthEvents)) eventNames.add(name);
  for (const name of Object.values(MediaEvents)) eventNames.add(name);

  // Plugin-declared custom events.
  for (const plugin of plugins) {
    for (const event of plugin.contributes?.events ?? []) {
      eventNames.add(event.name);
    }
  }

  return {
    permissionSlugs: Array.from(permissionSlugs).sort(),
    eventNames: Array.from(eventNames).sort(),
  };
}
