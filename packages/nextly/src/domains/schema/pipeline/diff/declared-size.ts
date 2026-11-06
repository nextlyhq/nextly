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

/**
 * Whether a column in place holds every value a column declared as `wanted`
 * can: the same type, NULL allowed wherever `wanted` allows it, and a size at
 * least as wide.
 *
 * The question asked before a column already there is taken as a field's,
 * where `typesDiffer` asks whether one has to be altered into the other: a
 * `varchar(300)` needs no alteration to hold what a `varchar(100)` holds,
 * though it is not that declaration. A length holds any shorter one; a
 * precision and scale hold another with no more digits on either side of the
 * point. As in `typesDiffer`, a size counts only when both sides state one,
 * and sizes that do not read as numbers hold only themselves. With `sizes`
 * false, as on SQLite, which enforces none, a size never decides.
 */
export function columnHolds(
  live: ColumnSpec,
  wanted: ColumnSpec,
  { sizes = true }: { sizes?: boolean } = {}
): boolean {
  if (wanted.nullable && !live.nullable) return false;
  const liveType = normalizeType(live.type);
  const wantedType = normalizeType(wanted.type);
  if (liveType !== wantedType) return textHolds(liveType, wantedType);
  if (!sizes) return true;

  // MySQL reports a DATETIME of no fractional seconds bare (`datetime`, never `datetime(0)`), so
  // there a missing size is a size of 0, not an unstated one.
  const have =
    declaredSize(live) ?? (liveType === "datetime" ? "0" : undefined);
  const need = declaredSize(wanted);
  if (have === undefined || need === undefined) return true;
  const [haveDigits, haveScale = 0] = have.split(",").map(Number);
  const [needDigits, needScale = 0] = need.split(",").map(Number);
  const numeric = [haveDigits, haveScale, needDigits, needScale].every(
    Number.isInteger
  );
  if (!numeric || have.includes(",") !== need.includes(",")) {
    return have === need;
  }
  return (
    haveScale >= needScale && haveDigits - haveScale >= needDigits - needScale
  );
}

/** MySQL's text types, narrowest first: they differ only in how much one value may hold. */
const TEXT_WIDTHS = ["tinytext", "text", "mediumtext", "longtext"];

/**
 * Whether a text type holds what another type does though the two are spelled
 * differently: a wider MySQL text type holds a narrower one's values, and
 * `longtext` holds JSON's, which is how MariaDB stores and reports a JSON
 * column. Refusing those would refuse a column of the very storage asked for.
 * A `text` column, or a wider one, holds any bounded string: PostgreSQL's
 * `text` has no limit, and MySQL's holds the 65,535 bytes no `varchar` can
 * exceed. MySQL's `tinytext`, of 255 bytes, does not.
 */
function textHolds(
  live: string | undefined,
  wanted: string | undefined
): boolean {
  const have = TEXT_WIDTHS.indexOf(live ?? "");
  if (have === -1) return false;
  if (wanted === "json") return live === "longtext";
  if (wanted === "varchar") return have >= TEXT_WIDTHS.indexOf("text");
  const need = TEXT_WIDTHS.indexOf(wanted ?? "");
  return need !== -1 && have >= need;
}
