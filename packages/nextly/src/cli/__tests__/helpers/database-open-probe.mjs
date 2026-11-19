/**
 * Loaded into a CLI process with `--import`: records, in the order they
 * happen, each line written to standard error and each SQLite database the
 * process first runs a statement on, and writes the list to `NEXTLY_OPEN_PROBE_OUT` as the
 * process exits. A test reads from it whether a command opened a database,
 * and what it had said before it did.
 */
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";

const out = process.env.NEXTLY_OPEN_PROBE_OUT;
/** Each event: `{ said: line }` or `{ opened: file }`. */
const events = [];

const writeErr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  for (const line of String(chunk).split("\n")) {
    if (line.trim() !== "") events.push({ said: line });
  }
  return writeErr(chunk, ...rest);
};

// The driver's module is the one the CLI loads, whichever way it imports it,
// so its prototype is shared. A database is noted at the first statement it
// is given, by the file it was opened on.
const noted = new WeakSet();
for (const method of ["prepare", "exec", "pragma"]) {
  const original = Database.prototype[method];
  Database.prototype[method] = function (...args) {
    if (!noted.has(this)) {
      noted.add(this);
      events.push({ opened: this.memory ? ":memory:" : String(this.name) });
    }
    return original.apply(this, args);
  };
}

process.on("exit", () => {
  if (out) writeFileSync(out, JSON.stringify(events));
});
