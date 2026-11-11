#!/usr/bin/env node

/**
 * No status colour is drawn from a mixed tint.
 *
 * Every status has four named tokens, light and dark set together: `-surface`,
 * `-border`, `-text` and `-solid` (`packages/ui/src/styles/theme.css`). The
 * numbered shades (`success-100`, `destructive-700`) and opacity mixes
 * (`bg-destructive/10`) are `color-mix()` derivations of one base colour: a
 * pale fill with darkened ink that reads on a light page and has to be
 * rescued by a hand-written `dark:` pair on a dark one. They stay defined so
 * a third-party plugin keeps building, but nothing first-party draws them.
 *
 * What is scanned is what the admin can PAINT: every string a source file
 * spells out (quoted strings and every literal part of a template), and CSS
 * outside its comments. Comments are not read, since a class named in one is
 * never drawn. Variant prefixes (`dark:`, `hover:`) do not hide a tint, and
 * an arbitrary value naming a shade's variable (`var(--color-warning-700)`)
 * is one too.
 *
 * Out of scope by construction, not by exception: the files that DEFINE the
 * shades and audit their contrast (`theme.css`, `tailwind-preset.ts`,
 * `styles/contrast/`), and tests, which name shades to prove this check and
 * the contrast suite catch them.
 *
 * Usage: node scripts/check-status-tints.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

/** Where first-party admin colour is authored. */
export const ROOTS = [
  "packages/admin/src",
  "packages/ui/src",
  "packages/plugin-*/src",
];

/** The shades' own definitions and their contrast audit. */
const DEFINITION_FILES = new Set([
  "packages/ui/src/styles/theme.css",
  "packages/ui/src/tailwind-preset.ts",
]);
const DEFINITION_DIRS = ["packages/ui/src/styles/contrast/"];

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /(?:^|\/)__tests__\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;

/**
 * Files allowed to keep a tint, each with the exact tint and why. It starts
 * empty, and an entry no longer needed fails the check, so it only shrinks.
 *
 * @type {ReadonlyArray<{ file: string; tint: string; reason: string }>}
 */
export const ALLOWED = [];

const STATUS = "(?:success|warning|destructive|danger|info)";
const SHADE = "(?:50|[1-9]00|950)";
/** A colour utility's property: what Tailwind paints a colour onto. */
const PROPERTY =
  "(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret|placeholder)";

/**
 * A mixed tint in one class or one CSS value: a status shade or an opacity
 * mix of a status colour on any colour property, behind any variants, or a
 * shade's variable named directly.
 */
export const TINT = new RegExp(
  `(?<![\\w-])(?:[\\w\\[\\]&*>:.-]+:)?${PROPERTY}-${STATUS}(?=[-/])(?:-${SHADE})?(?:/(?:\\d{1,3}|\\[[^\\]\\s]+\\]))?(?![\\w-])` +
    `|--color-${STATUS}-${SHADE}(?![\\w-])`,
  "g"
);

/** Every tint in one string, in order. */
export function tintsIn(text) {
  return [...text.matchAll(TINT)].map(match => match[0]);
}

/** The strings a script or component spells out, comments excluded. */
export function stringsIn(source, fileName) {
  const strings = [];
  walk(parseSource(source, fileName).program, node => {
    if (node.type === "Literal" && typeof node.value === "string") {
      strings.push(node.value);
    } else if (node.type === "TemplateElement") {
      strings.push(node.value.cooked ?? node.value.raw);
    } else if (node.type === "JSXText") {
      strings.push(node.value);
    }
  });
  return strings;
}

/** CSS without its comments, the only part a browser applies. */
export function cssWithoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The tints one file draws, from its path and its text. */
export function tintsInFile(path, source) {
  if (path.endsWith(".css")) return tintsIn(cssWithoutComments(source));
  return stringsIn(source, path).flatMap(tintsIn);
}

/** Whether a tracked file is first-party source this check reads. */
export function isScanned(path) {
  if (!SOURCE.test(path) && !path.endsWith(".css")) return false;
  if (TEST.test(path)) return false;
  if (DEFINITION_FILES.has(path)) return false;
  return !DEFINITION_DIRS.some(dir => path.startsWith(dir));
}

/** The tracked files under the roots that this check reads. */
export function scannedFiles(cwd = process.cwd()) {
  const listed = execFileSync("git", ["ls-files", "-z", "--", ...ROOTS], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed.split("\0").filter(Boolean).filter(isScanned);
}

/**
 * Every tint the repository draws that `ALLOWED` does not list, and every
 * `ALLOWED` entry nothing needs any more, with how many files were read so a
 * caller can refuse a scan that read none.
 */
export function audit(cwd = process.cwd(), allowed = ALLOWED) {
  const files = scannedFiles(cwd);
  const found = files.flatMap(file =>
    tintsInFile(file, readFileSync(`${cwd}/${file}`, "utf8")).map(tint => ({
      file,
      tint,
    }))
  );
  const isAllowed = ({ file, tint }) =>
    allowed.some(entry => entry.file === file && entry.tint === tint);
  return {
    filesRead: files.length,
    findings: found.filter(each => !isAllowed(each)),
    unusedAllowances: allowed.filter(
      entry =>
        !found.some(
          each => each.file === entry.file && each.tint === entry.tint
        )
    ),
  };
}

function main() {
  const { filesRead, findings, unusedAllowances } = audit();
  if (filesRead === 0) {
    console.error(
      "check-status-tints: read no files, so it proves nothing. Run it from the repository root."
    );
    return 1;
  }
  for (const { file, tint } of findings) {
    console.error(
      `${file}: ${tint} is a mixed status tint. Use the status's -surface, -border, -text or -solid token.`
    );
  }
  for (const { file, tint } of unusedAllowances) {
    console.error(
      `${file}: ALLOWED lists ${tint}, which the file no longer draws. Remove the entry.`
    );
  }
  if (findings.length + unusedAllowances.length > 0) return 1;
  console.log(
    `check-status-tints: no mixed status tints in ${filesRead} files.`
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main();
