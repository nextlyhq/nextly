/**
 * Which of a card's settings the settings drawer draws as a short row of choices, and what those
 * choices are. Pure, and apart from the drawer, so the grid can ask which setting is a list's
 * "Number of entries" without loading the drawer.
 *
 * @module components/features/widgets/edit/drawer-choices
 */

import type { AnyWidgetSetting, WidgetSetting } from "nextly/config";

import type { SegmentedOption } from "./SegmentedChoice";

/** A list card's "Number of entries": a number setting keyed `limit`. */
export type EntriesSetting = Extract<WidgetSetting, { type: "number" }>;

/**
 * Whether `setting` is a list card's "Number of entries": the number every list card keys
 * `limit`, which its `load` reads through `listEntries`. The one reading of it, for the drawer's
 * choice and for the rows a card's held answer is drawn by.
 */
export function isEntriesSetting(
  setting: AnyWidgetSetting
): setting is EntriesSetting {
  return setting.name === "limit" && setting.type === "number";
}

/** The numbers of entries a list card offers, where its setting's bounds allow them. */
const ENTRIES_CHOICES: readonly number[] = [5, 10, 20];

/**
 * The choices the drawer offers for a "Number of entries": 5, 10 and 20 where the setting's
 * bounds allow them, and the value the drawer opened on wherever it is not one of those (a 7
 * saved before), so a stored number is shown as chosen and kept until the reader picks another.
 * Empty when none of them fits the bounds: the drawer then draws the plain number field.
 */
export function entriesChoices(
  setting: EntriesSetting,
  opened: unknown
): number[] {
  const within = (value: number) =>
    (setting.min === undefined || value >= setting.min) &&
    (setting.max === undefined || value <= setting.max);
  const offered = ENTRIES_CHOICES.filter(within);
  if (offered.length === 0) return [];
  const kept =
    typeof opened === "number" && Number.isInteger(opened) && within(opened)
      ? [opened]
      : [];
  return [...new Set([...offered, ...kept])].sort((a, b) => a - b);
}

/** A choice of a select setting short enough to draw as one row of choices. */
const MAX_SEGMENTED_OPTIONS = 4;
/** The characters a row of choices may hold, all its labels together, to fit the drawer. */
const MAX_SEGMENTED_CHARACTERS = 45;

/**
 * A select setting's options as a row of choices, where they fit one row of the drawer: two to
 * four, short enough together. `undefined` for a longer list, which keeps its dropdown.
 */
export function segmentedOptionsOf(
  setting: AnyWidgetSetting
): SegmentedOption[] | undefined {
  if (setting.type !== "select") return undefined;
  const { options } = setting;
  if (options.length < 2 || options.length > MAX_SEGMENTED_OPTIONS) {
    return undefined;
  }
  const characters = options.reduce(
    (sum, option) => sum + option.label.length,
    0
  );
  if (characters > MAX_SEGMENTED_CHARACTERS) return undefined;
  return options.map(option => ({
    value: option.value,
    label: option.label,
  }));
}

/** One part of a setting's help: plain text, or an example in backticks, drawn as code. */
export interface DescriptionPart {
  text: string;
  code: boolean;
}

/**
 * A setting's help split into plain text and its examples, each written in backticks
 * (`` `**bold**` ``), which the drawer draws as code. A backtick left unclosed stays as text.
 */
export function descriptionParts(description: string): DescriptionPart[] {
  const parts: DescriptionPart[] = [];
  const pattern = /`([^`]+)`/g;
  let at = 0;
  for (const match of description.matchAll(pattern)) {
    const start = match.index;
    if (start > at) {
      parts.push({ text: description.slice(at, start), code: false });
    }
    parts.push({ text: match[1] ?? "", code: true });
    at = start + match[0].length;
  }
  if (at < description.length) {
    parts.push({ text: description.slice(at), code: false });
  }
  return parts;
}
