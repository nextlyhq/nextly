/**
 * Whether this site keeps every translatable field per language from the start
 * (`experimental.perLanguageStorage`), and the one predicate every storage decision reads.
 *
 * Chosen when the site starts and published here, as the webhook audit gate is: the storage a
 * running site reads and writes cannot change under it, so a reload that would flip it is refused
 * until the site restarts.
 *
 * @module domains/i18n/per-language-storage
 * @experimental
 */
import { isFieldGroupFieldType } from "../field-groups/storage/field-group-field-type";

import {
  isFieldLocalized,
  resolveLocalizedFieldNames,
} from "./classify-fields";

// Stored on `globalThis`, as the webhook audit gate is: Next.js and Turbopack can evaluate this
// module in more than one server module graph, and HMR evaluates it again, so a module-local value
// lets the boot publish to one copy while a read or a reload asks another.
const globalForStorage = globalThis as unknown as {
  __nextly_perLanguageStorage?: {
    enabled: boolean;
    chosen: boolean;
    // Whether the choice was taken from a config read rather than a boot, so a later read of an
    // edited config in the same process is judged as a reload is.
    adopted?: boolean;
  };
};
globalForStorage.__nextly_perLanguageStorage ??= {
  enabled: true,
  chosen: false,
};
const state = globalForStorage.__nextly_perLanguageStorage;

/**
 * For tests only: lay tables out as a release from before per-language storage did, keeping an
 * entity's translatable values on its main table unless it is translated. Every installation keeps
 * them per language now, and nothing a site configures reaches this: `experimental.perLanguageStorage`
 * only warns at the start (`warnPerLanguageStorageSetting`). A test that stands in for an earlier
 * release, such as the upgrade's, sets it before booting and resets it (`_resetPerLanguageStorage`)
 * when done; so does a test of a code path only such a database still reaches.
 *
 * @internal
 */
export function setPerLanguageStorage(enabled: boolean): void {
  state.enabled = enabled;
  state.chosen = true;
}

/**
 * Put the layout back to the one every installation runs, after a test that stood in for an
 * earlier release.
 */
export function _resetPerLanguageStorage(): void {
  state.enabled = true;
  state.chosen = false;
  state.adopted = false;
}

/**
 * The start's word on `experimental.perLanguageStorage`: the setting no longer chooses a layout,
 * every installation keeping its translatable fields per language, so a site that still sets it
 * (to either value) is told it is deprecated and does nothing. A site that leaves it out hears
 * nothing.
 */
export function warnPerLanguageStorageSetting(
  setting: boolean | undefined,
  warn: (message: string) => void
): void {
  if (setting === undefined) return;
  warn(
    "experimental.perLanguageStorage is deprecated and has no effect: every installation keeps " +
      "its translatable fields per language. Remove it from the configuration."
  );
}

/**
 * Whether every translatable field is kept per language from the start: always, for every
 * installation, but in a test standing in for an earlier release (`setPerLanguageStorage`).
 */
export function perLanguageStorageEnabled(): boolean {
  return state.enabled;
}

/**
 * Whether an entity's translatable fields are stored in its per-language table: always when the
 * site keeps every translatable field so, and otherwise when the entity is marked translatable.
 *
 * Asks only where the values live. Whether the entity is translated in the product's sense (its
 * language switcher, per-language publishing) stays the entity's own `localized` setting.
 */
export function storesPerLanguage(
  entity: { localized?: unknown } | null | undefined
): boolean {
  return state.enabled || entity?.localized === true;
}

/**
 * The fields whose columns belong on an entity's main table: every one, or for an entity whose
 * translatable values live in its companion (`storesPerLanguage`), its shared ones only, so a
 * column top-up never puts a translatable column back on the main table.
 */
export function mainTableFields<F extends { name?: string; type: string }>(
  entity: { localized?: unknown },
  fields: F[]
): F[] {
  if (!storesPerLanguage(entity)) return fields;
  const translatable = new Set(
    resolveLocalizedFieldNames(
      fields as Parameters<typeof resolveLocalizedFieldNames>[0],
      true
    )
  );
  return fields.filter(field => !field.name || !translatable.has(field.name));
}

