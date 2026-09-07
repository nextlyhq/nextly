/**
 * What a reader may change about ONE card, and what a stored value means.
 *
 * A placement already carries `config`, validated on write and persisted with
 * the layout. Nothing declared what belonged in it and nothing read it, so a
 * card looked the same for everyone. This is the declaration and the reading.
 *
 * ## Settings are FIELD definitions, not a vocabulary of their own
 *
 * A widget declares its settings as the same field configs the rest of the
 * product uses, so `FieldRenderer` draws them with no adapter and a plugin
 * author learns nothing new to expose a setting. Directus takes this route for
 * panel options and it is why its panels all feel alike; WordPress gives every
 * widget its own settings form, which is why none of its do.
 *
 * The union is deliberately NARROW. `FieldConfig` also covers relationships,
 * rich text, repeaters and field groups — none of them a sensible dashboard
 * setting, and each dragging real editing UI behind it. A label, a count, a
 * toggle and a choice cover what a card wants, and widening later is additive
 * where narrowing would not be.
 *
 * ## Shape is checked on WRITE; meaning is decided on READ
 *
 * The layout writer already refuses a config that is not a plain object, nests
 * too deeply, or makes the payload too large, and that stays where it is. The
 * DECLARATION is applied here instead, when the value is read:
 *
 * - a key no setting declares is IGNORED, and kept in storage;
 * - a declared key that is absent takes the setting's default;
 * - a value of the wrong type takes the default too.
 *
 * 🔴 Rejecting unknown keys at write time would make a saved layout unwritable
 * the moment a plugin renames a setting or is uninstalled, and plugins version
 * independently of core — so the strict reading punishes exactly the upgrade it
 * is supposed to survive. Keeping the unknown key rather than stripping it is
 * the other half: reinstalling the plugin restores its settings instead of
 * silently having discarded them.
 *
 * @module domains/widgets/settings
 */

import { NextlyError } from "../../errors/nextly-error";

/** What every setting carries, whatever kind it is. */
export interface WidgetSettingBase {
  name: string;
  label?: string;
  description?: string;
}

/**
 * One thing a reader may change about a card.
 *
 * 🔴 Declared STRUCTURALLY rather than as the collections field union, and the
 * compiler is why. Importing `TextFieldConfig` and its siblings pulls
 * `collections/fields/types/base` into the type graph of every package that
 * reads a widget definition — and the admin is one, where that module's own
 * `@nextly/hooks/types` import does not resolve. `WidgetDefinition` travels
 * through `nextly/config`, the entry point that exists to keep weight out of a
 * user's config file, so dragging the field graph behind it is the weight that
 * entry point refuses by design.
 *
 * The shape is still a field config, so `FieldRenderer` draws it with no
 * adapter. `__tests__/settings.compat.test-d.ts` asserts that each variant is
 * assignable to `FieldConfig`, inside the package where that import resolves —
 * so the compatibility this rests on is checked rather than asserted in prose.
 */
export type WidgetSetting =
  | (WidgetSettingBase & { type: "text"; defaultValue?: string })
  | (WidgetSettingBase & {
      type: "number";
      defaultValue?: number;
      min?: number;
      max?: number;
    })
  | (WidgetSettingBase & { type: "checkbox"; defaultValue?: boolean })
  | (WidgetSettingBase & {
      type: "select";
      defaultValue?: string;
      options: { label: string; value: string }[];
    });

/** The field types a widget setting may use. */
const SETTING_TYPES = new Set(["text", "number", "checkbox", "select"]);

/**
 * How many settings one widget may declare.
 *
 * A ceiling rather than a guess at what is reasonable: the settings travel in
 * the workspace metadata every admin page load reads, and a definition that
 * declared hundreds would cost every reader that weight whether or not anyone
 * opens the settings panel.
 */
export const MAX_WIDGET_SETTINGS = 24;

