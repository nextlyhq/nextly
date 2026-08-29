/**
 * The names of the columns a companion `_locales` table has by virtue of BEING a companion,
 * rather than because a field is localized.
 *
 * A leaf module on purpose. These names are needed by the runtime WRITE path
 * (`upsertCompanionRow`) and by the DDL generator that creates the columns, and the generator
 * pulls the whole migration/diff graph behind it — `generate-up` is deliberately reached by
 * dynamic `import()` from the runtime for that reason. Naming a column is not a reason to load a
 * DDL pipeline, so the names live here, where both sides can import them statically and neither
 * side can spell one differently from the other.
 *
 * @module domains/i18n/companion-columns
 */

/**
 * The status a companion row takes when one is created without an explicit `_status` — the DDL
 * default. Read from here by write paths that need to know what a freshly-upserted locale row
 * holds, rather than repeating the literal.
 */
export const COMPANION_DEFAULT_STATUS = "draft";

/** Per-locale draft/publish state; present only when the entity has one. */
export const COMPANION_STATUS_COLUMN = "_status";

/**
 * What a companion table's name adds to its entity's table name.
 *
 * The rule is one string in three places already — the reconcile builds `<table>_locales`, the
 * readiness resolver strips it back off, and the runtime registration repeats it. Named here so a
 * caller deriving one name from the other is reading the rule rather than retyping it.
 */
export const COMPANION_TABLE_SUFFIX = "_locales";

/**
 * When THIS locale was last written (i18n B2 — "changed since translated").
 *
 * Nullable with NO default, and both halves are load-bearing. A translation that has gone stale
 * looks exactly like a finished one, so the feature is a comparison between this column on the
 * target locale's row and on the source locale's — and `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP`
 * would give every existing row the SAME value, making source and target compare equal
 * everywhere. Every stale translation on the site would read as fresh on the first run after the
 * migration, on exactly the sites that most need the signal, and nothing would look wrong.
 *
 * So NULL is seeded, and NULL means UNKNOWN — never "up to date". See
 * {@link COMPANION_OPTIONAL_STRUCTURAL_COLUMNS} for why a companion is allowed to stand there
 * without it.
 */
export const COMPANION_UPDATED_AT_COLUMN = "_updated_at";

/**
 * The columns of a companion's composite PRIMARY KEY, in key order.
 *
 * Stated once because this pair is load-bearing at RUNTIME rather than merely structural:
 * `upsertCompanionRow` names it as its conflict target, so a companion that lost the key fails
 * every localized write on PostgreSQL and SQLite and silently accepts duplicate locale rows on
 * MySQL. Anything checking that a live companion still has its key reads this rather than
 * restating the pair.
 */
/** The companion row's link back to the document it translates. */
export const COMPANION_PARENT_COLUMN = "_parent";

/** Which language a companion row holds. */
export const COMPANION_LOCALE_COLUMN = "_locale";

/**
 * Derived from the two constants above rather than restated, so a caller that
 * builds a WHERE clause out of them cannot drift from the set that decides
 * whether a column counts as translated content.
 */
export const COMPANION_KEY_COLUMNS: readonly string[] = [
  COMPANION_PARENT_COLUMN,
  COMPANION_LOCALE_COLUMN,
];

/**
 * Every column a companion has structurally, so a reader looking at an existing companion can
 * subtract them and be left with exactly the translated columns.
 */
export const COMPANION_STRUCTURAL_COLUMNS: ReadonlySet<string> = new Set([
  ...COMPANION_KEY_COLUMNS,
  COMPANION_STATUS_COLUMN,
  COMPANION_UPDATED_AT_COLUMN,
]);

/**
 * The structural columns a live companion may legitimately be standing there WITHOUT — and the
 * reason each one may be absent.
 *
 * Membership of {@link COMPANION_STRUCTURAL_COLUMNS} answers "is this a translated column?", and
 * the answer is no for every entry in it. That is a DIFFERENT question from "must a healthy
 * companion physically have it?", and the two sets coincided only for as long as every structural
 * column beyond `_status` was created on day one.
 *
 * Naming the exemptions separately keeps the safe default that `reconcile-field-group-plan`
 * deliberately chose — a structural column added later IS required unless someone states why it
 * need not be — while making that statement a decision on the record rather than an accident of
 * which set a name was added to.
 *
 * - `_status` — a field group is never Draft/Published, so its companion is built with
 *   `status: false` and categorically never has the column.
 * - `_updated_at` — added to EXISTING companions by migration, so a companion predating it is
 *   healthy-but-unstamped. Its absence already has a defined meaning to the only thing that reads
 *   it (UNKNOWN, never "up to date"), so refusing the table would be strictly worse than the
 *   answer the staleness comparison already gives for a NULL.
 */
export const COMPANION_OPTIONAL_STRUCTURAL_COLUMNS: ReadonlySet<string> =
  new Set([COMPANION_STATUS_COLUMN, COMPANION_UPDATED_AT_COLUMN]);
