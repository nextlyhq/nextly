/**
 * Whether the instructions Codex loads fit what it reads of them.
 *
 * Codex reads one instruction file from each directory on the path from the
 * repository's root to the directory it works in — `AGENTS.override.md` where
 * a directory has one, otherwise `AGENTS.md` — and joins them, root first, up
 * to 32 KiB. What is past that is cut from the end, so the most specific file,
 * the one for the directory being worked in, is the first to go. Measured
 * with codex-cli 0.155.1 and `codex debug prompt-input`, which renders what
 * the model would be sent without sending it: a chain of 32,769 bytes (32 KiB
 * and a final newline) loads whole, and a byte more is cut. The budget here
 * is 32 KiB exactly.
 *
 * Any directory's chain is the chain of its nearest ancestor that holds an
 * instruction file, so one chain per such directory covers every directory
 * Codex can be started in. Each chain over the budget is reported with its
 * files and the bytes over.
 *
 *   node scripts/check-instruction-size.mjs [--root <dir>]
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntry } from "./cli-entry.mjs";

export const LIMIT = 32 * 1024;

/** The names Codex takes an instruction file by, the one it prefers first. */
export const NAMES = ["AGENTS.override.md", "AGENTS.md"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Whether Codex takes `path` over `held`, the file already found in the same directory. */
const preferred = (held, path) => held === undefined || NAMES.indexOf(posix.basename(path)) < NAMES.indexOf(posix.basename(held));

/** For each directory holding an instruction file, the one Codex takes there, keyed by the directory (`.` for the root). */
export function instructionFiles(tracked) {
  const taken = new Map();
  for (const path of tracked.filter(file => NAMES.includes(posix.basename(file)))) {
    const dir = posix.dirname(path);
    if (preferred(taken.get(dir), path)) taken.set(dir, path);
  }
  return taken;
}

/** The directories on the path from the root to `dir`, the root first. */
export function ancestors(dir) {
  if (dir === ".") return ["."];
  const parts = dir.split("/");
  return [".", ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))];
}

/**
 * The chain Codex joins for each directory holding an instruction file: the
 * file it takes from each directory on the way down, and their bytes.
 *
 * @returns {{ dir: string, files: { path: string, bytes: number }[], bytes: number }[]}
 */
export function chains(tracked, sizeOf) {
  const files = instructionFiles(tracked);
  return [...files.keys()].sort().map(dir => {
    const chain = ancestors(dir)
      .map(step => files.get(step))
      .filter(Boolean)
      .map(path => ({ path, bytes: sizeOf(path) }));
    return { dir, files: chain, bytes: chain.reduce((sum, file) => sum + file.bytes, 0) };
  });
}

/** The chains past the budget, the largest first. */
export function overBudget(all, limit = LIMIT) {
  return all.filter(chain => chain.bytes > limit).sort((a, b) => b.bytes - a.bytes);
}

const count = bytes => bytes.toLocaleString("en-US");

/** One line naming a chain over the budget: its files, their sum, and how far over it is. */
export function describe(chain, limit = LIMIT) {
  const parts = chain.files.map(file => `${file.path} (${count(file.bytes)})`).join(" + ");
  return `${chain.dir}: ${parts} = ${count(chain.bytes)} bytes, ${count(chain.bytes - limit)} over the ${count(limit)} Codex reads`;
}

function trackedFiles(base) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: base, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

/** Checks a checkout and returns the exit code: 0 when every chain fits, 1 when one does not. */
export function main(base = root) {
  const all = chains(trackedFiles(base), path => statSync(join(base, path)).size);
  const over = overBudget(all);
  if (over.length > 0) {
    console.error(`instruction-size: ${over.length} chain(s) of AGENTS.md files are past what Codex reads, which cuts the file for the directory worked in first:`);
    for (const chain of over) console.error(`  ${describe(chain)}`);
    console.error("Move text into a skill in .agents/skills, and leave a pointer to it.");
    return 1;
  }
  const largest = [...all].sort((a, b) => b.bytes - a.bytes)[0];
  console.log(`instruction-size: OK — ${all.length} chain(s)${largest ? `, the largest ${largest.dir} at ${count(largest.bytes)} of ${count(LIMIT)} bytes` : ""}`);
  return 0;
}

if (isCliEntry(import.meta.url)) {
  const at = process.argv.indexOf("--root");
  if (at !== -1 && !process.argv[at + 1]) {
    console.error("usage: node scripts/check-instruction-size.mjs [--root <dir>]");
    process.exit(64);
  }
  process.exit(main(at === -1 ? root : resolve(process.argv[at + 1])));
}
