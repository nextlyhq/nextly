/**
 * What changed in a document between two descriptions of the same parts, said to a person whose
 * publish was refused because something had: each part they chose that changed, by name, or that it
 * was something they had not chosen.
 *
 * Compared by the marks the server describes the parts with, which only say whether a part was
 * saved since: each language chosen, and the shared fields. What moves no mark (a live shared
 * field, a component, a language not chosen) is "something else".
 *
 * @module components/features/entries/publish-parts/described-changes
 */
import type {
  PartMarks,
  PublishPartsDirection,
} from "@admin/services/publishParts";

import type { LanguageLabel } from "../publishAllOutcomes";

/** The chosen parts whose marks differ, or are no longer described. */
function changedParts(
  before: PartMarks,
  now: PartMarks,
  labelOf: LanguageLabel
): string[] {
  return [
    ...Object.keys(before.languages)
      .filter(locale => now.languages[locale] !== before.languages[locale])
      .map(labelOf),
    ...(now.shared !== before.shared ? ["the shared fields"] : []),
  ];
}

/** Whether nothing the marks cover was saved between two descriptions of the same parts. */
export function sameMarks(before: PartMarks, now: PartMarks): boolean {
  return (
    before.shared === now.shared &&
    Object.keys({ ...before.languages, ...now.languages }).every(
      locale => before.languages[locale] === now.languages[locale]
    )
  );
}

/** "English", "English and the shared fields", "English, Spanish and the shared fields". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2
    ? last
    : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** What changed, as the subject of "changed since this was shown". */
function whatChanged(
  before: PartMarks,
  now: PartMarks,
  labelOf: LanguageLabel
): string {
  const parts = changedParts(before, now, labelOf);
  return parts.length > 0 ? listed(parts) : "something else in this document";
}

/** The sentence a refused move is told, from the description it was made of and the one now. */
export function changedSinceDescribed(args: {
  before: PartMarks;
  now: PartMarks;
  direction: PublishPartsDirection;
  labelOf: LanguageLabel;
}): string {
  const what = whatChanged(args.before, args.now, args.labelOf);
  const subject = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  return `${subject} changed since this was shown. Check what each part does now, then ${args.direction} again.`;
}
