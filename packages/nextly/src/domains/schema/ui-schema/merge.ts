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
    })),
    status: entity.status === true,
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