/*
 * `invalidInput` rather than `validation`, matching the widget definition's own
 * refusal: this is a developer's declaration rather than a reader's input, so
 * the message is developer-facing and safe to surface verbatim.
 */
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget settings: ${message}`,
  });
}

/**
 * Refuse a declaration the admin could not draw or the reader could not use.
 *
 * 🔴 Refuses at BOOT rather than degrading, which is the opposite of how the
 * stored value is treated a few lines below, and deliberately so. A malformed
 * declaration is the author's mistake and they are the one running the boot; a
 * malformed stored value belongs to a reader who cannot fix it and may not have
 * caused it. The strictness goes where the feedback lands.
 */
export function validateWidgetSettings(
  settings: unknown,
  widgetId: string
): asserts settings is WidgetSetting[] | undefined {
  if (settings === undefined) return;
  if (!Array.isArray(settings))
    fail(`${widgetId}: "settings" must be an array`);
  if (settings.length > MAX_WIDGET_SETTINGS) {
    fail(
      `${widgetId}: at most ${MAX_WIDGET_SETTINGS} settings, got ${settings.length}`
    );
  }

  const seen = new Set<string>();
  for (const setting of settings) {
    validateOneSetting(setting, widgetId, seen);
  }
}

/**
 * Refuse one setting the admin could not draw or the reader could not use.
 *
 * Separate from the collection check because they answer different questions —
 * whether this declaration is well formed, against whether the SET of them is
 * (no duplicates, not too many) — and reading them interleaved made both harder
 * to follow than either is alone.
 *
 * `seen` is passed rather than returned because uniqueness is a property of the
 * set, and the only place that can observe it is the loop.
 */
function validateOneSetting(
  setting: unknown,
  widgetId: string,
  seen: Set<string>
): void {
  if (typeof setting !== "object" || setting === null) {
    fail(`${widgetId}: every setting must be an object`);
  }
  const { name, type, defaultValue } = setting as {
    name?: unknown;
    type?: unknown;
    defaultValue?: unknown;
  };

  if (typeof name !== "string" || name === "") {
    fail(`${widgetId}: every setting needs a non-empty "name"`);
  }
  if (seen.has(name)) {
    // Two settings of one name make the resolved value depend on which was
    // read last, and the author cannot see which that is.
    fail(`${widgetId}: duplicate setting "${name}"`);
  }
  seen.add(name);

  if (typeof type !== "string" || !SETTING_TYPES.has(type)) {
    fail(
      `${widgetId}: setting "${name}" has type ${JSON.stringify(type)}; expected one of ${[...SETTING_TYPES].join(", ")}`
    );
  }

  /*
   * 🔴 A FUNCTION default is refused rather than called. `defaultValue` may be
   * a thunk on a collection field, where it is evaluated on the server that
   * holds it — but a widget definition is serialized to the admin through
   * `/api/admin-meta/workspace`, and a function does not survive JSON. Accepted
   * here it would simply be absent by the time anything could use it, so the
   * setting would silently have no default at all. Refusing puts that in front
   * of the author, who is the only one who can fix it.
   */
  if (typeof defaultValue === "function") {
    fail(
      `${widgetId}: setting "${name}" has a function default; widget settings cross the wire as JSON, so a default must be a literal`
    );
  }
}

/** Whether a stored value is usable as this setting's type. */
function matchesType(setting: WidgetSetting, value: unknown): boolean {
  switch (setting.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "checkbox":
      return typeof value === "boolean";
    case "text":
    case "select":
      return typeof value === "string";
  }
}

/** The default a setting declares, or `undefined` when it declares none. */
function declaredDefault(setting: WidgetSetting): unknown {
  const { defaultValue } = setting as { defaultValue?: unknown };
  return defaultValue;
}

/**
 * What this card's settings actually are, for a stored config.
 *
 * Returns only DECLARED names, so a caller reading the result cannot
 * accidentally act on a key the widget never offered. The stored object keeps
 * its unknown keys; this is a reading of it, not a rewrite.
 */
export function resolveWidgetSettings(
  settings: readonly WidgetSetting[] | undefined,
  stored: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!settings || settings.length === 0) return {};

  const resolved: Record<string, unknown> = {};
  for (const setting of settings) {
    const value = stored?.[setting.name];
    if (value !== undefined && matchesType(setting, value)) {
      resolved[setting.name] = value;
      continue;
    }
    // A wrong-typed value takes the default rather than refusing: the reader
    // did not necessarily write it -- a plugin changing a setting's type across
    // an upgrade produces exactly this -- and a card that refuses to draw is a
    // worse answer than one drawn the way its author intended.
    const fallback = declaredDefault(setting);
    if (fallback !== undefined) resolved[setting.name] = fallback;
  }
  return resolved;
}

/**
 * Query knobs a setting may drive, and the setting type each requires.
 *
 * 🔴 A closed set, matched by NAME. That is the contract and it is stated
 * rather than inferred: a setting called `limit` and typed `number` changes how
 * many rows the card asks for, and nothing else a widget declares touches the
 * query at all. The alternative — a mapping from each setting to the knob it
 * feeds — is a small DSL to learn, to document and to validate, for a set that
 * currently has one member.
 *
 * The type is part of the match, so a `text` setting named `limit` drives
 * nothing rather than putting a string where a row count goes.
 */
const QUERY_KNOBS: Record<string, WidgetSetting["type"]> = {
  limit: "number",
};

/**
 * The query this card should ask, given what its reader chose.
 *
 * 🔴 Nothing is clamped or re-validated here. `validateReadWidgetQuery` bounds
 * every query the endpoint accepts — `clampLimit` already turns a hostile or
 * absurd limit into a legal one — and the caller composing this query is the
 * admin, whose requests go through exactly that gate. Re-checking here would be
 * a second implementation of a rule this module cannot see, agreeing on the day
 * it is written and drifting afterwards, which is the mistake
 * `executeWidgetQuery` warns about for filters.
 *
 * Returns the query UNCHANGED when nothing applies, so a caller can use the
 * result unconditionally without asking whether it needed to.
 */
export function applyWidgetSettings<T extends { limit?: number }>(
  query: T,
  settings: readonly WidgetSetting[] | undefined,
  stored: Record<string, unknown> | undefined
): T {
  if (!settings || settings.length === 0) return query;

  const resolved = resolveWidgetSettings(settings, stored);
  let next = query;

  for (const setting of settings) {
    if (QUERY_KNOBS[setting.name] !== setting.type) continue;
    const value = resolved[setting.name];
    if (value === undefined) continue;
    // Copied on first write rather than up front: a card whose settings drive
    // no knob hands back the query it was given, which is what lets a caller
    // apply this to every card without a branch.
    if (next === query) next = { ...query };
    (next as { limit?: number }).limit = value as number;
  }

  return next;
}
