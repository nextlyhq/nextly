// Whether two column declarations describe the same type AT THE SAME SIZE.
//
// Split from `normalizeType`, which answers only the first half. That was the
// whole answer while it was written: the live side read PostgreSQL's
// `udt_name`, which reports a bare `varchar` however the column was declared,
// so there was no size on the live side to compare against and stripping one
// from the desired side lost nothing.
//
// It stopped being the whole answer when introspection began recording
// `character_maximum_length`, `numeric_precision` and `numeric_scale` into
// `ColumnSpec.typeModifier`. The desired-side builder anticipated exactly this
// — its comment says resizing a decimal "needs a manual migration until the
// introspector captures numeric_precision/numeric_scale on the live side" —
// but nothing came back to lift the trade-off once it did, so narrowing a
// column's precision or length went on producing no operation at all.
//
// @module domains/schema/pipeline/diff/declared-size

import { normalizeType } from "./normalize-type";
import type { ColumnSpec } from "./types";

/**
 * The size a declaration states, or undefined when it states none.
 *
 * Read from either place a size can live, because the two sides of the diff
 * keep it differently: PostgreSQL introspection puts it in `typeModifier`
 * beside a bare `numeric`, while MySQL, SQLite and every desired-side
 * declaration spell it inside the type.
 *
 * Whitespace is removed rather than trusted. The desired side writes
 * `numeric(10, 2)` with a space and the live side yields `10,2` without one;
 * comparing those literally reports a change on every decimal column in every
 * PostgreSQL database — the phantom-diff failure this module's sibling exists
 * to prevent, reintroduced by the fix for its opposite.
 */
export function declaredSize(spec: ColumnSpec): string | undefined {
  return spec.typeModifier === undefined
    ? sizeFromDeclaration(spec.type)
    : withoutSpaces(spec.typeModifier);
}

/**
 * The same answer for a declaration that arrives as a bare string.
 *
 * Separate entry point rather than a second implementation: the field-group
 * reconciler reached this rule independently — down to the whitespace strip and
 * the both-sides-must-declare gate — and two functions deciding what size a
 * declaration states are two functions that can drift.
 */
export function sizeFromDeclaration(
  type: string | undefined
): string | undefined {
  const inner = /\(([^)]*)\)/.exec(type ?? "")?.[1];
  return inner === undefined ? undefined : withoutSpaces(inner);
}

function withoutSpaces(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * Whether a column has to be altered to get from the first declaration to the
 * second.
 *
 * A size difference counts only when BOTH sides state one. A live
 * `varchar(255)` against a config that asks for plain text is not a resize —
 * it is two descriptions at different levels of detail, and treating it as a
 * change would emit an operation on every apply against an existing database
 * and never converge.
 */
export function typesDiffer(prev: ColumnSpec, cur: ColumnSpec): boolean {
  if (normalizeType(prev.type) !== normalizeType(cur.type)) return true;

  const from = declaredSize(prev);
  const to = declaredSize(cur);
  if (from === undefined || to === undefined) return false;
  return from !== to;
}
