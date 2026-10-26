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
import { SLUG_PATTERN } from "../../shared/slug-pattern";
import { textLength } from "../../shared/text-length";

import type { PublishedContentSource } from "./published-content-source";
import {
  isTimeseriesRange,
  RELATIVE_SPANS,
  whereFieldNames,
  type RelativeSpan,
  type TimeseriesRange,
} from "./query";
import {
  getSource,
  sourceKindFromId,
  type WidgetSourceFilter,
} from "./sources";

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
  /**
   * Whether the setting sits on the card itself, changeable without opening
   * the settings sheet, as Over time's date range does. At most one per widget.
   *
   * A top-level key the field configs do not have, deliberately: it is read by
   * the card's header, never by `FieldRenderer`, which ignores it.
   *
   * Drawn by the card's header at the medium and large tiers, and offered in
   * the card's menu at every size, when the setting is a `select` or a
   * `checkbox`; a change there is saved at once for the reader. A quick
   * setting of any other type stays in the settings sheet.
   *
   * @experimental The shape may still change while the quick setting's
   * controls settle.
   */
  quick?: boolean;
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
    })
  /**
   * Text over several lines, drawn as the field system's own textarea, at
   * most `maxLength` characters when it declares one, counted in code points
   * (`textLength`) by the sheet and the server alike.
   *
   * @experimental Added for a note a reader writes on their own dashboard; the
   * shape may still change, and it is not yet covered by the plugin SDK's
   * stability promise.
   */
  | (WidgetSettingBase & {
      type: "textarea";
      defaultValue?: string;
      maxLength?: number;
    });

/**
 * A setting over the site's content: the collection a card reads, and the
 * filter, sort and grouping over that collection.
 *
 * The same vocabulary as `WidgetSetting`, judged by the same table, the same
 * declaration rules and the same reader below. A dependent setting (`filter`,
 * `sort`, `groupBy`) names in `of` the Collection setting it works over.
 *
 * 🔴 Not a member of `WidgetSetting`, and that is about drawing, not about
 * rules. `WidgetSetting` is what the settings sheet hands to `FieldRenderer`
 * with no cast, and no field config draws a collection picker or a filter
 * builder: the sheet draws these with controls of its own, from the choices
 * the server offers the reader.
 *
 * Registration refuses one that no knob of `applyWidgetSettings` drives
 * (`CONTENT_SETTING_NOT_DRAWN`), for a reason about the QUERY rather than the
 * sheet: a registered widget's settings reach its query only through those
 * knobs, so a setting no knob drives would be drawn and saved and change
 * nothing the card shows.
 *
 * @experimental The shape may still change while the settings sheet's
 * content controls are built.
 */
export type ContentSetting =
  | (WidgetSettingBase & {
      type: "collection";
      defaultValue?: string;
      /**
       * `"titled"`: on a list, each row is asked by the collection's title
       * field, its status where it has a draft and published lifecycle, and
       * when it was updated, read from the collection the setting names. A
       * collection naming no title, or with no `updatedAt`, gives the card no
       * source, so it asks nothing there rather than whole rows.
       *
       * @experimental
       */
      rows?: "titled";
    })
  | (WidgetSettingBase & {
      type: "filter";
      of: string;
      defaultValue?: Record<string, unknown>;
    })
  | (WidgetSettingBase & { type: "sort"; of: string; defaultValue?: string })
  | (WidgetSettingBase & {
      type: "groupBy";
      of: string;
      defaultValue?: string;
      /**
       * `"collection"`: when the card states no grouping, or one this reader
       * may not use, group by what the collection most naturally divides by
       * ({@link naturalGroupBy}): status where it has a lifecycle, else its
       * first groupable choice field. For a widget offered per collection,
       * whose collections need not share a field a static default could name.
       *
       * @experimental While the content widgets are being built.
       */
      defaultFrom?: "collection";
    });

/**
 * Every setting core's rules judge and its reader reads.
 *
 * @experimental As {@link ContentSetting}, which it includes.
 */
export type AnyWidgetSetting = WidgetSetting | ContentSetting;

/**
 * The types of setting that work over a Collection setting, named in `of`: a
 * filter, a sort or a grouping only means something over a known collection.
 */
const DEPENDENT_TYPES: ReadonlySet<AnyWidgetSetting["type"]> = new Set([
  "filter",
  "sort",
  "groupBy",
]);

/** A setting that works over one of its widget's Collection settings. */
type DependentSetting = Extract<AnyWidgetSetting, { of: string }>;

/** Whether a setting names, in `of`, the Collection setting it works over. */
function isDependent(setting: AnyWidgetSetting): setting is DependentSetting {
  return DEPENDENT_TYPES.has(setting.type);
}

/**
 * The stable mark of registration's refusal of a content setting, which a
 * test or a caller can match whatever the sentence around it says.
 */
export const CONTENT_SETTING_NOT_DRAWN = "WIDGET_CONTENT_SETTING_NOT_DRAWN";

