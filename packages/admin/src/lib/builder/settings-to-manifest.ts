/**
 * Map the builder's settings snapshot (`BuilderSettingsValues`) → a complete
 * `ui-schema.json` `ManifestEntity`. The single chokepoint every builder page
 * uses from BOTH its save paths (field-change + settings-only), so no setting
 * can be dropped on the way to ui-schema.json.
 *
 * ## Why "complete" is the whole job
 *
 * 🔴 The dev-schema endpoint FULL-REPLACES the entity it is given, by slug, and
 * says so: a shallow merge would make unsetting impossible, since an omitted key
 * would silently retain the old value. That contract names this module as the
 * caller it trusts to "send a COMPLETE entity". A projection that forgets a key
 * therefore does not merely fail to write it — it ERASES whatever a previous
 * write put there.
 *
 * It had already happened. `versionsMaxPerDoc` was projected by both create
 * paths and by neither edit path, so choosing "keep 10 versions" on a new
 * collection wrote the retention into ui-schema.json, and the next edit of that
 * collection — a renamed label, one added field — replaced the entity without it
 * and the retention was gone from the file.
 *
 * That is why the projection below is not a hand-written list per call site. It
 * is derived from `BuilderSettingsValues` through a TOTAL map, so adding a
 * setting does not compile until somebody has said whether the manifest carries
 * it. The old shape needed six places to each remember every key; four of them
 * were written inline at the call site, and each forgot a different one.
 *
 * @module lib/builder/settings-to-manifest
 */
import type { BuilderSettingsValues } from "../../components/features/schema-builder";

import {
  collectionToManifestEntity,
  type BuilderFieldInput,
  type BuilderSettingsInput,
  type ManifestEntity,
} from "./to-manifest-entity";
import { fieldGroupToManifestEntity } from "./to-manifest-entity-field-group";
import { singleToManifestEntity } from "./to-manifest-entity-single";

/**
 * Every builder setting, and whether the manifest carries it.
 *
 * 🔴 A TOTAL map over `BuilderSettingsValues`, and that is the mechanism rather
 * than documentation of one: adding a setting makes this object literal miss a
 * property, which does not compile. The alternative — a function that reads the
 * keys it happens to remember — is what produced a create path and an edit path
 * that disagreed about `versionsMaxPerDoc` in opposite directions.
 *
 * The technique is not invented here. `settings-dirty.ts`, one file away, has
 * enforced exactly this over the same type since the Save button was enabled by
 * a hand-written diff and a new setting left it greyed out — "a failure that
 * looks like nothing happening at all", as its own note puts it. That guard is
 * why a new setting already reaches the dirty check; this one is why it now also
 * reaches the file the dirty check lets you save.
 *
 * `false` means the manifest does not carry it, with the reason beside it. It
 * never means "not got round to yet"; a setting that ought to travel and cannot
 * belongs in a finding, not in a silent `false`.
 */
const CARRIED_BY_THE_MANIFEST: {
  readonly [K in keyof Required<BuilderSettingsValues>]: boolean;
} = {
  // Create-only and never persisted: it decides what the create call seeds and
  // has no meaning afterwards.
  startingFieldType: false,
  // The entity's identity, not one of its settings. Passed as its own argument
  // because the manifest is keyed on it.
  slug: false,
  // `ManifestEntity.admin` carries useAsTitle, defaultColumns and group, and
  // neither of these. They reach the database through the create/update request
  // instead, so projecting them here would invent a key the schema rejects.
  icon: false,
  category: false,

  singularName: true,
  pluralName: true,
  description: true,
  status: true,
  // Spelled `localized` on the manifest; see the projection below.
  i18n: true,
  versions: true,
  versionsMaxPerDoc: true,
  revalidate: true,
  webhooks: true,
};

/** The settings keys the manifest carries, derived rather than restated. */
export const MANIFEST_SETTING_KEYS = Object.entries(CARRIED_BY_THE_MANIFEST)
  .filter(([, carried]) => carried)
  .map(([key]) => key)
  .sort();

/**
 * The builder's settings as the manifest spells them.
 *
 * Two renames happen here and nowhere else. `i18n` is the toggle's name in the
 * form and `localized` is the manifest's, and `revalidate`/`webhooks` default ON
 * — so only an explicit `false` opts an entity out, and `undefined` must not be
 * allowed to read as "off".
 *
 * 🔴 The description is normalised HERE rather than at a call site, because the
 * create request and the manifest describe the same entity and one of them was
 * normalising while the others passed the raw value. A whitespace-only
 * description was then stored as text in ui-schema.json while the row it mirrors
 * held NULL — two records of one field group disagreeing about whether it has a
 * description. Empty maps to `undefined`, which the entity mapper writes as an
 * absent key; that keeps the documented limitation that a CLEARED description
 * cannot propagate through a migration, rather than quietly inventing a
 * different one.
 */
export function manifestSettingsFrom(
  settings: BuilderSettingsValues
): BuilderSettingsInput {
  return {
    singularName: settings.singularName,
    pluralName: settings.pluralName,
    description: settings.description?.trim() || undefined,
    status: settings.status === true,
    localized: settings.i18n === true,
    versions: settings.versions === true,
    versionsMaxPerDoc: settings.versionsMaxPerDoc,
    revalidate: settings.revalidate !== false,
    webhooks: settings.webhooks !== false,
  };
}

export function collectionEntityFromSettings(
  slug: string,
  settings: BuilderSettingsValues,
  fields: BuilderFieldInput[]
): ManifestEntity {
  return collectionToManifestEntity({
    slug,
    settings: manifestSettingsFrom(settings),
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
    settings: manifestSettingsFrom(settings),
    fields,
  });
}

/**
 * A field group's manifest entity.
 *
 * A field group has no lifecycle, no versions and no cache or webhook posture of
 * its own — it is a reusable set of fields — so the projection it shares with
 * the other two carries values those keys do not apply to. It is still the SAME
 * projection: `applyCommonSettings` writes a key only when the settings object
 * defines it, and a field group's form leaves them undefined, so nothing is
 * invented here. Sharing it is what stops a field group being the one entity
 * that forgets `description` again.
 */
export function fieldGroupEntityFromSettings(
  slug: string,
  settings: BuilderSettingsValues,
  fields: BuilderFieldInput[]
): ManifestEntity {
  return fieldGroupToManifestEntity({
    slug,
    settings: manifestSettingsFrom(settings),
    fields,
  });
}
