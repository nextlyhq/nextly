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
 * - a value the declaration no longer accepts takes the default too.
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
  /**
   * Presentation the field system owns, and where help text lives.
   *
   * 🔴 `description` sits HERE rather than at the top level, and the renderer
   * is why. The premise of this whole type is that `FieldRenderer` draws a
   * setting with no adapter — and `FieldWrapper` reads help text from
   * `field.admin.description`, nowhere else. Declared at the top level it
   * compiled, travelled to the admin intact, and was silently never drawn: an
   * author would write a description, see nothing on screen, and have no
   * failure anywhere to look at. Being a field config has to mean being one
   * where the renderer reads, not only where the compiler agrees.
   */
  admin?: { description?: string };
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
 * assignable to `FieldConfig` AND that it introduces no top-level key the field
 * types do not have, inside the package where that import resolves — so the
 * compatibility this rests on is checked rather than asserted in prose.
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

/**
 * Whether a value is usable as a setting of each type.
 *
 * 🔴 ONE table, read in both directions this module judges a value in: a
 * STORED value being read back for a card, and a DEFAULT being declared by an
 * author. Only the stored direction existed before, so
 * `{ type: "number", defaultValue: "ten" }` passed boot, resolved to the string
 * it declared, and put text where a row count goes — the author's mistake
 * surfacing as a query that quietly did something else. Two tables could
 * answer one question two ways; this one cannot.
 *
 * The keys are also the vocabulary. A type is one a setting may declare
 * exactly when this table can judge its values, so adding a type here is the
 * whole of adding a type.
 */
/**
 * What a setting's own declaration narrows its values to, beyond the type.
 *
 * 🔴 The DECLARATION decides, not the type alone — and that is one rule rather
 * than two. A stored select value stays a string after its option is renamed,
 * and a stored number stays a number after its author narrows the range; both
 * are a value the widget no longer offers, and both must fall back to the
 * default the same way. Judging only the select case left the number one
 * accepting `20` for a setting declared `{ min: 1, max: 10 }`, which then
 * reached the query — the endpoint bounds its own global limit and has never
 * heard of this author's.
 */
interface SettingLimits {
  options?: readonly { value: string }[];
  min?: number;
  max?: number;
}

const USABLE_AS: Record<
  WidgetSetting["type"],
  (value: unknown, limits: SettingLimits) => boolean
> = {
  text: value => typeof value === "string",
  number: (value, limits) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    withinBounds(value, limits),
  checkbox: value => typeof value === "boolean",
  select: (value, limits) =>
    typeof value === "string" &&
    limits.options !== undefined &&
    limits.options.some(option => option.value === value),
};

/** Whether a finite number sits inside the range its setting declares. */
function withinBounds(value: number, limits: SettingLimits): boolean {
  // An absent bound is not a bound. Written as two independent tests rather
  // than one range check so a setting may declare either end alone, which is
  // the common case -- `{ min: 1 }` on a row count states the only end that
  // has a meaning.
  if (limits.min !== undefined && value < limits.min) return false;
  return !(limits.max !== undefined && value > limits.max);
}

/** What this setting's declaration narrows its values to. */
function limitsOf(setting: WidgetSetting): SettingLimits {
  if (setting.type === "select") return { options: setting.options };
  if (setting.type === "number") return { min: setting.min, max: setting.max };
  return {};
}

/** Whether this is a type a setting may declare. */
function isSettingType(value: unknown): value is WidgetSetting["type"] {
  // `Object.hasOwn` rather than `in`, because the type name comes from a
  // plugin's declaration: `"toString"` is `in` every object literal.
  return typeof value === "string" && Object.hasOwn(USABLE_AS, value);
}

/** Whether this is a usable set of choices for a select. */
function isSelectOptions(
  value: unknown
): value is { label: string; value: string }[] {
  return (
    Array.isArray(value) &&
    // Empty is refused: a select with no choices can never hold a value, so
    // every stored one falls back and the form draws a control with nothing in
    // it. That is a declaration mistake rather than a state to render.
    value.length > 0 &&
    value.every(
      option =>
        typeof option === "object" &&
        option !== null &&
        "value" in option &&
        typeof option.value === "string" &&
        // 🔴 A BLANK value is refused, not merely an absent one. These are
        // drawn by `FieldRenderer`, whose `SelectInput` hands each option
        // straight to a Radix `SelectItem` -- and Radix reserves the empty
        // string for "nothing is selected", so it throws rather than
        // rendering. Caught here, the plugin author sees it at boot; left to
        // the renderer, the first reader to open the settings panel gets the
        // crash.
        option.value.trim() !== "" &&
        "label" in option &&
        typeof option.label === "string"
    )
  );
}

