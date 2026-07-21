// Shared drop-guard for drizzle-kit pushSchema output.
//
// drizzle-kit's pushSchema can emit DROP TABLE / DROP SEQUENCE / DROP INDEX
// for any object that exists in the live DB but is absent from the desired
// schema it was handed. Both PushSchemaPipeline (dev server / HMR) and
// freshPushSchema (`nextly migrate` Phase 1, ensureCoreTables) run pushSchema
// against a desired schema that is narrower than the live DB, so both MUST
// strip drops of objects the caller never asked about — otherwise user
// content tables (dc_/single_/comp_) get destroyed as collateral.
//
// The desired set is compared by SQL table name. Callers that hold a Drizzle
// schema bundle MUST derive names via `drizzleTableNames` (Symbol-based),
// NOT Object.keys() — bundle keys are JS export names (e.g. dynamicCollections),
// not SQL names (dynamic_collections), and include non-table exports.

import { isCompanionTable, isManagedTable } from "./managed-tables";

const ORPHAN_DROP_PATTERNS: ReadonlyArray<{
  kind: "SEQUENCE" | "INDEX";
  re: RegExp;
}> = [
  {
    kind: "SEQUENCE",
    re: /^DROP\s+SEQUENCE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
  {
    kind: "INDEX",
    re: /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
];

/** Cheap structural check for Drizzle tables (carry Symbol.for("drizzle:Name")). */
export function isDrizzleTable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  // Drizzle tables carry Symbol.for("drizzle:Name") — the simplest
  // stable cross-dialect check.
  return Symbol.for("drizzle:Name") in value;
}

/** Extract a Drizzle table's SQL name, falling back to the export key. */
export function getDrizzleTableName(value: unknown, fallback: string): string {
  const named = (value as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
  return typeof named === "string" ? named : fallback;
}

/**
 * SQL table names of every Drizzle table in a schema bundle. Skips non-table
 * exports (relations). This is the correct allow-list for
 * `filterUnsafeStatements` — NEVER use `Object.keys(schema)`, which yields JS
 * export keys (camelCase) rather than the SQL names the filter compares against.
 */
export function drizzleTableNames(schema: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const [exportKey, value] of Object.entries(schema)) {
    if (isDrizzleTable(value))
      names.push(getDrizzleTableName(value, exportKey));
  }
  return names;
}

/**
 * Infers the owner table of a sequence or index from its name using
 * Postgres's default naming conventions:
 *   - SERIAL / IDENTITY sequences: `<table>_<col>_seq`
 *   - Indexes:                      `<table>_<col(s)>_idx | _key | _pkey | _unique`
 *
 * Strategy: walk underscore-delimited prefixes from longest to shortest
 * and return the first candidate found in `desiredSet`. Longest-first
 * ensures multi-word table names like `email_templates` are preferred
 * over the shorter prefix `email`.
 *
 * Returns the matched table name (lowercased) or `null` if no prefix in
 * `desiredSet` was found. A `null` result means we can't identify the
 * owner, and the caller should treat the statement as unsafe.
 */
function inferOwnerTableFromObjectName(
  objectName: string,
  desiredSet: ReadonlySet<string>
): string | null {
  const lower = objectName.toLowerCase();
  const parts = lower.split("_");
  // Walk from the longest prefix down to a single part.
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join("_");
    if (desiredSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Strip data-losing drops drizzle-kit emits for objects outside the desired
 * schema.
 *
 * SQLite can't ALTER COLUMN type, so drizzle-kit emits a CREATE/COPY/DROP/RENAME
 * sequence for type changes (renames included):
 *   1. CREATE TABLE __new_dc_job (...)
 *   2. INSERT INTO __new_dc_job SELECT ... FROM dc_job
 *   3. DROP TABLE dc_job          ← intentional, NOT accidental
 *   4. ALTER TABLE __new_dc_job RENAME TO dc_job
 * A strict block-all-DROPs rule breaks step 3 → step 4 then fails with
 * "table dc_job already exists".
 *
 * Refined rule:
 *   - DROP TABLE for a table IN the desired schema → ALLOW (part of an
 *     intentional rebuild — the table is recreated by a subsequent
 *     CREATE/RENAME).
 *   - DROP TABLE for a table NOT in the desired schema → BLOCK (drizzle-kit
 *     thinks it's orphaned; this is the scenario where a narrow desired
 *     schema would otherwise destroy admin-UI / user content tables).
 *
 * The same policy extends to DROP SEQUENCE / DROP INDEX: `tablesFilter`
 * restricts which TABLES drizzle-kit inspects but does NOT suppress its
 * emission of DROP SEQUENCE / DROP INDEX for "orphan" objects whose owner
 * table isn't in the scoped schema (e.g. desired = {posts} but the live DB
 * has `accounts_id_seq` → drizzle-kit emits `DROP SEQUENCE accounts_id_seq`,
 * which fails with PG 2BP01 because `accounts.id` still depends on it). We
 * infer the owner table from the object name; custom-named objects that don't
 * share a prefix with any managed table are blocked + warned (fail-safe).
 */
export function filterUnsafeStatements(
  statements: string[],
  desiredTableNames: string[]
): string[] {
  const desiredSet = new Set(desiredTableNames.map(t => t.toLowerCase()));

  return statements.filter(stmt => {
    // ── DROP TABLE ──────────────────────────────────────────────────
    const dropMatch = stmt.match(
      /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i
    );
    if (dropMatch) {
      const tableName = dropMatch[1] ?? "<unknown>";
      const isInDesired = desiredSet.has(tableName.toLowerCase());

      if (isInDesired) {
        // Intentional drop — rebuild pattern, system-table refresh, etc.
        return true;
      }

      // Internal framework tables (nextly_ prefix: ledger, migrate lock, meta)
      // are bootstrapped out-of-band and never part of the desired schema. Block
      // their drop SILENTLY — they must never be dropped, and warning on every
      // reconcile is just noise. (User/collection slugs can't start with
      // `nextly_` — the slug validator reserves that prefix.)
      if (tableName.toLowerCase().startsWith("nextly_")) {
        return false;
      }

      // Localized companion tables are migration-owned (Option B) and never part
      // of the desired schema. Block their drop SILENTLY — the localization
      // migration layer owns their lifecycle; warning on every reconcile is noise.
      if (isCompanionTable(tableName)) {
        return false;
      }

      // Accidental drop — table not in desired schema. Block and log so
      // operators see the protection.
      console.warn(
        `[Nextly schema] Blocked DROP TABLE "${tableName}" emitted by ` +
          `drizzle-kit pushSchema (table not in current desired schema). ` +
          `If this drop was intentional, route it through the ` +
          `pre-resolution executor with explicit user confirmation. ` +
          `(managed=${isManagedTable(tableName)})`
      );
      return false;
    }

    // ── DROP SEQUENCE / DROP INDEX ───────────────────────────────────
    // Block when the inferred owner table is not in desiredSet
    // (longest-prefix match — see inferOwnerTableFromObjectName).
    for (const { kind, re } of ORPHAN_DROP_PATTERNS) {
      const m = stmt.match(re);
      if (!m) continue;
      const objectName = m[1] ?? "";
      if (inferOwnerTableFromObjectName(objectName, desiredSet) !== null) {
        return true;
      }
      console.warn(
        `[Nextly schema] Blocked DROP ${kind} "${objectName}" emitted by ` +
          `drizzle-kit pushSchema (owner table not in current desired ` +
          `schema or name is non-conventional). If this drop was ` +
          `intentional, route it through the pre-resolution executor ` +
          `with explicit user confirmation, or drop it manually before ` +
          `re-running if the ${kind.toLowerCase()} name is custom.`
      );
      return false;
    }

    // ── Everything else passes through ──────────────────────────────
    return true;
  });
}

/**
 * Statement patterns that name the table they act on directly. Used to decide
 * which table a statement belongs to when filtering by ownership.
 *
 * Identifiers are captured as `[\w-]+` rather than `\w+`: a collection may
 * declare a custom `dbName` containing hyphens, which the runtime and
 * `resolveCollectionTableName` both keep verbatim. Capturing only up to the
 * hyphen would yield a prefix that matches no locked table, so a statement
 * against `dc_my-table` would slip through the ownership filter entirely.
 */
const STATEMENT_TABLE_PATTERNS: ReadonlyArray<RegExp> = [
  /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i,
  /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i,
  /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i,
  /^INSERT\s+INTO\s+(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i,
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`]?[\w-]+["`]?\s+)?ON\s+(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i,
];

/**
 * Resolve the table a statement acts on, or `null` when it can't be determined.
 *
 * SQLite rebuilds a table by building a `__new_<table>` twin and renaming it
 * over the original, so a statement naming `__new_dc_posts` is really a
 * statement about `dc_posts`. Stripping the prefix keeps every step of a
 * rebuild block attributed to the same table — filtering only some of them
 * would leave a half-applied rebuild behind.
 */
function statementTargetTable(stmt: string): string | null {
  for (const re of STATEMENT_TABLE_PATTERNS) {
    const m = stmt.match(re);
    if (!m?.[1]) continue;
    return m[1].toLowerCase().replace(/^__new_/, "");
  }
  return null;
}

/**
 * Drop statements that would modify a table the caller does not own.
 *
 * A Schema Builder save must only ever touch the entity being edited. The
 * pipeline already filters its own operations by lock, but drizzle-kit is
 * handed the full desired schema and re-derives drift independently, so on
 * dialects where the kit path runs (SQLite and MySQL always; PostgreSQL when
 * the emitter can't fast-path) it can still emit DDL for a locked, code-first
 * or plugin-owned table. This is the backstop that makes the guarantee hold on
 * every dialect rather than only where scope reduction happens to apply.
 *
 * Statements whose table cannot be identified pass through: they are almost
 * always schema-wide (sequences, enums) and blocking an unrecognized statement
 * would break applies that are otherwise legitimate. The unsafe-statement
 * filter remains the guard against destructive emissions.
 */
export function excludeLockedTableStatements(
  statements: string[],
  lockedTableNames: ReadonlySet<string>
): { kept: string[]; skipped: string[] } {
  if (lockedTableNames.size === 0) {
    return { kept: statements, skipped: [] };
  }
  const locked = new Set([...lockedTableNames].map(t => t.toLowerCase()));

  const kept: string[] = [];
  const skipped: string[] = [];
  for (const stmt of statements) {
    const table = statementTargetTable(stmt);
    if (table !== null && locked.has(table)) skipped.push(stmt);
    else kept.push(stmt);
  }
  return { kept, skipped };
}

/**
 * v1 drizzle-kit INCLUDES destructive statements in sqlStatements (hints are
 * empty even for drops — observed on SQLite, Postgres and MySQL, 2026-07).
 * By the time the pipeline's Phase D runs, every user-approved destructive
 * operation has already been executed by the pre-resolution executor, so any
 * DROP TABLE / DROP COLUMN remaining in the kit's additive remainder is
 * unexpected and must fail the apply.
 *
 * Exception: SQLite's table-rebuild block (CREATE `__new_x` → INSERT SELECT →
 * DROP TABLE x → RENAME `__new_x` TO x) is data-preserving — its internal
 * DROP targets a table that is being rebuilt, identified by a matching
 * `__new_<table>` RENAME in the same statement set.
 */
export function findUnexpectedDestructiveStatements(
  statements: string[],
  // When provided (the pipeline's Phase D, which KNOWS the approved
  // operations), a rebuild block is only exempt if Nextly's own diff
  // approved a rebuild-justifying change for that table. This closes the
  // hole where the kit encodes a column DROP as a "rebuild" (CREATE __new_
  // without the column + INSERT of survivors + DROP + RENAME — verified
  // rc.4 emission): text-level the block looks data-preserving, but if
  // Nextly approved no change to that table, the kit's differ disagrees
  // with ours and the block must fail the apply. The boot-time fresh-push
  // path passes nothing here (it has no op context) and keeps the
  // exemption — its reconcile legitimately rebuilds drifted core tables.
  allowedRebuildTables?: Set<string>,
  // When provided, restrict the scan to destructive statements that target a
  // MANAGED table (a table in the desired schema). This lets the caller run
  // the scan on the RAW kit output — BEFORE filterUnsafeStatements — so the
  // guarantee no longer rests on the filter having correctly stripped every
  // orphan drop first. Drops of tables/objects
  // outside the desired schema are the expected orphan emission the filter
  // handles separately; identifying them by table membership here (rather than
  // by "the filter already removed it") makes the destructive-on-managed
  // guard independent of the filter. Omitted on the fresh-push boot path,
  // which has no desired-table context and scans everything.
  managedTables?: Set<string>
): string[] {
  // A statement only counts as an offender when it hits a table we manage.
  // With no managed set, every table is in scope (fresh-push boot path).
  const targetsManaged = (table: string): boolean =>
    managedTables === undefined || managedTables.has(table.toLowerCase());

  const rebuildTargets = new Set<string>();
  for (const s of statements) {
    const m = s.match(
      // Optionally schema-qualified and/or quoted: `__new_x`, "__new_x",
      // "main"."__new_x", main.__new_x. The RENAME destination is captured
      // too: a rebuild is only a rebuild when `__new_x` renames back to `x`
      // itself — `ALTER TABLE __new_g1 RENAME TO other` must NOT exempt
      // `DROP TABLE g1` from the guard.
      /ALTER\s+TABLE\s+(?:[`"]?[A-Za-z0-9_]+[`"]?\.)?[`"]?__new_([A-Za-z0-9_]+)[`"]?\s+RENAME\s+TO\s+(?:[`"]?[A-Za-z0-9_]+[`"]?\.)?[`"]?([A-Za-z0-9_]+)[`"]?/i
    );
    if (m && (m[1] ?? "").toLowerCase() === (m[2] ?? "").toLowerCase()) {
      rebuildTargets.add((m[1] ?? "").toLowerCase());
    }
  }
  const offenders: string[] = [];
  for (const s of statements) {
    const dropTable = s.match(
      // Skip an optional schema qualifier so `DROP TABLE "main"."posts"`
      // captures `posts`, not `main`.
      /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:[`"]?[A-Za-z0-9_]+[`"]?\.)?[`"]?([A-Za-z0-9_]+)[`"]?/i
    );
    if (dropTable) {
      const target = (dropTable[1] ?? "").toLowerCase();
      // A drop of a non-managed table is the expected orphan emission
      // (stripped by filterUnsafeStatements); it is never an offender here.
      if (!targetsManaged(target)) continue;
      const isRebuild = rebuildTargets.has(target);
      const rebuildApproved =
        allowedRebuildTables === undefined || allowedRebuildTables.has(target);
      if (!isRebuild || !rebuildApproved) offenders.push(s);
      continue;
    }
    // The COLUMN keyword is OPTIONAL in both PG and MySQL
    // (`ALTER TABLE t DROP "body"` drops the column) — match both forms,
    // scoped to ALTER TABLE so DROP INDEX/CONSTRAINT statements aren't
    // misclassified. TRUNCATE is destructive by definition and must never
    // appear on an additive remainder — fail closed on it too.
    const alterDropColumn = s.match(
      /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:[`"]?[A-Za-z0-9_]+[`"]?\.)?[`"]?([A-Za-z0-9_]+)[`"]?[^;]*\bDROP\s+(?:COLUMN\s+)?[`"]?[A-Za-z0-9_]+[`"]?/i
    );
    if (
      alterDropColumn &&
      !/\bDROP\s+(?:CONSTRAINT|INDEX|KEY|FOREIGN\s+KEY|PRIMARY\s+KEY|CHECK|DEFAULT|NOT\s+NULL)\b/i.test(
        s
      )
    ) {
      if (targetsManaged(alterDropColumn[1] ?? "")) offenders.push(s);
      continue;
    }
    const truncate = s.match(
      /\bTRUNCATE\s+(?:TABLE\s+)?(?:[`"]?[A-Za-z0-9_]+[`"]?\.)?[`"]?([A-Za-z0-9_]+)[`"]?/i
    );
    if (truncate && targetsManaged(truncate[1] ?? "")) offenders.push(s);
  }
  return offenders;
}
