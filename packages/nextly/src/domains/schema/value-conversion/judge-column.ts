// Whether a column can convert, judged from the rows it holds.
//
// One rule for every path that changes a saved column, so a repair, the development push and a
// Schema Builder type change judge the same column the same way. A difference whose type and
// nullability both change, or whose rows hold values of more than one kind, takes the worst class
// that holds (blocked over lossy over safe), and every reason is named with its rows, so the owner
// can deal with all of them before the next run. Rows are named by their key, never by their value.
//
// @module domains/schema/value-conversion/judge-column

import { keeps, lateWriteCanChange, valueJudgeFor } from "./judge-value";
import type {
  AffectedRows,
  ColumnConversion,
  ConversionClass,
  ConversionJudgement,
  ConversionReason,
  ConversionReasonKind,
  StoredValue,
} from "./types";

/** How many keys a reason names before it gives only the count. */
export const AFFECTED_ROWS_BOUND = 20;

/** The class each reason gives. A value is cleared with consent, never cut, changed or invented. */
const CLASS_OF: Record<ConversionReasonKind, ConversionClass> = {
  "not-json": "lossy",
  "kept-unreadable": "lossy",
  "too-long": "blocked",
  "stored-differently": "blocked",
  "null-under-not-null": "blocked",
  "unreadable-reference-list": "blocked",
  "no-conversion": "blocked",
  "late-write": "blocked",
};

const RANK: Record<ConversionClass, number> = { safe: 0, lossy: 1, blocked: 2 };

/**
 * The class of `conversion` over `values`, with every reason and the rows that give it.
 *
 * Reasons the pair of types gives come first, then each reason a row gives, in the order its first
 * row was read. `values` may be a list or pages read one after another; each value is judged once
 * and only its key is kept.
 */
export async function judgeColumn(
  conversion: ColumnConversion,
  values: Iterable<StoredValue> | AsyncIterable<StoredValue>
): Promise<ConversionJudgement> {
  const judge = valueJudgeFor(conversion);
  if (judge === null) return withClass([reason("no-conversion")]);

  const typeReasons = lateWriteCanChange(conversion)
    ? [reason("late-write")]
    : [];
  // Every value keeps its reading and a null is allowed, so no row can give a reason: the rows are
  // not read at all.
  if (judge === keeps && conversion.to.nullable) return withClass(typeReasons);
  const rowReasons = new Map<ConversionReasonKind, AffectedRows>();
  const note = (kind: ConversionReasonKind, value: StoredValue) => {
    const rows = rowReasons.get(kind) ?? { first: [], count: 0 };
    if (rows.first.length < AFFECTED_ROWS_BOUND) rows.first.push(value.key);
    rows.count += 1;
    rowReasons.set(kind, rows);
  };

  for await (const value of values) {
    const { text } = value;
    if (text === null) {
      if (!conversion.to.nullable) note("null-under-not-null", value);
      continue;
    }
    const kind = judge({ ...value, text });
    if (kind !== null) note(kind, value);
  }

  return withClass([
    ...typeReasons,
    ...[...rowReasons].map(([kind, rows]) => ({ ...reason(kind), rows })),
  ]);
}

function reason(kind: ConversionReasonKind): ConversionReason {
  return { kind, class: CLASS_OF[kind] };
}

/** `reasons` under the worst class any of them gives, or safe when there are none. */
function withClass(reasons: ConversionReason[]): ConversionJudgement {
  const worst = reasons.reduce<ConversionClass>(
    (current, next) =>
      RANK[next.class] > RANK[current] ? next.class : current,
    "safe"
  );
  return { class: worst, reasons };
}