/**
 * How many settings one widget may declare.
 *
 * A ceiling rather than a guess at what is reasonable: the settings travel in
 * the workspace metadata every admin page load reads, and a definition that
 * declared hundreds would cost every reader that weight whether or not anyone
 * opens the settings panel.
 */
export const MAX_WIDGET_SETTINGS = 24;

/**
 * A value named in a diagnostic, without the formatter itself throwing.
 *
 * 🔴 `JSON.stringify` is not total. A BigInt throws `TypeError`, and so does a
 * circular object — so a declaration carrying `defaultValue: 1n` produced a
 * native `TypeError` from inside the message-building, BEFORE the refusal it
 * was describing could be raised as a `NextlyError`. The author saw the wrong
 * error, naming neither the widget nor the setting.
 *
 * `String()` is the fallback rather than a fixed placeholder, because it
 * survives everything `JSON.stringify` does not and still names the value: a
 * BigInt reads `1`, a symbol reads `Symbol(x)`.
 */
function describeValue(value: unknown): string {
  try {
    // `undefined` and a function both stringify to `undefined` rather than to
    // text, so the fallback covers them too.
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

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
 * Why this declaration cannot be used, or `undefined` when it can.
 *
 * 🔴 Returns the problem rather than throwing it, because the two channels into
 * the registry need the same rules in different shapes: `registerWidget` throws
 * on a bad definition, while `validatedAdminWidgets` walks a list of rules that
 * each return a sentence and names the plugin that shipped the widget. Written
 * as a throwing validator, only the registry could call it — which is exactly
 * what happened: a contributed `settings` reached the admin having passed no
 * settings rule at all, and `settings: {}` from an untyped declaration got as
 * far as the grid before failing, taking the dashboard down instead of the
 * install. One rule set answering both channels is the thing
 * `plugins/__tests__/channel-divergence` exists to protect.
 */
export function widgetSettingsProblem(settings: unknown): string | undefined {
  if (settings === undefined) return undefined;
  if (!Array.isArray(settings)) return '"settings" must be an array';
  if (settings.length > MAX_WIDGET_SETTINGS) {
    return `at most ${MAX_WIDGET_SETTINGS} settings, got ${settings.length}`;
  }

  const seen = new Set<string>();
  for (const setting of settings) {
    const problem = settingProblem(setting, seen);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Why one setting cannot be used, or `undefined` when it can.
 *
 * Separate from the collection check because they answer different questions —
 * whether this declaration is well formed, against whether the SET of them is
 * (no duplicates, not too many) — and reading them interleaved made both harder
 * to follow than either is alone.
 *
 * `seen` is passed rather than returned because uniqueness is a property of the
 * set, and the only place that can observe it is the loop.
 */
function settingProblem(
  setting: unknown,
  seen: Set<string>
): string | undefined {
  if (typeof setting !== "object" || setting === null) {
    return "every setting must be an object";
  }
  const { name, type, defaultValue, ...rest } = setting as {
    name?: unknown;
    type?: unknown;
    defaultValue?: unknown;
    options?: unknown;
    min?: unknown;
    max?: unknown;
  };

  if (typeof name !== "string" || name === "") {
    return 'every setting needs a non-empty "name"';
  }
  if (seen.has(name)) {
    // Two settings of one name make the resolved value depend on which was
    // read last, and the author cannot see which that is.
    return `duplicate setting "${name}"`;
  }
  seen.add(name);

  if (!isSettingType(type)) {
    return `setting "${name}" has type ${describeValue(type)}; expected one of ${Object.keys(USABLE_AS).join(", ")}`;
  }

  return problemForType(type, rest, defaultValue, name);
}

/**
 * Why this setting's TYPE-SPECIFIC parts are unusable, or `undefined`.
 *
 * The options a select must offer and the default any setting may declare are
 * the two rules that depend on WHICH type this is; everything above is asked of
 * every setting alike. Kept apart so the general checks read as one list rather
 * than as a list interrupted by a branch about selects — and because the two
 * are ordered: a default can only be judged against options already known good.
 */
function problemForType(
  type: WidgetSetting["type"],
  setting: { options?: unknown; min?: unknown; max?: unknown },
  defaultValue: unknown,
  name: string
): string | undefined {
  const limits = declaredLimits(type, setting);
  if (typeof limits === "string") return `setting "${name}" ${limits}`;
  return defaultProblem(type, limits, defaultValue, name);
}

/**
 * What this declaration narrows its values to, or why it cannot be read.
 *
 * Returns the LIMITS on success and a problem fragment on failure, because the
 * two questions are one: a bound that cannot be read is not a bound to check
 * against, and validating it separately would leave the predicate below
 * comparing against a value it had never confirmed was a number.
 */
function declaredLimits(
  type: WidgetSetting["type"],
  setting: { options?: unknown; min?: unknown; max?: unknown }
): SettingLimits | string {
  if (type === "select") {
    return isSelectOptions(setting.options)
      ? { options: setting.options }
      : 'is a select and needs a non-empty "options" array of { label, value } entries with non-blank values';
  }
  if (type !== "number") return {};

  const { min, max } = setting;
  if (!isOptionalFiniteNumber(min) || !isOptionalFiniteNumber(max)) {
    return 'declares a "min" or "max" that is not a finite number';
  }
  // An empty range accepts nothing, so every stored value AND the declared
  // default fall back -- and the default falls back to itself, leaving the
  // setting permanently unusable with nothing on screen to say why.
  if (min !== undefined && max !== undefined && min > max) {
    return `declares min ${min} above max ${max}, a range no value can satisfy`;
  }
  return { min, max };
}

/** Whether an optional bound is absent or a number JSON can carry. */
function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

/** Why this setting's declared default is unusable, or `undefined`. */
function defaultProblem(
  type: WidgetSetting["type"],
  limits: SettingLimits,
  defaultValue: unknown,
  name: string
): string | undefined {
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
    return `setting "${name}" has a function default; widget settings cross the wire as JSON, so a default must be a literal`;
  }
  if (defaultValue === undefined) return undefined;

  /*
   * 🔴 Judged by the SAME table a stored value is, because a default that fails
   * it is worse than a wrong stored value rather than better: a stored value
   * falls back to the default, while a bad default is what everything falls
   * back TO. `resolveWidgetSettings` handed it straight out, so a `number`
   * setting defaulting to `"ten"` reached the query as a string with nothing
   * left to correct it. The refusal is at boot because that is where the author
   * who wrote it is standing.
   */
  if (USABLE_AS[type](defaultValue, limits)) return undefined;

  if (type === "select") {
    return `setting "${name}" defaults to ${describeValue(defaultValue)}, which is not one of its options`;
  }
  const bounded = limits.min !== undefined || limits.max !== undefined;
  return bounded && typeof defaultValue === "number"
    ? `setting "${name}" defaults to ${defaultValue}, outside the range it declares`
    : `setting "${name}" is typed "${type}" but defaults to ${describeValue(defaultValue)}`;
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
  const problem = widgetSettingsProblem(settings);
  if (problem !== undefined) fail(`${widgetId}: ${problem}`);
}

/** Whether a stored value is usable as this setting's type. */
function matchesType(setting: WidgetSetting, value: unknown): boolean {
  return USABLE_AS[setting.type](value, limitsOf(setting));
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

  /*
   * 🔴 A record with NO prototype, because the KEYS are setting names a plugin
   * chose. On a `{}` dictionary `__proto__` is not data: assigning it invokes
   * the legacy prototype setter, so a declared setting of that name was
   * silently dropped from the result and read back as `Object.prototype`. And
   * a stored config reaches this from `JSON.parse`, which DOES create
   * `__proto__` as an own property, so the value arrives to be assigned.
   *
   * The admin's query-slot map is prototype-free for exactly this reason;
   * `constructor` and `toString` misbehave the same way without the confusion.
   */
  const resolved: Record<string, unknown> = Object.create(null);
  for (const setting of settings) {
    const value = stored?.[setting.name];
    if (value !== undefined && matchesType(setting, value)) {
      resolved[setting.name] = value;
      continue;
    }
    // A value the declaration no longer accepts takes the default rather than
    // refusing: the reader did not necessarily write it -- a plugin changing a
    // setting's type, or retiring a select option, across an upgrade produces
    // exactly this -- and a card that refuses to draw is a worse answer than
    // one drawn the way its author intended.
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
