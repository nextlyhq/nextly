import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The docs describe SQLite in one agreed sentence: great on your own machine
 * and on a single server, and PostgreSQL on Vercel, where a function's disk
 * does not last. Calling it "for local demos only" tells people that the
 * database a new project starts on is not fit for the single-server site it
 * serves well. These tests keep the sentence on the pages people choose a
 * database from, keep any second verdict off those pages, and keep the old
 * wording out of every page.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The agreed description, as it reads inside a sentence. */
const SENTENCE =
  "great on your own machine and on a single server; on Vercel, choose PostgreSQL";

/** The pages that describe SQLite to someone choosing a database. */
const PAGES = [
  "docs/index.mdx",
  "docs/database/index.mdx",
  "docs/database/sqlite.mdx",
  "docs/getting-started/index.mdx",
  "docs/getting-started/installation.mdx",
  "docs/getting-started/quick-start.mdx",
  "docs/guides/deployment.mdx",
];

/** Wordings that describe SQLite as unfit for real sites, in each spelling seen. */
const OLD_WORDINGS = [
  /\bdemos? only\b/i,
  /not recommended for serious/i,
  /one-off (?:local )?demos?\b/i,
  /\bfor local work\b/i,
  /\bnot localhost\b.*\bsqlite\b/i,
];

/**
 * Words that pass a verdict on what SQLite is fit for. A sentence naming
 * SQLite with one of these is a description of it.
 */
const VERDICT =
  /\b(?:demos?|local (?:work|development|only)|serious|recommended|not suitable|single server|vercel|production)\b/i;

/** Every docs page, with forward slashes whatever the platform spells. */
function docsPages() {
  const out = [];
  const walk = abs => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mdx?$/.test(entry.name)) {
        out.push(relative(repoRoot, path).split("\\").join("/"));
      }
    }
  };
  walk(resolve(repoRoot, "docs"));
  return out.sort();
}

const read = file => readFileSync(resolve(repoRoot, file), "utf-8");

/** Whether a text states the sentence, its first letter in either case. */
export const statesTheSentence = text =>
  text.toLowerCase().includes(SENTENCE.toLowerCase());

/**
 * The lines of a page that describe SQLite in an old wording, as
 * `file:line: text`. Only a line that names SQLite counts, so another feature
 * described as "for local work" or "demos only" is left alone.
 */
export function oldWordingsIn(file, text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      /\bsqlite\b/i.test(line) && OLD_WORDINGS.some(pattern => pattern.test(line))
        ? [`${file}:${String(index + 1)}: ${line.trim()}`]
        : []
    );
}

/**
 * The sentences of a page that describe SQLite in other words: they name it
 * with a verdict and do not carry the agreed sentence. A sentence ends at a
 * full stop, a question or exclamation mark, or a line break.
 */
export function otherDescriptionsIn(text) {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter(
      sentence =>
        /\bsqlite\b/i.test(sentence) &&
        VERDICT.test(sentence) &&
        !statesTheSentence(sentence)
    )
    .map(sentence => sentence.trim());
}

describe("docs: how SQLite is described", () => {
  it.each(PAGES)("%s states the agreed sentence and no other", file => {
    const text = read(file);
    expect(statesTheSentence(text)).toBe(true);
    expect(otherDescriptionsIn(text)).toEqual([]);
  });

  it("no docs page keeps the old wording", () => {
    const pages = docsPages();
    // Every page, not a short list: the old wording was on pages outside the
    // four above, and a new page could bring it back anywhere.
    expect(pages.length).toBeGreaterThan(100);
    expect(pages.flatMap(file => oldWordingsIn(file, read(file)))).toEqual([]);
  });

  it("would catch each old spelling", () => {
    // The patterns are the instrument, so each is shown to fire on a line a
    // page carried, and the agreed sentence is shown not to.
    for (const line of [
      "SQLite is for local demos only.",
      "| [SQLite](/docs/database/sqlite) | **Local demos only.** Not recommended for serious use",
      "MySQL, or SQLite (local demo only)",
      "Pick SQLite only for one-off local demos.",
      "on your own PostgreSQL or MySQL database, or SQLite for local work.",
      "points to a production database (not localhost / SQLite).",
    ]) {
      expect(oldWordingsIn("page.mdx", line)).toHaveLength(1);
    }
    expect(oldWordingsIn("page.mdx", `SQLite is ${SENTENCE}.`)).toEqual([]);
    // The same words about something other than SQLite are not this check's.
    expect(
      oldWordingsIn("page.mdx", "The mock mailer is for local work and demos only.")
    ).toEqual([]);
    expect(
      statesTheSentence(
        "Great on your own machine and on a single server; on Vercel, choose PostgreSQL."
      )
    ).toBe(true);
  });

  it("would catch a second description beside the agreed one", () => {
    const page = [
      `SQLite is ${SENTENCE}.`,
      "Pick SQLite only when you are trying something out locally, never in production.",
    ].join("\n");
    expect(otherDescriptionsIn(page)).toEqual([
      "Pick SQLite only when you are trying something out locally, never in production.",
    ]);
    // A technical fact about SQLite passes no verdict.
    expect(
      otherDescriptionsIn("SQLite is a local file; remote access does not exist.")
    ).toEqual([]);
  });
});
