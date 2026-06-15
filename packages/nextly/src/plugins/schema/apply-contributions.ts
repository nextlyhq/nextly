/**
 * Fold plugin schema contributions into the merged config (code-first lane).
 *
 * Pure function: appends each plugin's `contributes.{collections,singles,
 * components}` to the config's own arrays so the downstream merge/migration/
 * sync machinery treats them like ordinary code-first entities (D3/D12). Runs
 * over ALL plugins — including disabled ones — so declarative schema stays
 * deterministic across environments (D49).
 *
 * Slug collisions that involve a plugin-contributed entity are a fail-fast boot
 * error (D13). Pre-existing code-vs-code duplicates are left untouched so the
 * plugin-free path is byte-for-byte unchanged (decisions doc G2). Collections,
 * singles, and components are independent namespaces (distinct table prefixes),
 * so a collection and a single may share a slug.
 *
 * Called at the same post-`setup` seam by both the runtime boot
 * (`di/register.ts`) and the CLI (`cli/utils/config-loader.ts`), which is what
 * keeps the two paths in agreement (D50).
 *
 * @module plugins/schema/apply-contributions
 */

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";
import { slugCollisionError } from "../schema-error";

type EntityKind = "collection" | "single" | "component";

interface Slugged {
  slug: string;
}

interface PluginEntry<T> {
  owner: string;
  entities: readonly T[] | undefined;
}

/**
 * Merge one entity kind: code entities first (owner `code`), then each plugin's
 * contributions in resolved order. Throws on any slug already owned by a
 * different source once a plugin is involved.
 */
function mergeKind<T extends Slugged>(
  kind: EntityKind,
  codeEntities: readonly T[],
  pluginEntries: ReadonlyArray<PluginEntry<T>>
): T[] {
  const merged: T[] = [...codeEntities];
  const owners = new Map<string, string>();
  for (const entity of codeEntities) {
    // First code owner wins; pre-existing code-vs-code duplicates are not our
    // concern here (G2) — keep today's behavior.
    if (!owners.has(entity.slug)) owners.set(entity.slug, "code");
  }

  for (const { owner, entities } of pluginEntries) {
    for (const entity of entities ?? []) {
      const existing = owners.get(entity.slug);
      if (existing !== undefined) {
        throw slugCollisionError(kind, entity.slug, [existing, owner]);
      }
      owners.set(entity.slug, owner);
      merged.push(entity);
    }
  }

  return merged;
}

/**
 * @experimental Merge plugin `contributes` schema into the config. Pure — does
 * not mutate `config` or `plugins`. Throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a
 * plugin-involved slug collision (D13).
 */
export function applyPluginSchemaContributions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): NextlyServiceConfig {
  const collections = mergeKind(
    "collection",
    config.collections ?? [],
    plugins.map(p => ({ owner: p.name, entities: p.contributes?.collections }))
  );
  const singles = mergeKind(
    "single",
    config.singles ?? [],
    plugins.map(p => ({ owner: p.name, entities: p.contributes?.singles }))
  );
  const components = mergeKind(
    "component",
    config.components ?? [],
    plugins.map(p => ({ owner: p.name, entities: p.contributes?.components }))
  );

  return { ...config, collections, singles, components };
}
