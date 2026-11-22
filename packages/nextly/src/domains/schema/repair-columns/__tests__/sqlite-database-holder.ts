/**
 * A second process holding a SQLite database, as another program on the site would: in exclusive
 * locking mode (in a rollback journal; its first write keeps every other connection out until it
 * closes), or with a write transaction left open (in WAL mode, as Nextly opens SQLite).
 *
 * A process of its own, because SQLite waits for a lock synchronously: while the run under test
 * waits out its busy timeout, nothing else in its process runs, so a holder there could never let
 * go in time.
 *
 * Arguments: the database file, `exclusive` or `write`, a table to write a row to, and how many
 * milliseconds to hold before letting go on its own. It prints `held` once it holds the database,
 * lets go early on SIGTERM, and prints `freed` before it exits.
 *
 * Not a test file itself, so the integration runner never collects it.
 */
import Database from "better-sqlite3";

const [file, mode, table, holdMs] = process.argv.slice(2);
if (
  file === undefined ||
  (mode !== "exclusive" && mode !== "write") ||
  table === undefined ||
  holdMs === undefined
) {
  throw new Error("usage: <file> <exclusive|write> <table> <holdMs>");
}

const db = new Database(file, { timeout: 100 });
const insert = `INSERT INTO "${table}" (x) VALUES (1)`;
if (mode === "exclusive") {
  db.pragma("locking_mode = EXCLUSIVE");
  db.prepare(insert).run();
} else {
  db.exec("BEGIN IMMEDIATE");
  db.prepare(insert).run();
}
console.log("held");

let freed = false;
function free(): void {
  if (freed) return;
  freed = true;
  if (mode === "write") db.exec("ROLLBACK");
  db.close();
  console.log("freed");
  process.exit(0);
}

setTimeout(free, Number(holdMs));
// A signal, not a line on stdin: one that already let go has closed its input.
process.on("SIGTERM", free);
