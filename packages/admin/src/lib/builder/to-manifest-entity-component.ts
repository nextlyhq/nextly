/**
 * Map builder output → a `ui-schema.json` component entity. Reuses the shared
 * field mapper so the field translation stays in lockstep with
 * collections/singles. Components have one label; we set
 * `labels.singular`/`plural` to the same name to keep the manifest entity
 * (which requires both when present) valid.
 *
 * @module lib/builder/to-manifest-entity-component
 */
import {
  applyCommonSettings,
  mapBuilderFieldToManifest,
  type EntityToManifestArgs,
  type ManifestEntity,
} from "./to-manifest-entity";

export function componentToManifestEntity(
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
