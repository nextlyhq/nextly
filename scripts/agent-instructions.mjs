/**
 * The instruction files Claude Code reads, as copies of the ones Codex reads.
 *
 * Codex reads one file per directory — `AGENTS.override.md` over `AGENTS.md`
 * — from the repository's root down to where it works. Claude Code reads
 * CLAUDE.md files, and an import does not bridge the two: it follows an
 * `@AGENTS.md` in a CLAUDE.md only when that resolves inside the directory
 * the session started in, and treats any other as an external import that
 * needs an approval a non-interactive session cannot give. A CLAUDE.md that
 * only imported its AGENTS.md therefore gave a session started below it none
 * of that file: measured with Claude Code 2.1.278, from a package and from two
 * levels down. A CLAUDE.md's own text loads in any directory below it, so each
 * directory holding an instruction file gets a CLAUDE.md that is a copy of
 * it, and both tools read the same text wherever they start.
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { instructionFiles } from "./check-instruction-size.mjs";
import { isCliEntry } from "./cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** What a copy begins with: the file it copies, and that it is not to be edited. */
export function header(source) {
  return `<!-- Generated from ${posix.basename(source)} by \`pnpm instructions:sync\`. Edit that file, never this one. -->\n\n`;
}

/** Each CLAUDE.md Claude Code reads, and the file Codex takes in the same directory, which it copies. */
export function copies(tracked) {
  return [...instructionFiles(tracked)].map(([dir, source]) => ({ source, copy: posix.join(dir, "CLAUDE.md") }));
}

/** The text a copy holds: its header, then its source whole. */
function copyText(base, source) {
  return header(source) + readFileSync(join(base, source), "utf8");
}

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * How the copies fall short: a CLAUDE.md missing beside an instruction file,
 * one that differs from it, and one that has no instruction file to copy.
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
      .map(path => ({ path, problem: "copies no AGENTS.md beside it, so Codex never reads its text", fix: "move its text into an AGENTS.md there, then run pnpm instructions:sync" })),
  ];
}

function driftOf(base, source, copy) {
  const text = readIfPresent(join(base, copy));
  if (text === null) return [{ path: copy, problem: `is missing, so Claude Code never reads ${source}`, fix: "run pnpm instructions:sync" }];
  return text === copyText(base, source) ? [] : [{ path: copy, problem: `differs from ${source}`, fix: "run pnpm instructions:sync" }];
}

/** Whether a CLAUDE.md may be rewritten: a copy made here, or the one-line import of its source this replaces. */
const replaceable = (text, source) => text.startsWith("<!-- Generated from ") || text.trim() === `@${posix.basename(source)}`;

function trackedFiles(base) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: base, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

/**
 * Rewrites every copy from its source. A CLAUDE.md holding text of its own is
 * refused rather than overwritten, since that text would be lost; move it
 * into the AGENTS.md beside it first.
 */
export function syncCopies(base = root, tracked = trackedFiles(base)) {
  for (const { source, copy } of copies(tracked)) {
    const current = readIfPresent(join(base, copy));
    if (current !== null && !replaceable(current, source)) throw new Error(`${copy} holds text of its own; move it into ${source}, then sync again`);
    writeFileSync(join(base, copy), copyText(base, source));
  }
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
