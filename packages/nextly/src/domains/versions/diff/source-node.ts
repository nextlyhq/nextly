/**
 * Build a diff node for a json or code field, as aligned lines.
 *
 * JSON is canonicalised — object keys sorted at every depth — before it is
 * compared, so a reordered key is not reported as a content change. That is a
 * decision about what COUNTS as a change, which is why it lives here where it
 * can be tested rather than in the renderer. Arrays are deliberately NOT
 * sorted: their order is content, and an author who reorders a list changed
 * something.
 *
 * Key order is the only thing this projection drops. A value that cannot be
 * represented at all is reported as not comparable rather than as unchanged,
 * because a refusal and an equality lead a reader deciding whether to restore
 * in opposite directions.
 *
 * Code is compared as lines rather than word-diffed as one string: the previous
 * behaviour rendered a code field as a proportional, word-wrapped paragraph,
 * which made the comparison LESS readable than simply viewing the version.
 *
 * @module domains/versions/diff/source-node
 */

import { alignUnits, type UnitPair } from "./align-units";
import { canonicalise } from "./canonical-json";
import { presenceStatus } from "./presence-status";
import { diffText } from "./text-diff";
import type {
  DiffStatus,
  NodeMeta,
  SourceFieldDiff,
  SourceLineDiff,
} from "./types";

/**
 * What a code field with no configured language is highlighted as. Matches the
 * field type's own documented default; `"code"` is not a language any
 * highlighter knows, so emitting it would leave a renderer unable to choose a
 * grammar for exactly the fields that did not ask for one.
 */
export const PLAINTEXT = "plaintext";

/**
 * The value as printable lines, or null when it cannot be represented in this
 * language at all.
 */
function toLines(value: unknown, isJson: boolean): string[] | null {
  if (!isJson) {
    if (typeof value === "string") return value.split("\n");
    // A code field holding a non-string is not something this can render, and
    // guessing at it would report a comparison that never happened.
    return null;
  }
  try {
    const printed = JSON.stringify(canonicalise(value), null, 2);
    // `JSON.stringify` answers undefined for a value with no representation
    // (a function, a bare undefined), which is a refusal rather than an empty
    // document.
    return printed === undefined ? null : printed.split("\n");
  } catch {
    // A cyclic value. Nothing about it can be claimed.
    return null;
  }
}

/** A whole-field refusal, keeping whatever presence answer is still knowable. */
function refuse(
  meta: NodeMeta,
  language: string,
  status: DiffStatus
): SourceFieldDiff {
  return {
    ...meta,
    kind: "source",
    language,
    status,
    lines: [{ status: "unsupported" }],
  };
}

/** Turn one aligned pair into a line of the comparison. */
function toLine(pair: UnitPair): SourceLineDiff {
  if (pair.status === "added") {
    return {
      status: "added",
      toLine: pair.toIndex,
      segments: diffText("", pair.after),
    };
  }
  if (pair.status === "removed") {
    return {
      status: "removed",
      fromLine: pair.fromIndex,
      segments: diffText(pair.before, ""),
    };
  }
  if (pair.status === "unchanged") {
    return {
      status: "unchanged",
      fromLine: pair.fromIndex,
      toLine: pair.toIndex,
      segments: [{ op: 0, text: pair.after }],
    };
  }
  return {
    status: "changed",
    fromLine: pair.fromIndex,
    toLine: pair.toIndex,
    segments: diffText(pair.before, pair.after),
  };
}

export function sourceNode(
  meta: NodeMeta,
  before: unknown,
  after: unknown,
  language: string
): SourceFieldDiff {
  const isJson = language === "json";

  // What counts as ABSENT differs by language, and getting it wrong loses
  // content rather than merely mislabelling it.
  //
  // A json field can hold the primitive `null` as a real stored value — an
  // author writing `null` means something by it — so only a missing key is an
  // absence there, and `null` prints as the single line `null` like any other
  // value. Treating it as absent emits an object-to-null edit as removed lines
  // with nothing on the other side, never showing the value that is now there.
  // A code field holds a string, so `null` there IS an empty field.
  const beforeAbsent = isJson ? before === undefined : before == null;
  const afterAbsent = isJson ? after === undefined : after == null;

  const beforeLines = beforeAbsent ? [] : toLines(before, isJson);
  const afterLines = afterAbsent ? [] : toLines(after, isJson);

  // Content is unreadable on at least one side. Presence survives that, so it
  // still decides the status.
  if (beforeLines === null || afterLines === null) {
    return refuse(
      meta,
      language,
      presenceStatus(beforeAbsent, afterAbsent, "changed")
    );
  }

  const alignment = alignUnits(beforeLines, afterLines);
  if (!alignment.aligned) return refuse(meta, language, "changed");

  const lines = alignment.pairs.map(toLine);
  const fromContent: DiffStatus = lines.some(l => l.status !== "unchanged")
    ? "changed"
    : "unchanged";
  // A side that was absent entirely reads as an addition or a removal of the
  // whole value, which is truer than "every line changed".
  const status =
    lines.length > 0
      ? presenceStatus(beforeAbsent, afterAbsent, fromContent)
      : fromContent;

  return { ...meta, kind: "source", language, status, lines };
}
