// Normalises database column-type strings to a canonical token so the diff
// can compare the live side (introspected) and the desired side
// (descriptor-authored) without emitting spurious change_column_type ops on
// every apply.
//
// Why this exists: the live-side introspector reads PostgreSQL's `udt_name`
// (see ./introspect-live.ts), which returns internal tokens WITHOUT length —
// `int4`, `bool`, `_text`, `timestamptz`, `varchar`, `bpchar`. The desired
// side authors SQL-standard names WITH length — `integer`, `boolean`,
// `text[]`, `timestamp with time zone`, `varchar(255)`. A raw string compare
// (`prevC.type !== curC.type`) then flags every core column as a "type change"
// → `nextly migrate` Phase 1 refuses the whole apply as destructive on any
// existing Postgres database (the upgrade case). See the sibling
// ./normalize-default.ts which solves the identical problem for defaults.
//
// Design principle — bounded, semantics-preserving collapses only:
//   - Strip length/precision modifiers (`varchar(255)` → `varchar`). The live
//     side reads udt_name which NEVER carries a length, so comparing length is
//     impossible — there is no information to lose here.
//   - Map known PG type aliases (internal ↔ SQL-standard) to one token.
//     `serial`/`bigserial`/`smallserial` collapse to their integer storage
//     type (the sequence default is a separate, already-handled concern).
//   - Normalise array notation: PG's `_text` and SQL `text[]` → `<base>[]`.
//   - Anything unrecognised passes through (lowercased, length-stripped). A
//     real type change (e.g. `varchar` → `text`) is therefore still caught.

// Internal/SQL-standard alias → canonical token. Keys are lowercased and
// length-stripped before lookup. Two-word SQL names are matched verbatim.
const TYPE_ALIASES: Record<string, string> = {
  // Integer family. `serial*` are int storage + a sequence default; for TYPE
  // comparison they are identical to their plain integer counterpart.
  integer: "int4",
  int: "int4",
  int4: "int4",
  serial: "int4",
  serial4: "int4",
  bigint: "int8",
  int8: "int8",
  bigserial: "int8",
  serial8: "int8",
  smallint: "int2",
  int2: "int2",
  smallserial: "int2",
  serial2: "int2",
  // Boolean.
  boolean: "bool",
  bool: "bool",
  // Timestamps / times.
  "timestamp with time zone": "timestamptz",
  timestamptz: "timestamptz",
  "timestamp without time zone": "timestamp",
  timestamp: "timestamp",
  "time with time zone": "timetz",
  timetz: "timetz",
  "time without time zone": "time",
  time: "time",
  // Character types.
  "character varying": "varchar",
  varchar: "varchar",
  character: "bpchar",
  char: "bpchar",
  bpchar: "bpchar",
  // Floating point.
  "double precision": "float8",
  float8: "float8",
  real: "float4",
  float4: "float4",
  // Arbitrary precision.
  numeric: "numeric",
  decimal: "numeric",
};

/**
 * Return the canonical form of a column-type string for diff comparison.
 * `undefined` is passed through unchanged. The diff still emits the original,
 * un-normalised type names in the op so downstream tooling sees what's stored.
 */
export function normalizeType(type: string | undefined): string | undefined {
  if (type === undefined) return undefined;

  // Lowercase + strip every `(...)` length/precision modifier (and any
  // whitespace that preceded it), e.g. `varchar(255)` → `varchar`,
  // `numeric(10,2)` → `numeric`, `timestamp(3) with time zone` →
  // `timestamp with time zone`.
  let t = type
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .trim();

  // Normalise array notation to `<base>[]`. PG's udt_name uses a leading
  // underscore (`_text`); the desired side uses SQL `text[]`.
  let isArray = false;
  if (t.startsWith("_")) {
    isArray = true;
    t = t.slice(1);
  }
  if (t.endsWith("[]")) {
    isArray = true;
    t = t.slice(0, -2).trim();
  }

  const canonical = TYPE_ALIASES[t] ?? t;
  return isArray ? `${canonical}[]` : canonical;
}
