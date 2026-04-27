// SQLite recreate-pattern detection for F4 RenameDetector.
//
// SQLite has no ALTER COLUMN TYPE. To change a column type, drizzle-kit emits
// a 4-statement recreate block:
//   CREATE TABLE "<X>" (...)               -- temp table
//   INSERT INTO "<X>" (...) SELECT FROM "<Y>" (...)
//   DROP TABLE "<Y>"
//   ALTER TABLE "<X>" RENAME TO "<Y>"      -- temp -> original
//
// The DROP+RENAME inside this block is NOT a column rename - it's a
// table-level pseudo-rename done as part of the type-change workaround.
// Without this filter, the rename detector would create false candidates
// from the DROP TABLE / RENAME TABLE pair.
//
// Detection is structural - we look for the 4-statement window with X as
// the temp name and Y as the original. We deliberately do NOT depend on
// the literal "__new" prefix; if drizzle-kit changes its temp-table
// naming convention (e.g., "__new" -> "tmp_xxx"), structural detection
// still works.

// Tolerates optional `IF NOT EXISTS` defensively - current drizzle-kit
// doesn't emit it for the recreate temp table (always a fresh name), but
// matching the DROP regex's IF EXISTS tolerance keeps detection robust
// against future version changes.
const CREATE_RE =
  /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s*\(/i;
const INSERT_RE =
  /^\s*INSERT\s+INTO\s+"([^"]+)"\s*\([^)]+\)\s+SELECT\s+[\s\S]+?FROM\s+"([^"]+)"/i;
const DROP_RE = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i;
const RENAME_RE = /^\s*ALTER\s+TABLE\s+"([^"]+)"\s+RENAME\s+TO\s+"([^"]+)"/i;

// Filters out 4-statement recreate blocks from a SQLite statement list.
// A recreate block is detected by structural match:
//   CREATE TABLE "X" (...)
//   INSERT INTO "X" (...) SELECT ... FROM "Y" (...)
//   DROP TABLE "Y"
//   ALTER TABLE "X" RENAME TO "Y"
// with consistent X and Y across all four statements.
//
// Returns a new array with all complete recreate blocks removed; partial
// matches and unrelated statements are preserved in original order.
export function filterSqliteRecreateBlocks(statements: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < statements.length) {
    if (i + 3 < statements.length && isRecreateBlock(statements, i)) {
      i += 4;
      continue;
    }
    out.push(statements[i]);
    i += 1;
  }
  return out;
}

function isRecreateBlock(statements: string[], start: number): boolean {
  const create = CREATE_RE.exec(statements[start]);
  if (!create) return false;
  const tempTable = create[1];

  const insert = INSERT_RE.exec(statements[start + 1]);
  if (!insert) return false;
  if (insert[1] !== tempTable) return false;
  const originalTable = insert[2];

  const drop = DROP_RE.exec(statements[start + 2]);
  if (!drop) return false;
  if (drop[1] !== originalTable) return false;

  const rename = RENAME_RE.exec(statements[start + 3]);
  if (!rename) return false;
  if (rename[1] !== tempTable) return false;
  if (rename[2] !== originalTable) return false;

  return true;
}
