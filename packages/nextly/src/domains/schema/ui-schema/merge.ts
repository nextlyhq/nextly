/**
 * Merge code-first and UI-built entities into one set per type.
 *
 * Code-first wins on slug collision: a UI entity whose slug already exists in
 * the code config is dropped (and reported via `shadowed`, with its kind, so the
 * caller can warn). The result feeds the existing `buildDesiredSnapshotFromConfig` /
 * `generateMigration` — no new snapshot logic.
 *
 * @module domains/schema/ui-schema/merge
 * @since v0.0.3-alpha
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
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { settingsOf } from "../migrate-create/entity-settings";
import type {
  MinimalConfigEntity,
  MinimalConfigField,
} from "../migrate-create/generate";

export interface MergeUiEntitiesArgs {
  codeCollections: MinimalConfigEntity[];
  codeSingles: MinimalConfigEntity[];
  codeComponents: MinimalConfigEntity[];
  manifest: UiSchemaManifest;
}

/** The three kinds of entity the Builder makes, as the snapshot's settings record names them. */
export type BuilderEntityKind = "collection" | "single" | "fieldGroup";

/** A Builder entity left out because a code-first entity of its kind has its slug. */
export interface ShadowedBuilderEntity {
  kind: BuilderEntityKind;
  slug: string;
}

export interface MergeUiEntitiesResult {
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  /**
   * Builder entities dropped because a code-first entity of the same kind owns their slug, each
   * with its kind: shadowing is per kind, so a caller naming one must say which kind it is.
   */
  shadowed: ShadowedBuilderEntity[];
  /**
   * The Builder's entries no code-first entity of their kind shadows, as the definition holds
   * them: the ones the merged lists carry. Readers that judge the definition or write its
   * registry rows take these, so the shadowing is decided here alone.
   */
  surviving: {
    collections: UiSchemaEntity[];
    singles: UiSchemaEntity[];
    components: UiSchemaEntity[];
  };
}

/**
 * A UI-built entity in the shape the diff engine reads.
 *
 * Its fields are handed over whole, as they are for a code-first entity: the
 * column descriptor reads keys a chosen list would have to be kept in step
 * with (`virtual`, `options`, `dbType`, `validation`), and a key left out is a
 * column described differently from the one dev push builds.
 *
 * It carries its manifest entry as its settings, marked as the Builder's, as a
 * code-first entity carries its config entry (`toMinimalEntities`). The mark is
 * also what picks the Builder's column rule (`columnOriginOf` in `generate.ts`),
 * so it is set here, where every reader reduces a manifest entry, rather than
 * by each reader afterwards: a reader that skipped that step described a
 * Builder table by the code-first rule, which on MySQL bounds a text column
 * the Builder made unbounded.
 */
export function uiToMinimal(
  entity: UiSchemaEntity,
  prefix: "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix
): MinimalConfigEntity {
  return {
    slug: entity.slug,
    tableName: `${prefix}${entity.slug.replace(/-/g, "_")}`,
    // A group with no name only lays its fields out, and the column rule reads it as the code-first
    // config's is read (`toMinimalEntities` hands its entries over the same way): the definition's
    // field type allows one, which the diff engine's field type does not spell.
    fields: [...entity.fields] as MinimalConfigField[],
    status: entity.status === true,
    localized: entity.localized === true,
    settings: { source: "builder", settings: settingsOf(entity, "builder") },
  };
}

function mergeType(
  code: MinimalConfigEntity[],
  ui: UiSchemaEntity[],
  prefix: "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix,
  kind: BuilderEntityKind,
  shadowed: ShadowedBuilderEntity[],
  surviving: UiSchemaEntity[]
): MinimalConfigEntity[] {
  const codeSlugs = new Set(code.map(c => c.slug));
  const merged = [...code];
  for (const e of ui) {
    if (codeSlugs.has(e.slug)) {
      shadowed.push({ kind, slug: e.slug });
      continue;
    }
    surviving.push(e);
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
  const shadowed: ShadowedBuilderEntity[] = [];
  const surviving: MergeUiEntitiesResult["surviving"] = {
    collections: [],
    singles: [],
    components: [],
  };
  return {
    collections: mergeType(
      args.codeCollections,
      args.manifest.collections,
      "dc_",
      "collection",
      shadowed,
      surviving.collections
    ),
    singles: mergeType(
      args.codeSingles,
      args.manifest.singles,
      "single_",
      "single",
      shadowed,
      surviving.singles
    ),
    components: mergeType(
      args.codeComponents,
      args.manifest.components,
      STORAGE_FORMAT.tablePrefix,
      "fieldGroup",
      shadowed,
      surviving.components
    ),
    shadowed,
    surviving,
  };
}
