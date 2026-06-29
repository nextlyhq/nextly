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

import { tagPluginFields } from "./reconcile-builder-contributions";

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
 * components). `target` may be a slug or an array of slugs (applied to each). An
 * unknown target fails fast (D12). This is the EAGER form used by
 * `applyPluginSchemaContributions`; the Builder-aware boot paths instead use the
 * deferring fold so a Builder-made target is resolved later, not thrown here
 * (P8/R2). Pure: clones touched arrays.
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

/**
 * A single, fully-resolved `extend` clause — one target slug (array targets are
 * pre-expanded) plus the name of the plugin that declared it. Returned by the
 * deferring fold for targets that aren't code/plugin entities (candidate Builder
 * targets, P8/R2), then resolved against the Builder set by `resolveBuilderExtends`.
 */
export interface DeferredExtend {
  target: string;
  fields: FieldConfig[];
  owner: string;
}

/** Minimal shape an entity must have to be an extend target (slug + fields). */
export interface SchemaEntityLike {
  slug: string;
  fields?: FieldConfig[];
}

/** Builder/UI-schema entities that participate in extend resolution (P8). */
export interface BuilderEntities {
  collections?: SchemaEntityLike[];
  singles?: SchemaEntityLike[];
  components?: SchemaEntityLike[];
}

/** Result of the deferring fold: the code+plugin merged config + unresolved extends. */
export interface FoldResult {
  config: NextlyServiceConfig;
  /** Extends whose target wasn't a code/plugin entity — resolved later (P8). */
  deferredExtends: DeferredExtend[];
}

/** Flatten every plugin's `contributes.extend` into one clause per (target, plugin). */
function flattenExtends(plugins: PluginDefinition[]): DeferredExtend[] {
  const clauses: DeferredExtend[] = [];
  for (const plugin of plugins) {
    for (const clause of plugin.contributes?.extend ?? []) {
      const targets = Array.isArray(clause.target)
        ? clause.target
        : [clause.target];
      for (const target of targets) {
        clauses.push({ target, fields: clause.fields, owner: plugin.name });
      }
    }
  }
  return clauses;
}

/**
 * Apply a flat list of extend clauses to the three entity arrays (matched by slug
 * across all three). Pure: clones touched arrays. A clause whose target is not
 * found is either thrown (`onUnknown: "throw"`, D12) or collected into `deferred`
 * (`onUnknown: "collect"`) — the latter holds a target that may be a Builder
 * entity until Builder slugs are known (P8/R2).
 */
function applyExtendClauses<
  C extends Fielded,
  S extends Fielded,
  P extends Fielded,
>(
  collections: C[] | undefined,
  singles: S[] | undefined,
  components: P[] | undefined,
  clauses: DeferredExtend[],
  onUnknown: "throw" | "collect"
): {
  collections: C[];
  singles: S[];
  components: P[];
  deferred: DeferredExtend[];
} {
  const cols = [...(collections ?? [])];
  const sin = [...(singles ?? [])];
  const comp = [...(components ?? [])];
  const deferred: DeferredExtend[] = [];
  for (const { target, fields, owner } of clauses) {
    const applied =
      tryExtend(cols, target, fields, owner) ||
      tryExtend(sin, target, fields, owner) ||
      tryExtend(comp, target, fields, owner);
    if (!applied) {
      if (onUnknown === "throw") throw extendTargetUnknownError(target, owner);
      deferred.push({ target, fields, owner });
    }
  }
  return { collections: cols, singles: sin, components: comp, deferred };
}

/**
 * Rewrite relationship `relationTo` through the rename map, recursing into the
 * nested `fields` of container fields (`group`/`repeater`) so a plugin's own
 * relations follow the rename wherever they are declared, not just at the top
 * level (D54). `group` and `repeater` are the only field-builder containers
 * that nest other fields.
 */
