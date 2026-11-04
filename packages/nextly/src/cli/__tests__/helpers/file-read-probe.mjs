/**
 * Loaded into a CLI process with `--import`: records every file-system call
 * that names an environment file (`.env`, `.env.*`) or a Nextly configuration
 * file (`nextly.config.*`), and writes the paths to `NEXTLY_READ_PROBE_OUT`
 * as the process exits. An existence check counts: deciding whether a file is
 * there is the first step of reading it.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.env.NEXTLY_READ_PROBE_OUT;
const seen = new Set();

const watched = name =>
  name.startsWith(".env") || name.startsWith("nextly.config.");

function note(target) {
  if (typeof target !== "string" && !(target instanceof URL)) return;
  const path = target instanceof URL ? fileURLToPath(target) : target;
  if (watched(basename(path))) seen.add(path);
}

function wrap(owner, method) {
  const original = owner[method];
  if (typeof original !== "function") return;
  owner[method] = function (target, ...rest) {
    note(target);
    return original.call(this, target, ...rest);
  };
}

for (const method of [
  "readFileSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "openSync",
  "accessSync",
  "readFile",
  "stat",
  "lstat",
  "open",
  "access",
  "createReadStream",
]) {
  wrap(fs, method);
}
for (const method of ["readFile", "stat", "lstat", "open", "access"]) {
  wrap(fs.promises, method);
}
// Named imports of `node:fs` read these bindings, not the object's properties.
syncBuiltinESMExports();

if (out) {
  process.on("exit", () => {
    fs.writeFileSync(out, JSON.stringify([...seen]));
  });
}
