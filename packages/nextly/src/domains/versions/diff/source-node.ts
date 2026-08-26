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
 * Each side is turned into TWO line arrays. Alignment and equality read the raw
 * lines; the reader is shown the masked ones. Deciding equality on the masked
 * form would report two different hashed passwords as one unchanged value,
 * which is the lossy projection reporting "same" for exactly what it dropped.
 *
 * @module domains/versions/diff/source-node
 */

import { NextlyError } from "../../../errors/nextly-error";
import { canonicalise } from "../../../shared/lib/canonical-json";

import { alignUnits, type UnitPair } from "./align-units";
import { maskSecret } from "./mask-secret";
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
 * One side of the comparison.
 *
 * Presence is stated by the caller rather than inferred from the value, because
 * what counts as ABSENT is not knowable here. A json field can hold the
 * primitive `null` as a real stored value — an author writing `null` means
 * something by it — while the same `null` is what a missing key normalises to.
 * Only the caller still holds the raw value that separates them, and inferring
 * it here instead produced a comparison that emitted a fabricated `null` line
 * against the whole of the other side.
 */
export type SourceSide = { present: false } | { present: true; value: unknown };

/** One side as lines: what equality reads, and what the reader is shown. */
interface SideLines {
  /** The value's own lines. Alignment and equality run over these. */
  compare: string[];
  /** The same lines with secrets masked. Only these are ever displayed. */
  display: string[];
}

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

/**
 * One side's two line arrays, or null when nothing about its content can be
 * claimed.
 *
 * The arrays are required to run in step, and the check is not ceremonial: the
 * displayed line for an aligned pair is looked up by the raw line's index, so
 * arrays of different lengths would show the reader a line from somewhere else
 * in the document. Masking replaces a whole string with a shorter one and
 * cannot change how many lines a value prints as, so this rejects a case that
 * should not arise rather than repairing one that does.
 */
function sideLines(side: SourceSide, isJson: boolean): SideLines | null {
  if (!side.present) return { compare: [], display: [] };
  const compare = toLines(side.value, isJson);
  // Raw lines FIRST, and the refusal before masking. `maskSecret` walks a value
  // the same way `JSON.stringify` does, so it does not terminate on a cyclic
  // one — and it is called outside the serialiser's own try/catch. Reaching it
  // only after the value has been shown to print is what keeps that unreachable.
  if (compare === null) return null;
  const display = toLines(maskSecret(side.value), isJson);
  if (display === null || display.length !== compare.length) return null;
  return { compare, display };
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

/** The displayed line at an index the alignment produced. */
function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index];
  if (line === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "source-node-index-out-of-range", index },
    });
  }
  return line;
}

/**
 * Turn one aligned pair into a line of the comparison.
 *
 * The pair's own strings are the RAW ones it was aligned by, so they are never
 * read here: every segment is built from the masked lines at the pair's
 * indices. A pair whose raw lines differ while their masked forms do not — two
 * hashed passwords — therefore renders as a changed line showing the mask,
 * which says that something moved without printing it.
 */
function toLine(
  pair: UnitPair,
  before: SideLines,
  after: SideLines
): SourceLineDiff {
  if (pair.status === "added") {
    return {
      status: "added",
      toLine: pair.toIndex,
      segments: diffText("", lineAt(after.display, pair.toIndex)),
    };
  }
  if (pair.status === "removed") {
    return {
      status: "removed",
      fromLine: pair.fromIndex,
      segments: diffText(lineAt(before.display, pair.fromIndex), ""),
    };
  }
  if (pair.status === "unchanged") {
    return {
      status: "unchanged",
      fromLine: pair.fromIndex,
      toLine: pair.toIndex,
      segments: [{ op: 0, text: lineAt(after.display, pair.toIndex) }],
    };
  }
  return {
    status: "changed",
    fromLine: pair.fromIndex,
    toLine: pair.toIndex,
    segments: diffText(
      lineAt(before.display, pair.fromIndex),
      lineAt(after.display, pair.toIndex)
    ),
  };
}

export function sourceNode(
  meta: NodeMeta,
  before: SourceSide,
  after: SourceSide,
  language: string
): SourceFieldDiff {
  const isJson = language === "json";
  const beforeLines = sideLines(before, isJson);
  const afterLines = sideLines(after, isJson);

  // Content is unreadable on at least one side. Presence survives that, so it
  // still decides the status.
  if (beforeLines === null || afterLines === null) {
    return refuse(
      meta,
      language,
      presenceStatus(!before.present, !after.present, "changed")
    );
  }

  const alignment = alignUnits(beforeLines.compare, afterLines.compare);
  if (!alignment.aligned) return refuse(meta, language, "changed");

  const lines = alignment.pairs.map(pair =>
    toLine(pair, beforeLines, afterLines)
  );
  const fromContent: DiffStatus = lines.some(l => l.status !== "unchanged")
    ? "changed"
    : "unchanged";
  // A side that was absent entirely reads as an addition or a removal of the
  // whole value, which is truer than "every line changed".
  const status =
    lines.length > 0
      ? presenceStatus(!before.present, !after.present, fromContent)
      : fromContent;

  return { ...meta, kind: "source", language, status, lines };
}