function rewriteRelations(
  fields: FieldConfig[] | undefined,
  map: Record<string, string>
): FieldConfig[] | undefined {
  if (!fields) return fields;
  const resolve = (target: string) => map[target] ?? target;
  return fields.map(field => {
    const f = field as {
      type?: string;
      relationTo?: string | string[];
      fields?: FieldConfig[];
    };
    if (
      (f.type === "group" || f.type === "repeater") &&
      Array.isArray(f.fields)
    ) {
      return {
        ...field,
        fields: rewriteRelations(f.fields, map),
      } as FieldConfig;
    }
    if (f.type !== "relationship" || f.relationTo == null) return field;
    const relationTo = Array.isArray(f.relationTo)
      ? f.relationTo.map(resolve)
      : resolve(f.relationTo);
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
 * Apply each plugin's `renameMap` (D54), then fold the resolved
 * collections/singles/components into the config arrays (config-first, then
 * topo order). Pure. Throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a plugin-involved
 * collision (D13). Shared by the throwing and deferring folds below so both
 * agree on the merged entity set before `extend` is applied.
 */
function mergeRenamed(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): Pick<NextlyServiceConfig, "collections" | "singles" | "components"> {
  const renamed = plugins.map(p => ({
    owner: p.name,
    contributes: renamePluginContributes(p),
  }));
  return {
    collections: mergeKind(
      "collection",
      config.collections ?? [],
      renamed.map(r => ({
        owner: r.owner,
        entities: r.contributes.collections,
      }))
    ),
    singles: mergeKind(
      "single",
      config.singles ?? [],
      renamed.map(r => ({ owner: r.owner, entities: r.contributes.singles }))
    ),
    components: mergeKind(
      "component",
      config.components ?? [],
      renamed.map(r => ({ owner: r.owner, entities: r.contributes.components }))
    ),
  };
}

/**
 * @experimental Merge plugin `contributes` schema into the config. Pure — does
 * not mutate `config` or `plugins`. Applies each plugin's `renameMap` (D54)
 * before merging, then throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a plugin-
 * involved slug collision (D13) and `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for an
 * `extend` against an unknown target (D12).
 *
 * This eager form throws on ANY extend target absent from the code+plugin set.
 * Builder-aware callers (P8) use {@link applyPluginSchemaContributionsDeferred}
 * + {@link resolveBuilderExtends} instead, so a Builder target isn't mistaken
 * for a typo before Builder slugs are known (R2).
 */
export function applyPluginSchemaContributions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): NextlyServiceConfig {
  const { collections, singles, components } = mergeRenamed(config, plugins);

  // Second pass: apply `extend` over the fully-merged entity set (a plugin may
  // extend a code, own, or earlier-plugin entity). `extend[].target` is matched
  // against the merged (post-rename) slugs and is NOT itself rewritten through a
  // rename map — a plugin extending its own renamed entity must target the
  // renamed slug. (No current plugin extends its own entity.)
  const extended = applyExtends(collections, singles, components, plugins);

  return { ...config, ...extended };
}

/**
 * @experimental Builder-aware fold (P8): same merge + `extend` as
 * {@link applyPluginSchemaContributions}, but an `extend` target that isn't a
 * code/plugin entity is NOT thrown — it's returned in `deferredExtends`. The
 * caller resolves those against the Builder set (`resolveBuilderExtends`) once
 * Builder slugs are known: the CLI after `loadUiSchema`, the runtime after
 * `loadDynamicTables`. This is how extending a Builder-made collection works
 * without prematurely failing as an unknown target (R2/D3).
 */
export function applyPluginSchemaContributionsDeferred(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): FoldResult {
  const { collections, singles, components } = mergeRenamed(config, plugins);
  const r = applyExtendClauses(
    collections,
    singles,
    components,
    flattenExtends(plugins),
    "collect"
  );
  return {
    config: {
      ...config,
      collections: r.collections,
      singles: r.singles,
      components: r.components,
    },
    deferredExtends: r.deferred,
  };
}

/**
 * @experimental Apply deferred `extend` clauses (from
 * {@link applyPluginSchemaContributionsDeferred}) to the Builder/UI-schema
 * entities, matched by slug across collections/singles/components (P8/D12).
 * Pure: clones touched arrays. Throws `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for
 * any target that is in NEITHER code/plugin NOR the Builder set — a real typo.
 * On the CLI the returned (extended) entities drive the migration so the columns
 * materialize; the runtime uses it only to validate (the DB row is authoritative).
 */
export function resolveBuilderExtends(
  deferred: DeferredExtend[],
  builder: BuilderEntities
): BuilderEntities {
  // Tag merged fields with plugin provenance so the materialized Builder rows
  // (migrate output) carry source/owner/locked — the same tags the runtime
  // reconciler applies, so dev-push and migrate converge (P8).
  const tagged = deferred.map(d => ({
    ...d,
    fields: tagPluginFields(d.fields, d.owner),
  }));
  const r = applyExtendClauses(
    builder.collections,
    builder.singles,
    builder.components,
    tagged,
    "throw"
  );
  return {
    collections: r.collections,
    singles: r.singles,
    components: r.components,
  };
}

/**
 * @experimental Validate deferred extend targets at runtime (P8): each must be a
 * known slug (a Builder/UI entity loaded from the DB, where the extend columns
 * were already materialized by `migrate`). Existence-only — it does NOT re-append
 * fields (the DB row is authoritative, so re-applying would duplicate columns,
 * unlike the CLI's `resolveBuilderExtends` which materializes). Throws
 * `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for a target absent from `knownSlugs`.
 */
export function finalizeDeferredExtendTargets(
  deferred: DeferredExtend[],
  knownSlugs: Iterable<string>
): void {
  const known = new Set(knownSlugs);
  for (const d of deferred) {
    if (!known.has(d.target)) throw extendTargetUnknownError(d.target, d.owner);
  }
}
