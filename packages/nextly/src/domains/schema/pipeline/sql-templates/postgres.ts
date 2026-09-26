// F11 PR 3: PostgreSQL SQL templates per Operation type.
//
// Pure functions. No I/O. No semicolons (the apply pipeline runs each
// statement via tx.execute(); the file formatter adds `;` when joining
// statements for migrate:create output).

import type {
  ChangeColumnDefaultOp,
  ChangeColumnNullableOp,
  ChangeColumnTypeOp,
  DropIndexOp,
  DropTableOp,
  Operation,
} from "../diff/types";

import { commonStatementSql, dropConstraintSql } from "./common-statements";
import { createIndexSql } from "./create-index";
import {
  changeForeignKeyActionSql,
  unsupportedOperation,
} from "./foreign-key-action";
import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "postgresql");

export function generatePgSQL(op: Operation): string {
  // The three dialect dispatchers are switches over the SAME `Operation`
  // union, so their arms line up one for one and their tails are identical
  // text. That parallelism is the safety property, not an accident: each
  // narrows the union to `never` in its own default arm, so adding a member
  // to `Operation` is a COMPILE error in every dialect that has not handled
  // it — which is how `change_foreign_key_action` located all seven of its
  // consumers instead of leaving one to fail at run time on whichever dialect
  // a user happened to be on. Sharing them means a handler table keyed by op
  // type, and a table is not exhaustiveness-checked per dialect: a missing
  // entry becomes an undefined lookup while writing DDL.
  // fallow-ignore-next-line code-duplication
  switch (op.type) {
    case "add_table":
    case "rename_table":
    case "add_column":
    case "drop_column":
    case "rename_column":
    case "add_check":
    case "add_foreign_key":
      // Rendered alike on every dialect but for the quote function.
      return commonStatementSql(op, "postgresql", q);
    case "drop_table":
      return generateDropTable(op);
    case "change_column_type":
      return generateChangeColumnType(op);
    case "change_column_nullable":
      return generateChangeColumnNullable(op);
    case "change_column_default":
      return generateChangeColumnDefault(op);
    case "add_index":
      return createIndexSql(op.tableName, op.index, "postgresql", q);
    case "drop_check":
      return dropConstraintSql(
        op.tableName,
        op.check.name,
        "DROP CONSTRAINT IF EXISTS",
        q
      );
    case "drop_foreign_key":
      return dropConstraintSql(
        op.tableName,
        op.foreignKey.name,
        "DROP CONSTRAINT IF EXISTS",
        q
      );
    case "drop_index":
      return generateDropIndex(op);
    case "change_foreign_key_action":
      // The drop is near-instant (no scan); the add re-checks the existing
      // rows. How each dialect spells the drop is decided once, beside the
      // statements themselves.
      return changeForeignKeyActionSql(op, "postgresql");
    default:
      return unsupportedOperation("generatePgSQL", op);
  }
}

function generateDropIndex(op: DropIndexOp): string {
  // A non-unique index is never owned by a constraint, so the plain form is
  // always correct for it.
  if (!op.index.unique) return `DROP INDEX IF EXISTS ${q(op.index.name)}`;

  // A managed unique exists in one of two physical forms on Postgres, and the
  // name alone does not say which: `ALTER TABLE ... ADD CONSTRAINT <name>
  // UNIQUE` (how the dynamic collection/component/user-ext schema services
  // create a `unique: true` field) leaves an index OWNED by that constraint,
  // while the diff's own add_index path emits `CREATE UNIQUE INDEX <name>`,
  // which is a bare index. Postgres refuses `DROP INDEX` on the constraint-
  // owned form — "cannot drop index ... because constraint ... requires it" —
  // and `IF EXISTS` does not suppress that, it only suppresses a missing
  // object. There is no single statement covering both forms, so run both
  // idempotent drops in one DO block: dropping the constraint takes its index
  // with it and the following DROP INDEX no-ops, while for a bare index the
  // DROP CONSTRAINT no-ops and the DROP INDEX does the work.
  // Emitted as two plain statements rather than a DO block: this SQL is also
  // written verbatim into migrate:create files, and the migration runner's
  // splitter understands quotes and semicolons but not dollar-quoting, so a
  // DO block would be split into unterminated fragments.
  return (
    `ALTER TABLE ${q(op.tableName)} DROP CONSTRAINT IF EXISTS ${q(op.index.name)}; ` +
    `DROP INDEX IF EXISTS ${q(op.index.name)}`
  );
}

// PG CASCADE drops FK references atomically. Mirrors pre-resolution
// sql-templates behavior — the F11 sql-templates module is the single
// source of truth post-PR-3.
function generateDropTable(op: DropTableOp): string {
  return `DROP TABLE ${q(op.tableName)} CASCADE`;
}

// Postgres performs an implicit cast only for a small set of type-family
// transitions (e.g. `varchar` → `text`). For most cross-family changes —
// including the common `text` → `jsonb` produced when a Builder field is
// reclassified from text-like to `group` / `json` / `blocks` — Postgres
// requires an explicit `USING` expression or errors with `cannot be cast
// automatically`. Without `USING`, code-first migrations generated by
// `nextly migrate:create` would land in the repo, pass review, then fail
// at `nextly migrate` apply time in CI (the same silent-skip → drift loop
// the fast in-memory emitter was just hardened against, just on the
// migration-file surface instead).
//
// `USING "<col>"::<toType>` dispatches to whichever cast Postgres has
// registered for the source → target pair. When no cast exists (e.g.
// arbitrary `bytea` → `int4`) Postgres raises a clear error and the
// migration aborts — which is the desired contract: explicit failure
// beats silent success.
function generateChangeColumnType(op: ChangeColumnTypeOp): string {
  return (
    `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} ` +
    `TYPE ${op.toType} USING ${q(op.columnName)}::${op.toType}`
  );
}

function generateChangeColumnNullable(op: ChangeColumnNullableOp): string {
  return op.toNullable
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP NOT NULL`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET NOT NULL`;
}

function generateChangeColumnDefault(op: ChangeColumnDefaultOp): string {
  return op.toDefault === undefined
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP DEFAULT`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET DEFAULT ${op.toDefault}`;
}
