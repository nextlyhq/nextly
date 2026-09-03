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
      description: settings.description,
      pluralName: settings.pluralName,
      status: settings.status === true,
      // i18n: the collection-level Internationalization toggle.
      localized: settings.i18n === true,
      // Version history, mirrored into ui-schema.json so the committed
      // manifest matches what the registry was just told.
      versions: settings.versions === true,
      // Cache revalidation, mirrored into ui-schema.json. Defaults on, so only
      // an explicit `false` opts the collection out; anything else stays on.
      revalidate: settings.revalidate !== false,
      // Webhook recording, mirrored the same way: defaults on, only an explicit
      // `false` keeps the collection's writes out of the outbox.
      webhooks: settings.webhooks !== false,
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
      description: settings.description,
      status: settings.status === true,
      // i18n: the single-level Internationalization toggle (mirrors collectionEntityFromSettings).
      localized: settings.i18n === true,
      // Version history (mirrors collectionEntityFromSettings).
      versions: settings.versions === true,
      // Cache revalidation (mirrors collectionEntityFromSettings): defaults on,
      // only an explicit `false` opts the single out.
      revalidate: settings.revalidate !== false,
      // Webhook recording (mirrors collectionEntityFromSettings): defaults on,
      // only an explicit `false` keeps the single's writes out of the outbox.
      webhooks: settings.webhooks !== false,
    },
    fields,
  });
}