/** The setting types `FieldRenderer` draws, as registration admits them. */
const FIELD_DRAWN: Record<WidgetSetting["type"], true> = {
  text: true,
  number: true,
  checkbox: true,
  select: true,
  textarea: true,
};

/** Whether a setting is one a registered widget's query cannot apply yet. */
function isContentSetting(
  setting: AnyWidgetSetting
): setting is ContentSetting {
  return !Object.hasOwn(FIELD_DRAWN, setting.type);
}

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
  /** The most characters a textarea takes, counted by `textLength`. */
  maxLength?: number;
}

const USABLE_AS: Record<
  AnyWidgetSetting["type"],
  (value: unknown, limits: SettingLimits) => boolean
> = {
  text: value => typeof value === "string",
  textarea: (value, limits) =>
    typeof value === "string" &&
    (limits.maxLength === undefined || textLength(value) <= limits.maxLength),
  number: (value, limits) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    withinBounds(value, limits),
  checkbox: value => typeof value === "boolean",
  select: (value, limits) =>
    typeof value === "string" &&
    limits.options !== undefined &&
    limits.options.some(option => option.value === value),
  // A collection, a sort and a grouping each name something: a blank name
  // names nothing, so it is no more usable than an absent one.
  collection: value => isName(value),
  sort: value => isName(value),
  groupBy: value => isName(value),
  // The list view's conditions: a plain object of them.
  filter: value =>
    typeof value === "object" && value !== null && !Array.isArray(value),
};

/** A textarea setting's declared bound, with the label a reader knows it by. */
export interface TextBound {
  name: string;
  label: string;
  maxLength: number;
}

/**
 * The bounds a widget's textarea settings declare, which the layout write holds
 * a placement's text to.
 *
 * `undefined` when the declaration states no settings at all, and an empty
 * list when it states settings none of which is a bounded textarea: a merge of
 * two declarations takes the registration's settings wherever it states any,
 * so it has to tell the two apart.
 */
export function textBoundsOf(
  settings: readonly AnyWidgetSetting[] | undefined
): readonly TextBound[] | undefined {
  return settings?.flatMap(setting =>
    setting.type === "textarea" && setting.maxLength !== undefined
      ? [
          {
            name: setting.name,
            label: setting.label ?? setting.name,
            maxLength: setting.maxLength,
          },
        ]
      : []
  );
}

/** Whether a value names something: a string with more than blanks in it. */
function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

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
function limitsOf(setting: AnyWidgetSetting): SettingLimits {
  if (setting.type === "select") return { options: setting.options };
  if (setting.type === "number") return { min: setting.min, max: setting.max };
  if (setting.type === "textarea") return { maxLength: setting.maxLength };
  return {};
}

