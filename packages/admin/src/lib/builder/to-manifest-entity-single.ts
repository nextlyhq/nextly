/**
 * Map builder output → a `ui-schema.json` single entity. Reuses the shared
 * field mapper so the field translation stays in lockstep with collections.
 * Singles have one label; we set `labels.singular`/`plural` to the same name
 * so the manifest entity (which requires both when present) stays valid.
 *
 * @module lib/builder/to-manifest-entity-single
 */
import {
  applyCommonSettings,
  mapBuilderFieldToManifest,
  type EntityToManifestArgs,
  type ManifestEntity,
} from "./to-manifest-entity";

export function singleToManifestEntity(
  args: EntityToManifestArgs
): ManifestEntity {
  const entity: ManifestEntity = {
    slug: args.slug,
    fields: args.fields.map(mapBuilderFieldToManifest),
  };
  const { singularName } = args.settings;
  if (singularName) {
    entity.labels = { singular: singularName, plural: singularName };
  }
  applyCommonSettings(entity, args.settings);
  return entity;
}
