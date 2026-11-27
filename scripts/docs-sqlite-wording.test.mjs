import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The docs describe SQLite in one agreed sentence: great on your own machine
 * and on a single server, and PostgreSQL on Vercel, where a function's disk
 * does not last. Calling it "for local demos only" tells people that the
 * database a new project starts on is not fit for the single-server site it
 * serves well. These tests keep the sentence on the pages people choose a
 * database from, and keep any other verdict and the old wording out of every
 * docs page and every published README.
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
  /\blocal demos?\b/i,
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

/** A repository-relative path, with forward slashes whatever the platform spells. */
const repoPath = abs => relative(repoRoot, abs).split("\\").join("/");

/**
 * Everything a reader is shown about SQLite: every docs page, the root README,
 * and the README of every package and template, which npm and GitHub show
 * before any docs page.
 */
function readerPages() {
  const out = [];
  const walk = abs => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mdx?$/.test(entry.name)) out.push(repoPath(path));
    }
  };
  walk(resolve(repoRoot, "docs"));
  out.push("README.md");
  for (const base of ["packages", "templates"]) {
    for (const entry of readdirSync(resolve(repoRoot, base), { withFileTypes: true })) {
      const readme = resolve(repoRoot, base, entry.name, "README.md");
      if (entry.isDirectory() && existsSync(readme)) out.push(repoPath(readme));
    }
  }
  return out.sort();
}

const read = file => readFileSync(resolve(repoRoot, file), "utf-8");

/** Whether a text states the sentence, its first letter in either case. */
export const statesTheSentence = text =>
  text.toLowerCase().includes(SENTENCE.toLowerCase());

/** A text with every copy of the sentence taken out, any case. */
const withoutSentence = text =>
  text.split(new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");

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

/** Whether a piece of text names SQLite with a verdict. */
const judgesSqlite = text => /\bsqlite\b/i.test(text) && VERDICT.test(text);

/**
 * The sentences of a page that describe SQLite in other words. Each sentence
 * is read with the agreed wording taken out, one clause at a time, and counts
 * when a clause names SQLite with a verdict. So a verdict added beside the
 * agreed wording ("…choose PostgreSQL, and SQLite is recommended for
 * production") counts, while a verdict about something else in the same
 * sentence does not: a parenthesis ("PostgreSQL (recommended for
 * production), MySQL, or SQLite"), another table cell, or the clause after a
 * semicolon or a dash. A sentence ends at a full stop, a question or
 * exclamation mark, or a line break; commas do not end a clause, so "Pick
 * SQLite only locally, never in production" is read whole.
 */
export function otherDescriptionsIn(text) {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter(sentence => withoutSentence(sentence).split(/[;()|]|--|—/).some(judgesSqlite))
    .map(sentence => sentence.trim());
}

describe("docs: how SQLite is described", () => {
  it.each(PAGES)("%s states the agreed sentence and no other", file => {
    const text = read(file);
    expect(statesTheSentence(text)).toBe(true);
    expect(otherDescriptionsIn(text)).toEqual([]);
  });

  it("no docs page or README keeps the old wording", () => {
    const pages = readerPages();
    // Every page and README, not a short list: the old wording was on pages
    // outside the list above, and a new page could bring it back anywhere.
    expect(pages.length).toBeGreaterThan(100);
    expect(pages).toEqual(
      expect.arrayContaining(["README.md", "packages/adapter-sqlite/README.md"])
    );
    expect(pages.flatMap(file => oldWordingsIn(file, read(file)))).toEqual([]);
  });

  it("no docs page or README describes SQLite in other words", () => {
    // Derived from every page and README rather than a list, so a page that
    // starts describing SQLite is held to the sentence the day it does.
    expect(
      readerPages().flatMap(file =>
        otherDescriptionsIn(read(file)).map(sentence => `${file}: ${sentence}`)
      )
    ).toEqual([]);
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
      "pnpm add @nextlyhq/adapter-sqlite better-sqlite3     # SQLite (local demos)",
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

  it("would catch a verdict added inside the agreed sentence", () => {
    const added = `SQLite is ${SENTENCE}, and SQLite is recommended for production.`;
    expect(otherDescriptionsIn(added)).toEqual([added]);
    // A clause about another database beside the agreed wording is not one.
    expect(
      otherDescriptionsIn(
        `PostgreSQL (recommended for production), MySQL, or SQLite (${SENTENCE})`
      )
    ).toEqual([]);
  });
});
