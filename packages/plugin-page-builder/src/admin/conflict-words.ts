/**
 * What the editor tells an author about a Design save that met someone
 * else's: the one place these words are written, so every surface (the
 * Variables line, the toasts, the history's undo and redo) and every test
 * reads the same sentences.
 *
 * A save merged cleanly says nothing. A true conflict (both changed one
 * entry differently, or one removed what the other changed) is always said:
 * for a forward save, mine was kept and Undo puts theirs back; for an undo or
 * redo, theirs was kept and the change could not be taken back or put
 * forward there.
 *
 * Who made the other change is named only when exactly one save came
 * between the version the save was first sent with and the one it merged
 * onto: otherwise the person the last refusal names may not be the one who
 * changed these entries, so it is "Someone".
 *
 * @module admin/conflict-words
 */
import { isPlainRecord, tokenDisplayLabel } from "@nextlyhq/blocks-engine";

import type {
  ConflictKind,
  EntryConflict,
  MergeableSection,
} from "../site-style-merge";
import type { SaveConflicts } from "../site-style-versioned-save";

/** A save refused after every try, because the site's design kept changing. */
export const KEPT_CHANGING_WORDS =
  "The site's design kept changing while this was saved, so it was not saved. Try again.";

/** What the conflicts came from: a forward save, or an undo or a redo. */
export type ConflictWording = "save" | "undone" | "redone";

/** How many entries are named before the rest are counted. */
const NAMED_AT_MOST = 2;

/** The plain words for a section-wide token setting, by its stored key. */
const SETTING_LABELS: Readonly<Record<string, string>> = {
  prefix: "the variable prefix",
  darkMode: "the dark mode setting",
};

/**
 * The words for the true conflicts one save settled, or `undefined` when it
 * settled none (a clean merge, which is silent).
 */
export function conflictWords(
  section: MergeableSection,
  conflicts: SaveConflicts | undefined,
  wording: ConflictWording = "save"
): string | undefined {
  if (conflicts === undefined || conflicts.entries.length === 0) {
    return undefined;
  }
  const who = changerOf(conflicts);
  const sentences: string[] = [];
  for (const [kind, labels] of labelsByKind(
    section,
    conflicts.entries,
    wording
  )) {
    sentences.push(
      wording === "save"
        ? savedSentence(who, kind, labels)
        : replaySentence(who, kind, labels, wording)
    );
  }
  return sentences.join(" ");
}

/** Who to name: the person, only when exactly one save came between. */
function changerOf(conflicts: SaveConflicts): string {
  const refusal = conflicts.refusal;
  const name = refusal?.changedBy?.name?.trim();
  return refusal?.oneSaveBetween === true && name !== undefined && name !== ""
    ? name
    : "Someone";
}

/**
 * Each kind of conflict with the entries it names, deduplicated (a family's
 * faces name the family once) and in the order the merge met them. An undo
 * or redo says "changed" for both kinds where theirs changed the entry, so
 * those two are one group there.
 */
function labelsByKind(
  section: MergeableSection,
  entries: readonly EntryConflict[],
  wording: ConflictWording
): Map<ConflictKind, string[]> {
  const out = new Map<ConflictKind, string[]>();
  for (const entry of entries) {
    const kind: ConflictKind =
      wording !== "save" && entry.kind === "removed-by-me"
        ? "changed"
        : entry.kind;
    const labels = out.get(kind) ?? [];
    const label = entryLabel(section, entry);
    if (!labels.includes(label)) labels.push(label);
    out.set(kind, labels);
  }
  return out;
}

/**
 * An entry by the name the author sees it under: a variable's display
 * label, a shared style's label or class name, a font's family, a token
 * setting in words. Read from mine first, as the author last saw it, then
 * theirs, then the base; the stored key when none of them names it.
 */
export function entryLabel(
  section: MergeableSection,
  entry: EntryConflict
): string {
  if (entry.setting) return SETTING_LABELS[entry.key] ?? entry.key;
  for (const side of [entry.mine, entry.theirs, entry.base]) {
    const label = sideLabel(section, side);
    if (label !== undefined) return label;
  }
  return entry.key;
}

/** One side's name for an entry, or `undefined` when it states none. */
function sideLabel(
  section: MergeableSection,
  side: unknown
): string | undefined {
  if (!isPlainRecord(side)) return undefined;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  if (section === "tokens") {
    const name = text(side.name);
    if (name === undefined) return undefined;
    const label = text(side.label);
    return tokenDisplayLabel(label === undefined ? { name } : { name, label });
  }
  if (section === "classes") return text(side.label) ?? text(side.slug);
  return text(side.family);
}

/**
 * Names joined as a sentence lists them: "Primary", "Primary and Accent",
 * and from three on, "Primary, Accent and 2 more".
 */
export function namedList(labels: readonly string[]): string {
  if (labels.length <= NAMED_AT_MOST) return labels.join(" and ");
  const named = labels.slice(0, NAMED_AT_MOST).join(", ");
  return `${named} and ${String(labels.length - NAMED_AT_MOST)} more`;
}

/** A forward save's sentence for one kind of conflict: mine was kept. */
function savedSentence(
  who: string,
  kind: ConflictKind,
  labels: readonly string[]
): string {
  const one = labels.length === 1;
  const list = namedList(labels);
  if (kind === "removed-by-them") {
    return one
      ? `${who} removed ${list} while you were editing it. It was kept, with your value. Undo removes it again.`
      : `${who} removed ${list} while you were editing them. They were kept, with your values. Undo removes them again.`;
  }
  if (kind === "removed-by-me") {
    return one
      ? `${who} changed ${list} while you were removing it. It was removed. Undo brings it back with their value.`
      : `${who} changed ${list} while you were removing them. They were removed. Undo brings them back with their values.`;
  }
  return one
    ? `${who} changed ${list} while you were editing. Your value was kept. Undo puts theirs back.`
    : `${who} changed ${list} while you were editing. Your values were kept. Undo puts theirs back.`;
}

/**
 * An undo or redo's sentence for one kind of conflict: theirs was kept, so
 * the change could not be taken back (or put forward) there.
 */
function replaySentence(
  who: string,
  kind: ConflictKind,
  labels: readonly string[],
  verb: "undone" | "redone"
): string {
  const did = kind === "removed-by-them" ? "removed" : "changed";
  const change =
    labels.length === 1 ? "your change to it" : "your changes to them";
  return `${who} ${did} ${namedList(labels)} since, so ${change} could not be ${verb}.`;
}
