/**
 * Loaded into a CLI process with `--import`: records, in the order they
 * happen, each line written to standard error and each SQLite database the
 * process opens, and writes the list to `NEXTLY_OPEN_PROBE_OUT` as the
 * process exits. A test reads from it whether a command opened a database,
 * and what it had said before it did.
 */
import { writeFileSync } from "node:fs";
import Module from "node:module";

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

// The SQLite driver is a CommonJS package, loaded through the loader below
// however it is imported. Its export is the database's constructor.
const load = Module._load;
Module._load = function (request, ...rest) {
  const loaded = load.call(this, request, ...rest);
  if (request !== "better-sqlite3" || typeof loaded !== "function") {
    return loaded;
  }
  return new Proxy(loaded, {
    construct(target, args, newTarget) {
      events.push({ opened: String(args[0]) });
      return Reflect.construct(target, args, newTarget);
    },
  });
};

process.on("exit", () => {
  if (out) writeFileSync(out, JSON.stringify(events));
});
