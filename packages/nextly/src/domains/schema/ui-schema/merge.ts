/**
 * Merge code-first and UI-built entities into one set per type (spec §4.11).
 *
 * Code-first wins on slug collision: a UI entity whose slug already exists in
 * the code config is dropped (and reported via `droppedUiSlugs` so the caller
 * can warn). The result feeds the existing `buildDesiredSnapshotFromConfig` /
 * `generateMigration` — no new snapshot logic.
 *
 * @module domains/schema/ui-schema/merge
 * @since v0.0.3-alpha (Plan D2)
 */
import type { FieldConfig } from "../../../collections/fields/types";
import {
  type BuilderEntities,
  type DeferredExtend,
  resolveBuilderExtends,
  type SchemaEntityLike,
} from "../../../plugins/schema/apply-contributions";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import type { MinimalConfigEntity } from "../migrate-create/generate";

export interface MergeUiEntitiesArgs {
  codeCollections: MinimalConfigEntity[];
  codeSingles: MinimalConfigEntity[];
  codeComponents: MinimalConfigEntity[];
  manifest: UiSchemaManifest;
}

export interface MergeUiEntitiesResult {
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  /** UI slugs dropped because a code entity already owns that slug. */
  droppedUiSlugs: string[];
}

function uiToMinimal(
  entity: UiSchemaEntity,
  prefix: "dc_" | "single_" | "comp_"
): MinimalConfigEntity {
  return {
    slug: entity.slug,
    tableName: `${prefix}${entity.slug.replace(/-/g, "_")}`,
    fields: entity.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      hasMany: f.hasMany,
      relationTo: f.relationTo,
      unique: f.unique,
      index: f.index,
      localized: f.localized,
    })),
    status: entity.status === true,
    localized: entity.localized === true,
  };
}

function mergeType(
  code: MinimalConfigEntity[],
  ui: UiSchemaEntity[],
  prefix: "dc_" | "single_" | "comp_",
  dropped: string[]
): MinimalConfigEntity[] {
  const codeSlugs = new Set(code.map(c => c.slug));
  const merged = [...code];
  for (const e of ui) {
    if (codeSlugs.has(e.slug)) {
      dropped.push(e.slug);
      continue;
    }
    merged.push(uiToMinimal(e, prefix));
  }
  return merged;
}

/**
 * Project a parsed ui-schema manifest into the `BuilderEntities` shape the plugin
 * fold consumes for extend/relation resolution (P8). Only slug + fields are
 * needed (`resolveBuilderExtends`/`finalizeRelationTargets` read those); the
 * field shapes are structurally compatible with `FieldConfig` for that purpose.
 */
export function manifestToBuilderEntities(
  manifest: UiSchemaManifest
): BuilderEntities {
  const toEntity = (e: UiSchemaEntity): SchemaEntityLike => ({
    slug: e.slug,
    fields: e.fields as unknown as FieldConfig[],
  });
  return {
    collections: manifest.collections.map(toEntity),
    singles: manifest.singles.map(toEntity),
    components: manifest.components.map(toEntity),
  };
}

/**
 * Materialize plugin `contributes.extend` clauses that target Builder-made
 * entities (P8): append the deferred extend fields to the matching ui-schema
 * entity (by slug, across collections/singles/components), preserving every
 * other property (labels, admin, status…) via the shared `resolveBuilderExtends`
 * fold. The returned manifest then drives BOTH the migration table diff
 * (`mergeUiEntities` → `generateMigration` emits the ADD COLUMN) AND the
 * `dynamic_collections.fields` metadata upsert (so the runtime rebuilds the
 * table with the extra columns). Throws `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN`
 * if a deferred target matches no Builder entity (a real typo — already caught
 * at config load, re-checked here defensively). Pure.
 */
export function applyDeferredExtendsToManifest(
  manifest: UiSchemaManifest,
  deferred: DeferredExtend[]
): UiSchemaManifest {
  if (deferred.length === 0) return manifest;
  // ui-schema `FieldNode`s are structurally compatible with what the extend
  // resolver reads (slug + field names); cast across the field-shape boundary.
  const resolved = resolveBuilderExtends(deferred, {
    collections: manifest.collections as unknown as SchemaEntityLike[],
    singles: manifest.singles as unknown as SchemaEntityLike[],
    components: manifest.components as unknown as SchemaEntityLike[],
  });
  return {
    ...manifest,
    collections: resolved.collections as unknown as UiSchemaEntity[],
    singles: resolved.singles as unknown as UiSchemaEntity[],
    components: resolved.components as unknown as UiSchemaEntity[],
  };
}

export function mergeUiEntities(
  args: MergeUiEntitiesArgs
): MergeUiEntitiesResult {
  const droppedUiSlugs: string[] = [];
  return {
    collections: mergeType(
      args.codeCollections,
      args.manifest.collections,
      "dc_",
      droppedUiSlugs
    ),
    singles: mergeType(
      args.codeSingles,
      args.manifest.singles,
      "single_",
      droppedUiSlugs
    ),
    components: mergeType(
      args.codeComponents,
      args.manifest.components,
      "comp_",
      droppedUiSlugs
    ),
    droppedUiSlugs,
  };
}
