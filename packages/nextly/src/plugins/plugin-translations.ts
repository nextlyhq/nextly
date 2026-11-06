/**
 * The admin strings plugins declare in `contributes.translations`, checked at
 * startup.
 *
 * Every key a plugin declares begins with its admin slug and a dot, the one
 * namespace rule hook points, events and places follow. The admin's own keys
 * begin with {@link ADMIN_TRANSLATION_SEGMENT}, a segment no plugin's may, so a
 * plugin key can never stand in for one of the admin's: the boundary is the
 * namespace, not a list of the admin's keys kept here.
 *
 * @module plugins/plugin-translations
 */
import { languageTagProblem } from "../shared/lib/language-tag";

import type { PluginTranslations } from "./contributions";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/**
 * The first segment of every key in the admin's own catalog. A plugin whose
 * admin slug is this segment would share the admin's namespace, so it can
 * declare no translations.
 */
export const ADMIN_TRANSLATION_SEGMENT = "nextly";

/** A key: two or more segments of letters, digits, `_` and `-`, joined by dots. */
const KEY_SHAPE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Refuse a language that is malformed, holds anything but keys, or is not
 * spelled canonically, by the rule every interface language is held to (see
 * `shared/lib/language-tag`).
 */
function assertLanguage(
  pluginName: string,
  language: string,
  entries: unknown
): asserts entries is Record<string, unknown> {
  const problem = languageTagProblem(language);
  if (problem?.kind === "malformed" || !isRecord(entries)) {
    throw resolutionError(
      "plugin-translations-malformed",
      `Plugin "${pluginName}" declares translations for "${language}", which must be a language code such as "en" or "pt-BR" holding keys and their text.`,
      { plugin: pluginName, language }
    );
  }
  if (problem?.kind === "not-canonical") {
    throw resolutionError(
      "plugin-translations-malformed",
      `Plugin "${pluginName}" declares translations for "${language}", which must be spelled "${problem.expected}", as browsers report it.`,
      { plugin: pluginName, language, expected: problem.expected }
    );
  }
}

/** Refuse a catalog that is not languages of keys of text. */
function assertCatalogShape(
  pluginName: string,
  translations: unknown
): asserts translations is PluginTranslations {
  if (!isRecord(translations)) {
    throw resolutionError(
      "plugin-translations-malformed",
      `Plugin "${pluginName}" declares translations that are not an object of languages.`,
      { plugin: pluginName }
    );
  }
  for (const [language, entries] of Object.entries(translations)) {
    assertLanguage(pluginName, language, entries);
    for (const [key, text] of Object.entries(entries)) {
      if (typeof text !== "string") {
        throw resolutionError(
          "plugin-translation-not-text",
          `Plugin "${pluginName}" declares "${key}" in "${language}" with a value that is not text.`,
          { plugin: pluginName, language, key }
        );
      }
    }
  }
}

/** Refuse one key: malformed, or outside the plugin's own namespace. */
function assertDeclarableKey(pluginName: string, key: string): void {
  if (!KEY_SHAPE.test(key)) {
    throw resolutionError(
      "plugin-translation-malformed-key",
      `Plugin "${pluginName}" declares the translation key "${key}", which must be segments of letters, digits, "_" and "-" joined by dots.`,
      { plugin: pluginName, key }
    );
  }
  if (!isInPluginNamespace(pluginName, key)) {
    const prefix = `${pluginAdminSlug(pluginName)}.`;
    throw resolutionError(
      "plugin-translation-outside-namespace",
      `Plugin "${pluginName}" declares the translation key "${key}", which must start with "${prefix}".`,
      { plugin: pluginName, key, expectedPrefix: prefix }
    );
  }
}

/**
 * Check each key of one plugin's catalog and record the plugin as its owner,
 * refusing a key another plugin already owns, naming both.
 */
function claimKeys(
  pluginName: string,
  translations: PluginTranslations,
  owners: Map<string, string>
): void {
  for (const entries of Object.values(translations)) {
    for (const key of Object.keys(entries)) {
      assertDeclarableKey(pluginName, key);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== pluginName) {
        throw resolutionError(
          "plugin-translation-duplicate",
          `Plugins "${owner}" and "${pluginName}" both declare the translation key "${key}".`,
          { plugin: pluginName, otherPlugin: owner, key }
        );
      }
      owners.set(key, pluginName);
    }
  }
}

/**
 * Every plugin's translations, by plugin name, each checked.
 *
 * Refuses, naming what it refuses: a plugin slugged as the admin's own
 * segment that declares any, a malformed catalog or language, a language not
 * spelled canonically, a value that is not text, a malformed key, a key
 * outside the plugin's namespace, and a key another plugin already declares,
 * naming both plugins. A disabled plugin's catalog is kept and checked, as
 * its field types are: its collections stay, so its field editors still
 * mount and still read their strings.
 */
export function collectPluginTranslations(
  plugins: readonly PluginDefinition[]
): Map<string, PluginTranslations> {
  const collected = new Map<string, PluginTranslations>();
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    const translations: unknown = plugin.contributes?.translations;
    if (translations === undefined) continue;
    if (pluginAdminSlug(plugin.name) === ADMIN_TRANSLATION_SEGMENT) {
      throw resolutionError(
        "plugin-translations-reserved-slug",
        `Plugin "${plugin.name}" declares translations, but its slug "${ADMIN_TRANSLATION_SEGMENT}" is the segment the admin's own strings begin with, so it can declare none. Rename the plugin to give it a slug of its own.`,
        { plugin: plugin.name, segment: ADMIN_TRANSLATION_SEGMENT }
      );
    }
    assertCatalogShape(plugin.name, translations);
    claimKeys(plugin.name, translations, owners);
    collected.set(plugin.name, translations);
  }
  return collected;
}
