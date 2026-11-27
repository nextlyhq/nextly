#!/usr/bin/env node
/**
 * Where the words "site template" are used, in the places people and agents
 * read.
 *
 * "Site templates" is the product's name for the ready-made whole-site designs
 * a gallery will offer, and no such gallery exists yet. The starts the
 * installer offers (Blank, Blog, Plugin) are project templates, called by
 * their own names, so the words have no right use in these places today. An
 * email template a site owns is one of "your own templates", as against
 * "plugin templates"; calling it a site template made one name mean two
 * things. When the gallery ships, its pages and code are where the words
 * belong, and this check learns to allow them there.
 *
 * Read as text, comments and test names included, because the email code's
 * comments and tests are where the second meaning lived, and an agent reads
 * them as readily as a screen. Matched as words, across a comment's line
 * break: `site-templates` and `dc_site_templates` are code names a site may
 * choose, and "website template" is another word.
 *
 * `check-words-site-template.test.mjs` runs it on every pull request; run it
 * directly to list what it finds.
 *
 * @module check-words-site-template
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The folders read, by repository-relative path. */
export const SCANNED = [
  "docs",
  // Pending release notes, which become the published changelog.
  ".changeset",
  "packages/admin/src",
  "packages/create-nextly-app/src",
  // The whole core, whose email domain held the second meaning, and the form
  // builder, whose notifications send a site's own email templates.
  "packages/nextly/src",
  "packages/plugin-form-builder/src",
  // The starts the installer copies into new projects, README and comments
  // included.
  "templates",
];

/** Files a person or an agent reads: source, tests and docs. */
const READ_FILE = /\.(?:[cm]?[jt]sx?|mdx?|json)$/;
const SKIPPED_DIR = new Set(["node_modules", "dist", ".turbo"]);

/**
 * "site" and "template(s)" as a reader sees them: with spaces, a comment's
 * `*` or `//`, an HTML tag (`site <em>template</em>`), a link's bracket
 * (`site [template](…)`) or the end of a link (`[site](…) template`) between
 * them. So a comment wrapped between the two, or one word linked or styled,
 * is still read.
 */
const SITE_TEMPLATE =
  /\bsite(?:\s|\*|\/\/|<[^>\n]*>|\[|\]\([^)\n]*\))+templates?\b/gi;

/** Every read file beneath `at`, or `at` itself when it is a file. */
function readFiles(at) {
  if (statSync(at).isFile()) return READ_FILE.test(at) ? [at] : [];
  return readdirSync(at, { withFileTypes: true }).flatMap(entry => {
    if (SKIPPED_DIR.has(entry.name)) return [];
    const path = join(at, entry.name);
    if (entry.isDirectory()) return readFiles(path);
    return READ_FILE.test(entry.name) ? [path] : [];
  });
}

/**
 * The uses in one file's text, each as `file:line: text of that line`, the
 * line being where the words start.
 */
export function siteTemplateWordsIn(file, text) {
  const found = [];
  for (const match of text.matchAll(SITE_TEMPLATE)) {
    const before = text.slice(0, match.index);
    const line = before.split("\n").length;
    const lineText = text.split("\n")[line - 1].trim();
    found.push(`${file}:${String(line)}: ${lineText}`);
  }
  return found;
}

/** The uses in every scanned folder, with "/" in paths whatever the platform. */
export function siteTemplateWordsInRepository(root = ROOT) {
  return SCANNED.flatMap(folder =>
    readFiles(join(root, folder)).flatMap(file =>
      siteTemplateWordsIn(
        relative(root, file).split(sep).join("/"),
        readFileSync(file, "utf-8")
      )
    )
  );
}

if (process.argv[1]?.endsWith("check-words-site-template.mjs")) {
  const found = siteTemplateWordsInRepository();
  if (found.length > 0) {
    console.error(
      `"Site templates" names the ready-made whole-site designs a gallery will offer, ` +
        `and no gallery exists yet; call an installer start by its name. ` +
        `Say "your own template" for an email template a site owns:\n` +
        found.map(line => `  ${line}`).join("\n")
    );
    process.exit(1);
  }
  console.log(`site template words: none in ${SCANNED.join(", ")}.`);
}
