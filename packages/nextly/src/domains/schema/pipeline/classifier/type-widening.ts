// Per-dialect type-widening allow-list.
//
// Why this exists: changing a column type is usually destructive (PG fails
// on incompatible cast; MySQL/SQLite silently coerce), but a few well-defined
// changes are PROVABLY safe — varchar(50) -> varchar(255), smallint -> bigint,
// etc. The Classifier consults this allow-list to skip the destructive
// warning prompt for those cases. Anything not on the list falls through to
// the per-dialect warning UX (PR 3 type-warnings.ts).
//
// Why per-dialect: the type tokens themselves differ. PG udt_name returns
// "int2"/"int4"/"int8"; PG SQL aliases are "smallint"/"int"/"bigint";
// MySQL has its own integer hierarchy; SQLite is storage-class only.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

const VARCHAR_RE = /^varchar\((\d+)\)$/i;
const CHAR_RE = /^char\((\d+)\)$/i;

// Postgres integer family. Lower rank widens to higher rank.
// Maps both the SQL aliases (smallint/int/bigint) and the udt_name tokens
// (int2/int4/int8) so we work whether the type came from drizzle's SQL gen
// or from information_schema.columns.udt_name introspection.
const PG_INT_RANK: Record<string, number> = {
  smallint: 1,
  int2: 1,
  int: 2,
  integer: 2,
  int4: 2,
  bigint: 3,
  int8: 3,
};

// MySQL integer family. tinyint < smallint < mediumint < int < bigint.
const MYSQL_INT_RANK: Record<string, number> = {
  tinyint: 1,
  smallint: 2,
  mediumint: 3,
  int: 4,
  integer: 4,
  bigint: 5,
};

// MySQL text family — storage capacity grows tinytext < text < mediumtext < longtext.
const MYSQL_TEXT_RANK: Record<string, number> = {
  tinytext: 1,
  text: 2,
  mediumtext: 3,
  longtext: 4,
};

function widensVarchar(from: string, to: string): boolean | null {
  const fm = VARCHAR_RE.exec(from);
  const tm = VARCHAR_RE.exec(to);
  if (fm && tm) return parseInt(tm[1], 10) >= parseInt(fm[1], 10);
  return null;
}

export function isWideningChange(
  fromType: string,
  toType: string,
  dialect: SupportedDialect
): boolean {
  const from = fromType.toLowerCase().trim();
  const to = toType.toLowerCase().trim();
  if (from === to) return true;

  // SQLite is storage-class only. Same storage class is widening (handled
  // above by from===to); cross-class is destructive.
  if (dialect === "sqlite") return false;

  // varchar(N) -> varchar(M) widens when M >= N
  const vw = widensVarchar(from, to);
  if (vw !== null) return vw;

  // char(N) -> varchar(M) or varchar widens (escapes fixed-width padding)
  if (CHAR_RE.test(from) && (to === "varchar" || VARCHAR_RE.test(to))) {
    return true;
  }

  // PG: any varchar -> text widens (unbounded text accepts anything varchar held)
  if (
    dialect === "postgresql" &&
    (from === "varchar" || VARCHAR_RE.test(from)) &&
    to === "text"
  ) {
    return true;
  }

  // MySQL: varchar(N) -> any text-family type widens
  if (
    dialect === "mysql" &&
    VARCHAR_RE.test(from) &&
    MYSQL_TEXT_RANK[to] !== undefined
  ) {
    return true;
  }

  // Integer family widening
  const intRank = dialect === "postgresql" ? PG_INT_RANK : MYSQL_INT_RANK;
  if (intRank[from] !== undefined && intRank[to] !== undefined) {
    return intRank[to] >= intRank[from];
  }

  // MySQL text family widening
  if (
    dialect === "mysql" &&
    MYSQL_TEXT_RANK[from] !== undefined &&
    MYSQL_TEXT_RANK[to] !== undefined
  ) {
    return MYSQL_TEXT_RANK[to] >= MYSQL_TEXT_RANK[from];
  }

  return false;
}