/** Whether this is a type a setting may declare. */
function isSettingType(value: unknown): value is AnyWidgetSetting["type"] {
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
export function widgetSettingsProblem(
  settings: unknown,
  queryBuiltByCore = false,
  // What the widget asks, as `settingsSourceOf` reads it.
  source?: SettingsSource
): string | undefined {
  const [problem] = widgetSettingsProblems(settings);
  if (problem !== undefined) return problem;
  // A widget whose query core builds from its declaration reads its content
  // settings there, so they reach the data it shows: nothing to refuse.
  if (queryBuiltByCore) return undefined;
  // One Collection setting decides the source: a second would be drawn and
  // saved and always lose to the other.
  const collections = (settings as readonly AnyWidgetSetting[] | undefined)
    ?.filter(setting => setting.type === "collection")
    .map(setting => setting.name);
  if (collections !== undefined && collections.length > 1) {
    return `declares ${collections.length} Collection settings (${collections.map(name => `"${name}"`).join(", ")}), and one decides the source its query reads`;
  }
  const filtered = cellFilterProblem(
    (settings as readonly AnyWidgetSetting[] | undefined) ?? [],
    source
  );
  if (filtered !== undefined) return filtered;
  // Every setting is now known to be well formed, so each has a type. Any
  // other widget's content setting is admitted exactly when a knob drives it
  // on the widget's own source, so a setting that would change nothing the
  // card asks is never offered.
  const content = (settings as readonly AnyWidgetSetting[] | undefined)?.find(
    (setting): setting is ContentSetting =>
      isContentSetting(setting) && !drivenOn(setting, source)
  );
  return content === undefined ? undefined : contentSettingRefusal(content);
}

/**
 * Registration's refusal of a setting a registered widget's query cannot apply
 * yet, saying what to use instead. It carries `CONTENT_SETTING_NOT_DRAWN`, so it
 * can be told apart from every other settings fault by more than its words.
 */
function contentSettingRefusal({ name, type }: ContentSetting): string {
  return (
    `setting "${name}" is a "${type}" setting, which a registered widget's query cannot apply yet ` +
    `(${CONTENT_SETTING_NOT_DRAWN}): use a text, number, checkbox or select ` +
    `setting until those settings reach a registered widget's query`
  );
}

/**
 * Every problem with a set of settings, of any of the eight types, in the
 * order they were declared; empty when there is none.
 *
 * The declaration's channel reads all of them, naming every fault at once; the
 * registry's two channels read the first (`widgetSettingsProblem`). One rule
 * set for both, so a declared setting and a registered one cannot be judged
 * two ways.
 */
export function widgetSettingsProblems(settings: unknown): string[] {
  if (settings === undefined) return [];
  if (!Array.isArray(settings)) return ['"settings" must be an array'];
  if (settings.length > MAX_WIDGET_SETTINGS) {
    return [`at most ${MAX_WIDGET_SETTINGS} settings, got ${settings.length}`];
  }

  const seen = new Set<string>();
  const problems: string[] = [];
  const wellFormed: AnyWidgetSetting[] = [];
  for (const setting of settings) {
    const problem = settingProblem(setting, seen);
    if (problem === undefined) wellFormed.push(setting as AnyWidgetSetting);
    else problems.push(problem);
  }
  // Every kind in one answer, so one restart names every fault.
  return [
    ...problems,
    ...dependencyProblems(wellFormed, settings),
    ...quickProblems(wellFormed),
  ];
}

/**
 * Why a widget's settings mark too many as quick, or nothing when they do not.
 *
 * A card's header holds one quick setting: two would each take the
 * header's one place, and which one a person saw would depend on the order
 * they were declared in.
 */
function quickProblems(settings: readonly AnyWidgetSetting[]): string[] {
  const quick = settings.filter(setting => setting.quick === true);
  if (quick.length <= 1) return [];
  return [
    `settings ${quick.map(setting => `"${setting.name}"`).join(", ")} are all marked quick; a widget may mark at most one`,
  ];
}

/**
 * Every well-formed dependent setting whose `of` names no Collection setting
 * of the same widget.
 *
 * A property of the SET: the name a dependency gives is only right or wrong
 * against its siblings. A Collection setting counts by its name even when it
 * has a fault of its own, which is reported once, as itself, rather than
 * again through every setting that depends on it.
 */
function dependencyProblems(
  dependents: readonly AnyWidgetSetting[],
  all: readonly unknown[]
): string[] {
  const collections = new Set(
    all
      .filter(
        (setting): setting is { type: "collection"; name: string } =>
          typeof setting === "object" &&
          setting !== null &&
          (setting as { type?: unknown }).type === "collection" &&
          typeof (setting as { name?: unknown }).name === "string"
      )
      .map(setting => setting.name)
  );
  return dependents
    .filter(isDependent)
    .filter(setting => !collections.has(setting.of))
    .map(
      setting =>
        `setting "${setting.name}" depends on ${describeValue(setting.of)}, which is not a Collection setting of this widget`
    );
}

/**
 * The fault for a setting that is not an object at all. Named so a caller that
 * can say which setting it was, as a declaration keyed by name can, puts its
 * own words in place of this one.
 */
export const SETTING_NOT_AN_OBJECT = "every setting must be an object";

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
    return SETTING_NOT_AN_OBJECT;
  }
  const { name, type, defaultValue, quick, defaultFrom, ...rest } = setting as {
    name?: unknown;
    type?: unknown;
    defaultValue?: unknown;
    quick?: unknown;
    defaultFrom?: unknown;
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
  const flags = flagsProblem(
    type,
    quick,
    (rest as { rows?: unknown }).rows,
    defaultFrom
  );
  if (flags !== undefined) return `setting "${name}" ${flags}`;

  return problemForType(type, rest, defaultValue, name);
}

/** Why a setting's `quick`, `rows` or `defaultFrom` is unusable, or `undefined`. */
function flagsProblem(
  type: AnyWidgetSetting["type"],
  quick: unknown,
  rows: unknown,
  defaultFrom: unknown
): string | undefined {
  if (quick !== undefined && typeof quick !== "boolean") {
    return `has quick ${describeValue(quick)}; expected true or false`;
  }
  // Refused rather than ignored: a misspelt value, or the flag on a setting
  // it means nothing to, would otherwise leave a card grouped by nothing with
  // no fault anywhere pointing at the declaration.
  if (
    defaultFrom !== undefined &&
    (type !== "groupBy" || defaultFrom !== "collection")
  ) {
    return `has defaultFrom ${describeValue(defaultFrom)}; only a Group by setting takes it, as "collection"`;
  }
  return rowsProblem(type, rows);
}

/**
 * Why a setting's `rows` is unusable, or `undefined`: only a Collection setting
 * says how a list asks its rows, and only one way, `"titled"`.
 */
function rowsProblem(
  type: AnyWidgetSetting["type"],
  rows: unknown
): string | undefined {
  if (rows === undefined) return undefined;
  if (type !== "collection")
    return "declares rows, which only a Collection setting takes";
  return rows === "titled"
    ? undefined
    : `has rows ${describeValue(rows)}; expected "titled"`;
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
  type: AnyWidgetSetting["type"],
  setting: {
    options?: unknown;
    min?: unknown;
    max?: unknown;
    maxLength?: unknown;
  },
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
  type: AnyWidgetSetting["type"],
  setting: {
    options?: unknown;
    min?: unknown;
    max?: unknown;
    maxLength?: unknown;
  }
): SettingLimits | string {
  if (type === "textarea") return textareaLimits(setting.maxLength);
  if (type === "select") return selectLimits(setting.options);
  if (type === "number") return numberLimits(setting.min, setting.max);
  return {};
}

