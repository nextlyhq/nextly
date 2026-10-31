/**
 * A card's settings as its form holds them, and as they are stored.
 *
 * Apart from the settings sheet because the card's quick setting reads and
 * writes them too, at rest on every dashboard, while the sheet itself loads
 * only when a reader opens it (`LazyWidgetSettingsSheet`): it draws its form
 * with the entry editor's field renderer, which the dashboard has no other
 * need for.
 *
 * @module components/features/widgets/edit/settings-values
 */

import { resolveWidgetSettings, type AnyWidgetSetting } from "nextly/config";

import { sameSettingValue } from "./content-settings";

/**
 * The values the form opens with.
 *
 * 🔴 Built from the DECLARATION rather than from the stored config, so a
 * setting the reader has never touched still opens at its default instead of
 * blank — and a key the declaration no longer knows about does not appear as a
 * ghost field. Read through `resolveWidgetSettings`, the server's own reader,
 * so what the form shows is what the card is actually using: a stored value
 * the setting no longer accepts (a retired option, a number past a narrowed
 * bound, a value of another kind) opens at the default the card fell back to,
 * not at the value it set aside. A note's own text over its bound is the
 * exception, opened as written so it can be shortened.
 */
export function initialValues(
  settings: readonly AnyWidgetSetting[],
  config: Record<string, unknown> | undefined
): Record<string, unknown> {
  /*
   * 🔴 Prototype-free, because the KEYS are setting names a plugin chose. On a
   * `{}` dictionary `__proto__` is not data: assigning it invokes the legacy
   * prototype setter, so a setting of that name never reached the form and
   * opened blank instead of at its default. `resolveWidgetSettings` is
   * prototype-free for the same reason, and this function exists to mirror it.
   */
  const values: Record<string, unknown> = Object.create(null);
  const resolved = resolveWidgetSettings(settings, config);
  for (const setting of settings) {
    const stored = config?.[setting.name];
    // A note over its bound is the one stale value kept as written: it is the
    // reader's own text, so they shorten it rather than lose it, and Done
    // refuses it until it fits (`overlongSetting`).
    values[setting.name] =
      setting.type === "textarea" && typeof stored === "string"
        ? stored
        : (resolved[setting.name] ?? "");
  }
  return values;
}

/**
 * What to store, given what the form holds.
 *
 * 🔴 A value equal to its declared default is DROPPED rather than written. The
 * stored config is the reader's departure from the author's intent, so writing
 * the default back would pin today's default forever — a card would stop
 * following a later change to it, silently, and only for readers who happened
 * to open the panel.
 */
export function toStoredConfig(
  settings: readonly AnyWidgetSetting[],
  values: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
): Record<string, unknown> {
  const stored: Record<string, unknown> = Object.create(null);

  /*
   * 🔴 A stored key the declaration does not know is CARRIED, not dropped.
   * `resolveWidgetSettings` keeps such a key deliberately — a plugin that
   * renames a setting or is uninstalled must not cost a reader the values they
   * chose, because reinstalling it restores them. This form is built from the
   * DECLARATION, so it never sees those keys; rebuilding the config from it
   * alone, and writing that back over the whole `config`, discarded exactly
   * what the reading layer went out of its way to preserve. Opening the panel
   * and pressing Save was enough to lose them.
   */
  const declared = new Set(settings.map(setting => setting.name));
  for (const key of Object.keys(existing ?? {})) {
    if (!declared.has(key)) stored[key] = existing?.[key];
  }

  for (const setting of settings) {
    /*
     * 🔴 Read through `hasOwn`, not by indexing. `values` comes back from the
     * form, and on an ordinary object `values["__proto__"]` answers
     * `Object.prototype` rather than `undefined` — so a setting of that name
     * passed both guards below and was written to storage as the prototype
     * object, for a field the reader never filled in.
     */
    if (!Object.hasOwn(values, setting.name)) continue;
    const value = values[setting.name];
    if (value === undefined || value === "") continue;
    if (sameSettingValue(value, setting.defaultValue)) continue;
    stored[setting.name] = value;
  }
  return stored;
}
