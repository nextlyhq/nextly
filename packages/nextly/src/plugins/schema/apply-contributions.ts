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

import type { FieldConfig } from "../../collections/fields/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";
import {
  extendFieldDuplicateError,
  extendTargetUnknownError,
  renameUnknownTargetError,
  slugCollisionError,
} from "../schema-error";

type EntityKind = "collection" | "single" | "component";

type RenamedContributes = Pick<
  NonNullable<PluginDefinition["contributes"]>,
  "collections" | "singles" | "components"
>;

interface Slugged {
  slug: string;
}

interface Fielded extends Slugged {
  fields?: FieldConfig[];
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
 * Append `fields` to the entity in `arr` whose slug is `target`, returning a NEW
 * array with the touched entity cloned (purity). Returns false if not found.
 */
function tryExtend<T extends Fielded>(
  arr: T[],
  target: string,
  fields: FieldConfig[],
  owner: string
): boolean {
  const idx = arr.findIndex(e => e.slug === target);
  if (idx === -1) return false;
  const existing = arr[idx].fields ?? [];
  const seen = new Set(
    existing.map(f => (f as { name?: string }).name?.toLowerCase())
  );
  for (const f of fields) {
    const name = (f as { name?: string }).name;
    if (name && seen.has(name.toLowerCase())) {
      throw extendFieldDuplicateError(target, name, owner);
    }
    if (name) seen.add(name.toLowerCase());
  }
  arr[idx] = { ...arr[idx], fields: [...existing, ...fields] };
  return true;
}

/**
 * Apply every plugin's `contributes.extend` (D12): append the declared fields to
 * the target entity (found by slug across the merged collections/singles/
 * components). `target` may be a slug or an array of slugs (applied to each).
 * An unknown target fails fast (D12) — this is also how extending a Builder-only
 * entity fails loud during the code-first gap (R2). Pure: clones touched arrays.
 */
function applyExtends(
  collections: NextlyServiceConfig["collections"],
  singles: NextlyServiceConfig["singles"],
  components: NextlyServiceConfig["components"],
  plugins: PluginDefinition[]
): Pick<NextlyServiceConfig, "collections" | "singles" | "components"> {
  const cols = [...(collections ?? [])];
  const sin = [...(singles ?? [])];
  const comp = [...(components ?? [])];

  for (const plugin of plugins) {
    for (const clause of plugin.contributes?.extend ?? []) {
      const targets = Array.isArray(clause.target)
        ? clause.target
        : [clause.target];
      for (const target of targets) {
        const applied =
          tryExtend(cols, target, clause.fields, plugin.name) ||
          tryExtend(sin, target, clause.fields, plugin.name) ||
          tryExtend(comp, target, clause.fields, plugin.name);
        if (!applied) throw extendTargetUnknownError(target, plugin.name);
      }
    }
  }

  return { collections: cols, singles: sin, components: comp };
}

/** Rewrite a relationship field's `relationTo` through the rename map. */
function rewriteRelations(
  fields: FieldConfig[] | undefined,
  map: Record<string, string>
): FieldConfig[] | undefined {
  if (!fields) return fields;
  return fields.map(field => {
    const rel = field as { type?: string; relationTo?: string | string[] };
    if (rel.type !== "relationship" || rel.relationTo == null) return field;
    const resolve = (target: string) => map[target] ?? target;
    const relationTo = Array.isArray(rel.relationTo)
      ? rel.relationTo.map(resolve)
      : resolve(rel.relationTo);
    return { ...field, relationTo } as FieldConfig;
  });
}

/** Clone an entity with its slug renamed + own `relationTo` references rewritten. */
function renameEntity<T extends Fielded>(
  entity: T,
  map: Record<string, string>
): T {
  return {
    ...entity,
    slug: map[entity.slug] ?? entity.slug,
    fields: rewriteRelations(entity.fields, map),
  };
}

/**
 * Apply a plugin's `renameMap` (D54): rename its contributed entity slugs and
 * rewrite its OWN internal `relationTo` to the renamed slugs (a target that is
 * not a renamed own slug is left untouched). Validates every rename key is a
 * contributed slug, else `NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET`. Pure; returns
 * the plugin's declared contributes unchanged when there is no rename map.
 */
function renamePluginContributes(plugin: PluginDefinition): RenamedContributes {
  const contributes = plugin.contributes;
  const map = plugin.renameMap;
  if (!contributes || !map || Object.keys(map).length === 0) {
    return {
      collections: contributes?.collections,
      singles: contributes?.singles,
      components: contributes?.components,
    };
  }

  const ownSlugs = new Set<string>([
    ...(contributes.collections ?? []).map(e => e.slug),
    ...(contributes.singles ?? []).map(e => e.slug),
    ...(contributes.components ?? []).map(e => e.slug),
  ]);
  for (const key of Object.keys(map)) {
    if (!ownSlugs.has(key)) throw renameUnknownTargetError(key, plugin.name);
  }

  return {
    collections: contributes.collections?.map(e => renameEntity(e, map)),
    singles: contributes.singles?.map(e => renameEntity(e, map)),
    components: contributes.components?.map(e => renameEntity(e, map)),
  };
}

/**
 * @experimental Merge plugin `contributes` schema into the config. Pure — does
 * not mutate `config` or `plugins`. Applies each plugin's `renameMap` (D54)
 * before merging, then throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a plugin-
 * involved slug collision (D13) and `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for an
 * `extend` against an unknown target (D12).
 */
export function applyPluginSchemaContributions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): NextlyServiceConfig {
  // Apply renames once per plugin (declared slugs → resolved), then fold the
  // resolved entities into the merged config.
  const renamed = plugins.map(p => ({
    owner: p.name,
    contributes: renamePluginContributes(p),
  }));

  const collections = mergeKind(
    "collection",
    config.collections ?? [],
    renamed.map(r => ({ owner: r.owner, entities: r.contributes.collections }))
  );
  const singles = mergeKind(
    "single",
    config.singles ?? [],
    renamed.map(r => ({ owner: r.owner, entities: r.contributes.singles }))
  );
  const components = mergeKind(
    "component",
    config.components ?? [],
    renamed.map(r => ({ owner: r.owner, entities: r.contributes.components }))
  );

  // Second pass: apply `extend` over the fully-merged entity set (a plugin may
  // extend a code, own, or earlier-plugin entity).
  const extended = applyExtends(collections, singles, components, plugins);

  return { ...config, ...extended };
}