/** A select's declared options, or why they cannot be read. */
function selectLimits(options: unknown): SettingLimits | string {
  return isSelectOptions(options)
    ? { options }
    : 'is a select and needs a non-empty "options" array of { label, value } entries with non-blank values';
}

/** A number's declared range, or why it cannot be read. */
function numberLimits(min: unknown, max: unknown): SettingLimits | string {
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

/**
 * A textarea's declared length, or why it cannot be read: absent, or a whole
 * number of characters above zero. A bound of zero would accept only an empty
 * note, and a fraction no length can meet.
 */
function textareaLimits(maxLength: unknown): SettingLimits | string {
  if (maxLength === undefined) return {};
  return typeof maxLength === "number" &&
    Number.isInteger(maxLength) &&
    maxLength > 0
    ? { maxLength }
    : 'declares a "maxLength" that is not a whole number of characters above zero';
}

/** Whether an optional bound is absent or a number JSON can carry. */
function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

/** Why this setting's declared default is unusable, or `undefined`. */
function defaultProblem(
  type: AnyWidgetSetting["type"],
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
  return defaultMismatch(type, limits, defaultValue, name);
}

/** Why a declared default the table refuses is refused, in the author's terms. */
function defaultMismatch(
  type: AnyWidgetSetting["type"],
  limits: SettingLimits,
  defaultValue: unknown,
  name: string
): string {
  if (type === "select") {
    return `setting "${name}" defaults to ${describeValue(defaultValue)}, which is not one of its options`;
  }
  if (type === "textarea" && typeof defaultValue === "string") {
    return `setting "${name}" defaults to text longer than its maxLength of ${limits.maxLength} characters`;
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
  widgetId: string,
  queryBuiltByCore = false,
  source?: SettingsSource
): asserts settings is AnyWidgetSetting[] | undefined {
  const problem = widgetSettingsProblem(settings, queryBuiltByCore, source);
  if (problem !== undefined) fail(`${widgetId}: ${problem}`);
}

/** Whether a stored value is usable as this setting's type. */
function matchesType(setting: AnyWidgetSetting, value: unknown): boolean {
  return USABLE_AS[setting.type](value, limitsOf(setting));
}

/** The default a setting declares, or `undefined` when it declares none. */
function declaredDefault(setting: AnyWidgetSetting): unknown {
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
  settings: readonly AnyWidgetSetting[] | undefined,
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
  // The settings a dependent one works over first, since it reads them.
  const ordered = [
    ...settings.filter(setting => !isDependent(setting)),
    ...settings.filter(isDependent),
  ];
  for (const setting of ordered) {
    const value = stored?.[setting.name];
    // A dependent setting whose Collection setting has no value is hidden by
    // it: there is nothing to filter, sort or group, so its stored value is
    // not handed on, and its starting value is.
    const hidden = isDependent(setting) && resolved[setting.of] === undefined;
    if (!hidden && value !== undefined && matchesType(setting, value)) {
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
 * The field a collection's entries most naturally divide by, or `undefined`
 * when it has none: what a Group by setting stands for when the card leaves it
 * to the collection.
 *
 * `status` on a collection with a draft and published lifecycle, since it is
 * the one column every such collection shares and means the same thing on
 * each. Otherwise the first field with choices that can be grouped by: a
 * choice field's buckets are few and named, where a free-text column's are
 * neither. Read from what the source publishes to this reader, which already
 * leaves out every field a read rule could refuse, so no ruled field is ever
 * the answer.
 *
 * @experimental While the content widgets are being built.
 */
export function naturalGroupBy(source: {
  lifecycle: boolean;
  fields: readonly (KnobField & { choices?: readonly unknown[] })[];
}): string | undefined {
  if (source.lifecycle) return "status";
  return source.fields.find(
    field => field.choices !== undefined && field.groupable !== false
  )?.name;
}

/**
 * A field a collection offers this reader for a card's settings, as its
 * source publishes it.
 *
 * @experimental
 */
export interface KnobField {
  name: string;
  /** False when a read rule could refuse the field to this reader. */
  offered?: boolean;
  /** False when the field cannot be grouped by. */
  groupable?: boolean;
}

/**
 * The source a widget declares, as its knobs see it. A knob may drive a setting
 * on one kind of source and not another, and set a different part of the query
 * on each, so both questions are asked of the source too.
 *
 * @experimental The shape may grow while the content widgets are built.
 */
export interface KnobSource {
  id: string;
  /**
   * The settings the source narrows its answer by rather than being replaced
   * by (`WidgetSource.filters`): each one a knob sets as a key of the query's
   * `where`, on this source alone.
   */
  filters?: readonly WidgetSourceFilter[];
}

/**
 * A source as its knobs see it, its filters read from the source registry.
 *
 * The one place a widget's knob source is built on the server: admission reads
 * it when a widget registers, and the payload carries its filters to the admin,
 * whose knobs build the query from them. A source not registered yet has none,
 * which is why core's system sources register before core's widgets.
 *
 * @experimental The shape may grow while the content widgets are built.
 */
export function knobSourceFor(id: string): KnobSource {
  const filters = getSource(id)?.filters;
  return filters === undefined ? { id } : { id, filters: [...filters] };
}

/**
 * What a widget's settings are judged against: its query's source, `undefined`
 * for a query a Collection setting supplies one to, `null` for a widget that
 * asks nothing a knob could drive, or each of its cells' sources, `undefined`
 * for a cell a Collection setting supplies one to.
 */
export type SettingsSource =
  | KnobSource
  | null
  | undefined
  | { cells: readonly (KnobSource | undefined)[] };

/**
 * What a widget declaration asks, as its settings are judged against it. Read
 * defensively: a malformed query or cell is another rule's to refuse by name,
 * so here it simply names no source.
 */
export function settingsSourceOf(widget: {
  query?: unknown;
  cells?: unknown;
}): SettingsSource {
  if (typeof widget.query === "object" && widget.query !== null) {
    return declaredKnobSource(widget.query);
  }
  if (!Array.isArray(widget.cells) || widget.cells.length === 0) return null;
  return {
    cells: widget.cells.map((cell: unknown) =>
      typeof cell === "object" && cell !== null
        ? declaredKnobSource((cell as { query?: unknown }).query)
        : undefined
    ),
  };
}

/**
 * The first setting a cells card's knobs would drive only through a cell
 * source's filters (Only mine, or a Collection setting over a source reading
 * across collections), or `undefined`. The admin asks each cell with no
 * filter metadata, so such a setting would be drawn, saved and left out of
 * every cell's query: refused until the cells are asked with their filters.
 */
function cellFilterProblem(
  settings: readonly AnyWidgetSetting[],
  source: SettingsSource
): string | undefined {
  // A cells card cannot yet ask its cells with their sources' filters, so a
  // setting only a filter would apply is refused, whatever its type.
  if (source === null || source === undefined || !("cells" in source)) {
    return undefined;
  }
  const filtered = filterOnlyCellSetting(settings, source.cells);
  return filtered === undefined
    ? undefined
    : `setting "${filtered.name}" is applied through its source's filters, which a widget's cells are not asked with yet`;
}

function filterOnlyCellSetting(
  settings: readonly AnyWidgetSetting[],
  cells: readonly (KnobSource | undefined)[]
): AnyWidgetSetting | undefined {
  return settings.find(setting =>
    cells.some(
      cell =>
        cell?.filters !== undefined &&
        knobFor(setting, cell) !== undefined &&
        knobFor(setting, { id: cell.id }) === undefined
    )
  );
}

/** The knob source a query declares, or `undefined` when it names none. */
function declaredKnobSource(query: unknown): KnobSource | undefined {
  const source =
    typeof query === "object" && query !== null
      ? (query as { source?: unknown }).source
      : undefined;
  return typeof source === "string" ? knobSourceFor(source) : undefined;
}

/**
 * Whether a knob drives `setting` on what the widget asks: on its one source,
 * or, for a card that asks through cells, on at least one cell's, so a setting
 * no cell can apply is never drawn.
 */
function drivenOn(setting: AnyWidgetSetting, source: SettingsSource): boolean {
  if (source !== null && source !== undefined && "cells" in source) {
    return source.cells.some(cell => knobFor(setting, cell) !== undefined);
  }
  return knobFor(setting, source) !== undefined;
}

/** Whether `source` declares that it narrows by `filter`. */
function narrowsBy(
  source: KnobSource | undefined,
  filter: WidgetSourceFilter
): boolean {
  return source?.filters?.includes(filter) === true;
}

/**
 * What the knobs may consult beyond the settings themselves, as one object so
 * a later need adds a member rather than a parameter.
 *
 * @experimental The shape may grow while the content widgets are built.
 */
export interface KnobContext {
  /** The widget's declared source; the query's own when absent. */
  source?: KnobSource;
  /**
   * The fields a collection offers this reader, or `undefined` when they are
   * not known. Unknown, a stored value is applied as it is and the server
   * judges the query, as it judges every query.
   */
  fieldsOf?: (collection: string) => readonly KnobField[] | undefined;
  /**
   * The collection a slug names, as the server published it to this reader,
   * or `undefined` when it is not known: what a setting whose default depends
   * on the collection reads (`defaultFrom`).
   *
   * @experimental
   */
  sourceOf?: (collection: string) => PublishedContentSource | undefined;
}

/** The parts of a widget query a setting may drive. */
interface KnobQuery {
  source?: string;
  op?: string;
  select?: string[];
  limit?: number;
  since?: RelativeSpan;
  range?: TimeseriesRange;
  where?: Record<string, unknown>;
  sort?: string;
  groupBy?: string;
}

/**
 * A query as settings may leave it: as declared with each knob applied, or,
 * for a titled list set to a collection it cannot title, the same with no
 * source and no fields, which asks nothing.
 *
 * @experimental While the content widgets are being built.
 */
export type AskedQuery<T> =
  | T
  | (T extends unknown
      ? Omit<T, "source" | "select"> & {
          source?: undefined;
          select?: undefined;
        }
      : never);

/** How one kind of setting becomes part of a card's query. */
interface QueryKnob {
  /** Whether this knob drives `setting` on `source`, or on no source. */
  drives(setting: AnyWidgetSetting, source: KnobSource | undefined): boolean;
  /**
   * Whether `value` names only fields the reader may use as this knob uses
   * them. Absent, every value fits: the knob names no field.
   */
  fits?(value: unknown, fields: readonly KnobField[]): boolean;
  /**
   * `query` with `value` applied on `source`: a copy, never the query itself.
   * Handed the setting and the context too, for a knob whose setting says
   * more about the query than its value.
   */
  apply<T extends KnobQuery>(
    query: T,
    value: unknown,
    source: KnobSource | undefined,
    setting: AnyWidgetSetting,
    ctx: KnobContext
  ): T;
}

/**
 * `query` reading the collection `slug` names. A titled list asks its rows'
 * named fields too, or, where the collection publishes none, keeps no source
 * and asks nothing at all.
 */
function readingCollection<T extends KnobQuery>(
  query: T,
  slug: string,
  setting: AnyWidgetSetting,
  ctx: KnobContext
): T {
  const titled =
    setting.type === "collection" &&
    setting.rows === "titled" &&
    query.op === "list";
  if (!titled) return { ...query, source: `collection:${slug}` };
  const select = titledRows(ctx.sourceOf?.(slug));
  if (select !== undefined) {
    return { ...query, source: `collection:${slug}`, select };
  }
  // Nor the source the widget was declared with: a card set to a collection
  // it cannot title reads nothing, never another collection's rows. Typed as
  // `T` for the knobs that follow; `applyWidgetSettings` says it may be this.
  if (query.source === undefined && query.select === undefined) return query;
  const sourceless: T = { ...query };
  delete sourceless.source;
  delete sourceless.select;
  return sourceless;
}

/**
 * What a titled list asks of each row in `collection`: its title, its status
 * where it has a lifecycle, and when it was updated. `undefined` where the
 * collection is not known, names no title, or has no `updatedAt`.
 */
function titledRows(
  collection: PublishedContentSource | undefined
): string[] | undefined {
  const title = collection?.titleField;
  if (title === undefined) return undefined;
  if (!collection?.fields.some(field => field.name === "updatedAt")) {
    return undefined;
  }
  return [title, ...(collection.lifecycle ? ["status"] : []), "updatedAt"];
}

/** The source a query names, as its knobs see it. */
function knobSourceOf(query: KnobQuery): KnobSource | undefined {
  return typeof query.source === "string" ? { id: query.source } : undefined;
}

/**
 * Whether a content knob may drive on `source`: a collection's, or none yet.
 * Each content setting reads a collection's entries and fields, so on another
 * kind of source it would mean something else, and drives nothing there.
 */
function readsACollection(source: KnobSource | undefined): boolean {
  return source === undefined || sourceKindFromId(source.id) === "collection";
}

/**
 * A declared `where` narrowed further by the reader's Filter. The declared
 * clause keeps its top-level keys, where a collection's workflow conditions
 * must stay to be read, and the Filter joins them under `and`; with nothing
 * declared, the Filter is the clause.
 */
function withReaderFilter(
  declared: Record<string, unknown> | undefined,
  filter: Record<string, unknown>
): Record<string, unknown> {
  if (declared === undefined) return filter;
  const joined = Array.isArray(declared.and) ? declared.and : [];
  return { ...declared, and: [...joined, filter] };
}

/** Whether a value is one of the query's window spans. */
function isRelativeSpan(value: unknown): value is RelativeSpan {
  return (RELATIVE_SPANS as readonly unknown[]).includes(value);
}

/** The ops a window bounds: a count, and a timeseries. */
const WINDOWED_OPS: ReadonlySet<string> = new Set(["count", "timeseries"]);

/** The field a sort names, without its direction. */
function sortField(sort: string): string {
  return sort.startsWith("-") ? sort.slice(1) : sort;
}

/** Whether every name is a field offered to this reader. */
function allOffered(
  names: readonly string[],
  fields: readonly KnobField[]
): boolean {
  return names.every(name =>
    fields.some(field => field.name === name && field.offered !== false)
  );
}

/**
 * Query knobs a setting may drive: ONE closed map from a kind of setting to
 * how it becomes part of the card's query.
 *
 * 🔴 Closed, and the only way a setting reaches a query. A setting no knob
 * drives changes nothing the card asks, so registration refuses it rather than
 * drawing a control that does nothing (`CONTENT_SETTING_NOT_DRAWN`).
 *
 * `limit` is matched by NAME as well as type, as it always was: a number
 * setting called `limit` sets how many rows the card asks for, and a number
 * setting of any other name drives nothing. The content kinds are matched by
 * type alone, since each type has one meaning for a query.
 */
const QUERY_KNOBS: readonly QueryKnob[] = [
  {
    drives: setting => setting.type === "number" && setting.name === "limit",
    apply: (query, value) => ({ ...query, limit: value as number }),
  },
  {
    // The collection a card reads becomes its source, replacing the one the
    // widget declared, which is how a widget offered per collection reads the
    // one it was added from. The reader's access to it is the server's to
    // judge, as for any source a query names. A source reading across
    // collections that narrows by one (`filters`) is not replaced: the
    // collection becomes its `where.collection` instead.
    drives: (setting, source) =>
      setting.type === "collection" &&
      (readsACollection(source) || narrowsBy(source, "collection")),
    apply: (query, value, source, setting, ctx) => {
      // Only a value shaped like a collection slug names one, read before any
      // use of it: a special default such as "*" leaves the query as it is.
      if (typeof value !== "string" || !SLUG_PATTERN.test(value)) return query;
      if (!readsACollection(source) && narrowsBy(source, "collection")) {
        return { ...query, where: { ...query.where, collection: value } };
      }
      return readingCollection(query, value, setting, ctx);
    },
  },
  {
    // A card's Date range is how far back its read reaches, for a select that
    // offers only the query's own spans: its value becomes `since` as is, on an
    // op a window bounds. A select of the same name offering anything else is
    // the widget's own, and leaves the query as it was declared.
    //
    // A chart over a range declares its `range`, and there the value becomes
    // the range instead, when it is one: a range and a `since` each name a
    // window, so the declared range is never joined by a `since`.
    drives: (setting, source) =>
      setting.type === "select" &&
      setting.name === "dateRange" &&
      setting.options.every(option => isRelativeSpan(option.value)) &&
      readsACollection(source),
    apply: (query, value) => {
      if (query.range !== undefined) {
        return isTimeseriesRange(value) ? { ...query, range: value } : query;
      }
      return isRelativeSpan(value) &&
        query.op !== undefined &&
        WINDOWED_OPS.has(query.op)
        ? { ...query, since: value }
        : query;
    },
  },
  {
    drives: (setting, source) =>
      setting.type === "filter" && readsACollection(source),
    fits: (value, fields) =>
      allOffered(whereFieldNames(value as Record<string, unknown>), fields),
    apply: (query, value) => ({
      ...query,
      where: withReaderFilter(query.where, value as Record<string, unknown>),
    }),
  },
  {
    drives: (setting, source) =>
      setting.type === "sort" && readsACollection(source),
    fits: (value, fields) => allOffered([sortField(value as string)], fields),
    apply: (query, value) => ({ ...query, sort: value as string }),
  },
  {
    drives: (setting, source) =>
      setting.type === "groupBy" && readsACollection(source),
    fits: (value, fields) =>
      fields.some(
        field =>
          field.name === value &&
          field.offered !== false &&
          field.groupable !== false
      ),
    apply: (query, value) => ({ ...query, groupBy: value as string }),
  },
  {
    // Only mine: the reader's own rows, on a source that narrows by it. The
    // query says only that it is on; who "mine" is, the source reads from the
    // caller, so no id travels in it. Matched by NAME as well as type, as
    // `limit` is, since a checkbox has no meaning of its own for a query.
    drives: (setting, source) =>
      setting.type === "checkbox" &&
      setting.name === "onlyMine" &&
      narrowsBy(source, "onlyMine"),
    apply: (query, value) =>
      value === true
        ? { ...query, where: { ...query.where, onlyMine: true } }
        : { ...query },
  },
];

/** The knob that drives a setting on a source, or `undefined` when none does. */
function knobFor(
  setting: AnyWidgetSetting,
  source: KnobSource | null | undefined
): QueryKnob | undefined {
  // A widget that asks nothing a knob could drive has no knob for any setting.
  if (source === null) return undefined;
  return QUERY_KNOBS.find(knob => knob.drives(setting, source));
}

/**
 * The value a setting drives its knob with: the resolved one, or its default
 * when the resolved one names a field this reader may not use, or nothing when
 * the default does too.
 *
 * Decided BEFORE the query is built, so a card whose stored Filter, Sort or
 * Group by names a field a read rule now withholds is asked as its author
 * intended by default rather than refused: the reader did not necessarily
 * choose that field, and a card that will not draw is the worse answer. The
 * server still refuses any query naming such a field, so this is the first
 * answer, not the only guard.
 */
function fittingValue(
  setting: AnyWidgetSetting,
  knob: QueryKnob,
  resolved: Record<string, unknown>,
  ctx: KnobContext | undefined
): unknown {
  const value = resolved[setting.name];
  const fields = readerFieldsFor(setting, resolved, ctx);
  // Unknown fields, or a knob naming none: every value fits, and the server
  // judges the query.
  const fits = (candidate: unknown) =>
    knob.fits === undefined ||
    fields === undefined ||
    knob.fits(candidate, fields);
  if (value !== undefined && fits(value)) return value;
  // Unset (a static default would already be the resolved value) or not
  // fitting: the default, held to the same test. A default taken from the
  // collection is how an unset Group by gets a value at all, and a card
  // converted from an older one stores only its collection.
  const fallback = defaultFor(setting, resolved, ctx);
  return fallback !== undefined && fits(fallback) ? fallback : undefined;
}

/**
 * The value a setting falls back to: its declared default, or, for a Group by
 * setting that takes its default from the collection, what that collection
 * most naturally divides by. One reading, so the unset card and the card whose
 * stored grouping a read rule withholds fall back to the same field.
 */
function defaultFor(
  setting: AnyWidgetSetting,
  resolved: Record<string, unknown>,
  ctx: KnobContext | undefined
): unknown {
  const declared = declaredDefault(setting);
  if (declared !== undefined) return declared;
  if (setting.type !== "groupBy" || setting.defaultFrom !== "collection") {
    return undefined;
  }
  const collection = resolved[setting.of];
  const source =
    typeof collection === "string" ? ctx?.sourceOf?.(collection) : undefined;
  return source === undefined ? undefined : naturalGroupBy(source);
}

/**
 * A card's settings as its query is asked with them: each resolved value, with
 * a setting that drives a knob on `ctx.source` held to what fits this reader
 * ({@link fittingValue}), and left out when nothing does. What a card is drawn
 * from, so a link it builds from its Filter names the filter its number was
 * counted under, not a stored one the query set aside.
 *
 * @experimental The shape may grow while the content widgets are built.
 */
export function effectiveWidgetSettings(
  settings: readonly AnyWidgetSetting[] | undefined,
  stored: Record<string, unknown> | undefined,
  ctx: KnobContext = {}
): Record<string, unknown> {
  const resolved = resolveWidgetSettings(settings, stored);
  // Prototype-free, as the resolved settings are: the keys are setting names.
  const effective: Record<string, unknown> = Object.assign(
    Object.create(null),
    resolved
  );
  for (const setting of settings ?? []) {
    const knob = knobFor(setting, ctx.source);
    if (knob === undefined) continue;
    const value = fittingValue(setting, knob, resolved, ctx);
    if (value === undefined) delete effective[setting.name];
    else effective[setting.name] = value;
  }
  return effective;
}

/**
 * The fields the collection a dependent setting reads offers this reader, or
 * `undefined` when the setting depends on none or they are not known.
 */
function readerFieldsFor(
  setting: AnyWidgetSetting,
  resolved: Record<string, unknown>,
  ctx: KnobContext | undefined
): readonly KnobField[] | undefined {
  if (!isDependent(setting)) return undefined;
  const collection = resolved[setting.of];
  return typeof collection === "string"
    ? ctx?.fieldsOf?.(collection)
    : undefined;
}

/**
 * The query this card should ask, given what its reader chose.
 *
 * 🔴 Nothing is clamped or re-validated here. `validateReadWidgetQuery` bounds
 * every query the endpoint accepts — `clampLimit` already turns a hostile or
 * absurd limit into a legal one — and the caller composing this query is the
 * admin, whose requests go through exactly that gate. Re-checking here would be
 * a second implementation of a rule this module cannot see, agreeing on the day
 * it is written and drifting afterwards, which is the mistake
 * `executeWidgetQuery` warns about for filters. The one judgement made here is
 * which stored value to use ({@link fittingValue}), and the server still makes
 * its own.
 *
 * Returns the query UNCHANGED when nothing applies, so a caller can use the
 * result unconditionally without asking whether it needed to.
 */
export function applyWidgetSettings<T extends KnobQuery>(
  query: T,
  settings: readonly AnyWidgetSetting[] | undefined,
  stored: Record<string, unknown> | undefined,
  ctx: KnobContext = {}
): AskedQuery<T> {
  if (!settings || settings.length === 0) return query;
  // Judged on the DECLARED source, read once before any knob may replace it.
  const source = ctx.source ?? knobSourceOf(query);

  const effective = effectiveWidgetSettings(settings, stored, {
    ...ctx,
    ...(source === undefined ? {} : { source }),
  });
  let next = query;

  for (const setting of settings) {
    const knob = knobFor(setting, source);
    if (knob === undefined) continue;
    const value = effective[setting.name];
    if (value === undefined) continue;
    // Each knob hands back a copy, so a card whose settings drive no knob
    // keeps the query it was given, which is what lets a caller apply this to
    // every card without a branch. Every knob sees the DECLARED source, not
    // one an earlier knob put in its place.
    next = knob.apply(next, value, source, setting, ctx);
  }

  return next;
}