/**
 * Whether an entity's content differs by language, as a question of who may act on it in which
 * language rather than of where its columns are: translated, or kept per language under the
 * setting with something to keep so. `storesPerLanguage` answers yes for every entity under the
 * setting, including one whose every field is shared; such an entity holds the same values in
 * every language, so an operation on it reaches every language. A field-group reference counts:
 * the group keeps its own translatable values per language under the setting.
 */
export function contentDiffersByLanguage(
  entity:
    | {
        localized?: unknown;
        fields?: readonly { type: string; localized?: boolean }[];
      }
    | null
    | undefined
): boolean {
  if (entity?.localized === true) return true;
  if (!storesPerLanguage(entity)) return false;
  return (entity?.fields ?? []).some(
    field =>
      isFieldLocalized(field as Parameters<typeof isFieldLocalized>[0], true) ||
      isFieldGroupFieldType(field.type)
  );
}

/**
 * Whether an entity publishes each language on its own, so its companion carries a per-language
 * `_status`: a translatable entity with Draft/Published. One whose values are stored per language
 * without its being translatable publishes as a document, and its companion holds values only.
 * Where every companion belongs to a translatable entity, as without the setting, this is the
 * entity's Draft/Published flag.
 */
export function publishesPerLanguage(
  entity: { localized?: unknown; status?: unknown } | null | undefined
): boolean {
  return entity?.localized === true && entity?.status === true;
}

/** What a save changes about where an entity's translatable values live and how it publishes. */
export interface TranslationLayoutChange {
  /** Whether its translatable values were, and will be, kept in its per-language table. */
  wasStored: boolean;
  isStored: boolean;
  /** Whether its per-language table carried, and will carry, a `_status` of each language. */
  wasPublishedPerLanguage: boolean;
  isPublishedPerLanguage: boolean;
  /**
   * Whether a `_status` the save adds takes the entry's state in EVERY language: translation turned
   * on for values already kept per language, every language of which was live with the entry.
   */
  statusFromEntryInEveryLanguage: boolean;
  /**
   * Whether the save drops each language's own publish state for the entry's, which must first be
   * the same (`assertLanguageStatesAgreeWithEntry`): translation turned off for values that stay
   * per language, on a Draft/Published entity.
   */
  languagesMustAgreeWithEntry: boolean;
}

/**
 * A save's change to an entity's translation layout, from its `localized` and Draft/Published flags
 * before and after. The one derivation every Builder save asks, so they cannot disagree.
 *
 * Without the setting a toggle moves the values: on, from the main table into the per-language
 * table; off, back. Under `experimental.perLanguageStorage` they stay per language either way, so
 * turning translation on or off moves no value; on a Draft/Published entity it gives each language
 * a publish state of its own, or takes it away. Without the setting the per-language `_status`
 * follows the entity's Draft/Published flag as it always has, since every per-language table then
 * belongs to a translated entity.
 */
export function translationLayoutChange(flags: {
  wasLocalized: boolean;
  isLocalized: boolean;
  wasStatus: boolean;
  hasStatus: boolean;
}): TranslationLayoutChange {
  const { wasLocalized, isLocalized, wasStatus, hasStatus } = flags;
  if (!state.enabled) {
    return {
      wasStored: wasLocalized,
      isStored: isLocalized,
      wasPublishedPerLanguage: wasStatus,
      isPublishedPerLanguage: hasStatus,
      statusFromEntryInEveryLanguage: false,
      languagesMustAgreeWithEntry: false,
    };
  }
  const wasPublishedPerLanguage = publishesPerLanguage({
    localized: wasLocalized,
    status: wasStatus,
  });
  const isPublishedPerLanguage = publishesPerLanguage({
    localized: isLocalized,
    status: hasStatus,
  });
  return {
    wasStored: true,
    isStored: true,
    wasPublishedPerLanguage,
    isPublishedPerLanguage,
    statusFromEntryInEveryLanguage:
      !wasLocalized && isLocalized && isPublishedPerLanguage,
    // Translation turned off, the entry keeping Draft/Published: turning Draft/Published itself off
    // drops every publish state by design, the entry's included.
    languagesMustAgreeWithEntry:
      wasPublishedPerLanguage && wasLocalized && !isLocalized && hasStatus,
  };
}
