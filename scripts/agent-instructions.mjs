/**
 * The instruction files Claude Code reads, as copies of the ones the AGENTS.md
 * harness reads.
 *
 * The AGENTS.md harness reads one file per directory — `AGENTS.override.md`
 * over `AGENTS.md` — from the repository's root down to where it works. Claude
 * Code reads CLAUDE.md files, and an import does not bridge the two: it
 * follows an `@AGENTS.md` in a CLAUDE.md only when that resolves inside the
 * directory the session started in, and treats any other as an external
 * import that needs an approval a non-interactive session cannot give. A
 * CLAUDE.md that only imported its AGENTS.md therefore gave a session started
 * below it none of that file: measured with Claude Code 2.1.278, from a
 * package and from two levels down. A CLAUDE.md's own text loads in any
 * directory below it, so each directory holding an instruction file gets a
 * CLAUDE.md that is a copy of it, and both tools read the same text wherever
 * they start.
 *
 * Claude Code reading AGENTS.md itself is not the answer either: it does so
 * only while no CLAUDE.md or CLAUDE.local.md exists at or above where it
 * starts, only from version 2.1.277, and never reads `AGENTS.override.md`.
 *
 *   node scripts/agent-instructions.mjs sync   # rewrite every copy
 *
 * `scripts/check-agent-contract.mjs` holds each copy identical to its source.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { instructionFiles } from "./check-instruction-size.mjs";
import { isCliEntry } from "./cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SYNC = "run pnpm instructions:sync";

/**
 * A digest of a copy's words, blind to whitespace and to the marks the
 * formatter rewrites — table padding and rules, list and emphasis markers,
 * escapes. The formatter that runs on every commit rewrites a copy exactly as
 * it rewrites its source, and that is no edit; a word added is one.
 */
const digest = text => createHash("sha256").update(text.replace(/[\s*_\-+|:\\]+/g, "")).digest("hex").slice(0, 16);

/** What a copy begins with: the file it copies, a digest of the text it copied, and that it is not to be edited. */
export function header(source, body) {
  return `<!-- Generated from ${posix.basename(source)} by \`pnpm instructions:sync\` (${digest(body)}). Edit that file, never this one. -->\n\n`;
}

const HEADER = /^<!-- Generated from [^\n]* \(([0-9a-f]{16})\)\. Edit that file, never this one\. -->\n\n/;

/** Each CLAUDE.md Claude Code reads, and the file the AGENTS.md harness takes in the same directory, which it copies. */
export function copies(files) {
  return [...instructionFiles(files)].map(([dir, source]) => ({ source, copy: posix.join(dir, "CLAUDE.md") }));
}

/** The text a copy holds: its header, then its source whole. */
function copyText(base, source) {
  const body = readFileSync(join(base, source), "utf8");
  return header(source, body) + body;
}

/** What is at a path, without following a link; null when nothing is. */
function entryAt(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * How the copies fall short: a CLAUDE.md missing beside an instruction file,
 * one that is a symbolic link, one that differs from its source, and one that
 * has no instruction file to copy.
 *
 * @returns {{ path: string, problem: string, fix: string }[]}
 */
export function copyDrift(base, tracked) {
  const expected = copies(tracked);
  const copied = new Set(expected.map(({ copy }) => copy));
  return [
    ...expected.flatMap(({ source, copy }) => driftOf(base, source, copy)),
    ...tracked
      .filter(path => posix.basename(path) === "CLAUDE.md" && !copied.has(path))
      .map(path => ({ path, problem: "copies no AGENTS.md beside it, so the AGENTS.md harness never reads its text", fix: "move its text into an AGENTS.md there, then run pnpm instructions:sync" })),
  ];
}

function driftOf(base, source, copy) {
  const entry = entryAt(join(base, copy));
  if (entry === null) return [{ path: copy, problem: `is missing, so Claude Code never reads ${source}`, fix: SYNC }];
  if (entry.isSymbolicLink()) return [{ path: copy, problem: "is a symbolic link — it must be a real copy", fix: "replace it with a real file, then run pnpm instructions:sync" }];
  return readFileSync(join(base, copy), "utf8") === copyText(base, source) ? [] : [{ path: copy, problem: `differs from ${source}`, fix: SYNC }];
}

/**
 * Whether a CLAUDE.md can be rewritten without losing text: a copy made here
 * that nobody has edited since — its text still matches the digest its header
 * recorded, or already matches its source — or the one-line import of its
 * source that the copies replaced.
 */
function replaceable(text, source, body) {
  const recorded = HEADER.exec(text);
  if (recorded === null) return text.trim() === `@${posix.basename(source)}`;
  const copied = text.slice(recorded[0].length);
  return digest(copied) === recorded[1] || copied === body;
}

/** Why one copy may not be rewritten, or null when it may. */
function refusal(base, source, copy) {
  const entry = entryAt(join(base, copy));
  if (entry === null) return null;
  if (entry.isSymbolicLink()) return `${copy} is a symbolic link, which a write would follow to another file; replace it with a real file, then sync again`;
  return replaceable(readFileSync(join(base, copy), "utf8"), source, readFileSync(join(base, source), "utf8")) ? null : `${copy} holds text of its own; move it into ${source}, then sync again`;
}

/** The files to copy from: tracked ones, and new ones git does not ignore, so a new AGENTS.md is copied before it is staged. */
function repositoryFiles(base) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: base, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(path => path && entryAt(join(base, path)) !== null);
}

/**
 * Rewrites every copy from its source. Every copy is checked before any is
 * written, so a refusal leaves them all as they were: a copy holding text of
 * its own, which would be lost, or a symbolic link, which the write would
 * follow to another file.
 */
export function syncCopies(base = root, files = repositoryFiles(base)) {
  const planned = copies(files);
  const refused = planned.map(({ source, copy }) => refusal(base, source, copy)).filter(Boolean);
  if (refused.length > 0) throw new Error(refused.join("\n"));
  for (const { source, copy } of planned) writeFileSync(join(base, copy), copyText(base, source));
}

if (isCliEntry(import.meta.url)) {
  if (process.argv[2] === "sync") {
    syncCopies();
    console.log("agent-instructions: each CLAUDE.md rewritten from the instruction file beside it");
  } else {
    console.error("usage: node scripts/agent-instructions.mjs sync");
    process.exit(64);
  }
}
