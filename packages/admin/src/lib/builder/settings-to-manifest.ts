/**
 * Map the builder's settings snapshot (`BuilderSettingsValues`) → a complete
 * `ui-schema.json` `ManifestEntity`. The single chokepoint both edit pages use
 * from BOTH their save paths (field-change + settings-only), so the
 * Draft/Published `status` flag can never again be dropped on the way to
 * ui-schema.json. `status` is passed explicitly (true OR false, never
 * undefined) so the dev-write full-replace can turn the lifecycle back off.
 *
 * @module lib/builder/settings-to-manifest
 */
import type { BuilderSettingsValues } from "../../components/features/schema-builder";

import {
  collectionToManifestEntity,
  type BuilderFieldInput,
  type ManifestEntity,
} from "./to-manifest-entity";
import { singleToManifestEntity } from "./to-manifest-entity-single";

export function collectionEntityFromSettings(
  slug: string,
  settings: BuilderSettingsValues,
  fields: BuilderFieldInput[]
): ManifestEntity {
  return collectionToManifestEntity({
    slug,
    settings: {
      singularName: settings.singularName,
      pluralName: settings.pluralName,
      status: settings.status === true,
      // i18n: the collection-level Internationalization toggle.
      localized: settings.i18n === true,
    },
    fields,
  });
}

export function singleEntityFromSettings(
  slug: string,
  settings: BuilderSettingsValues,
  fields: BuilderFieldInput[]
): ManifestEntity {
  return singleToManifestEntity({
    slug,
    settings: {
      singularName: settings.singularName,
      status: settings.status === true,
    },
    fields,
  });
}
