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
  // The npm and GitHub pages people choose an adapter from.
  "README.md",
  "packages/nextly/README.md",
  "packages/adapter-sqlite/README.md",
  "packages/adapter-drizzle/README.md",
];

/** Wordings that describe SQLite as unfit for real sites, in each spelling seen. */
const OLD_WORDINGS = [
  /\bdemos? only\b/i,
  /\blocal demos?\b/i,
  /\bquick (?:demos?|experiments?)\b/i,
  /not recommended for serious/i,
  /one-off (?:local )?demos?\b/i,
  /\bfor local work\b/i,
  /\blocal only\b/i,
  /\bnot for production\b/i,
  /\bnot localhost\b.*\bsqlite\b/i,
];

/**
 * Words that pass a verdict on what a database is fit for. Plain
 * "production" is not one: "In production, SQLite runs migrations in one
 * transaction" states a fact, while "not for production" and "production-ready"
 * judge.
 */
const VERDICT =
  /\b(?:demos?|local (?:work|development|only)|serious|recommended|not suitable|single server|vercel|(?:not|never) (?:for|in) production|production[- ]ready|(?:suitable|fit|ready|good|great) for production|prototyp\w*|experiments?)\b/gi;

/** A database's name, as pages spell it in prose, code and addresses. */
const DATABASE = /(?<![a-z])(sqlite|postgres(?:ql)?|mysql|mariadb)(?![a-z])/gi;

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
  out.push("README.md", "templates/README.md");
  // The agent guides every new project is given.
  for (const guide of ["AGENTS.md.template", "CLAUDE.md.template"]) {
    if (existsSync(resolve(repoRoot, "templates/base", guide))) {
      out.push(`templates/base/${guide}`);
    }
  }
  for (const entry of readdirSync(resolve(repoRoot, "packages"), {
    withFileTypes: true,
  })) {
    const readme = resolve(repoRoot, "packages", entry.name, "README.md");
    if (entry.isDirectory() && existsSync(readme)) out.push(repoPath(readme));
  }
  // Every README a template carries, at any depth: all of it is copied into
  // the projects made from it.
  const templateReadmes = abs => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        templateReadmes(path);
      } else if (entry.name === "README.md") out.push(repoPath(path));
    }
  };
  templateReadmes(resolve(repoRoot, "templates"));
  return [...new Set(out)].sort();
}

const read = file => readFileSync(resolve(repoRoot, file), "utf-8");

/** Whether a text states the sentence, its first letter in either case. */
export const statesTheSentence = text =>
  text.toLowerCase().includes(SENTENCE.toLowerCase());

/** A text with every copy of the sentence taken out, any case. */
const withoutSentence = text =>
  text
    .split(new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))
    .join(" ");

/**
 * The lines of a page that describe SQLite in an old wording, as
 * `file:line: text`. Only a line that names SQLite counts, so another feature
 * described as "for local work" or "demos only" is left alone.
 */
export function oldWordingsIn(file, text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      /\bsqlite\b/i.test(line) &&
      OLD_WORDINGS.some(pattern => pattern.test(line))
        ? [`${file}:${String(index + 1)}: ${line.trim()}`]
        : []
    );
}

/**
 * Whether a piece of text passes a verdict on SQLite: some verdict in it sits
 * nearest to SQLite among the databases it names. "PostgreSQL (recommended
 * for production), MySQL, or SQLite" passes its verdict to PostgreSQL;
 * "SQLite adapter (not for production)" passes it to SQLite.
 */
function judgesSqlite(text) {
  const names = [...text.matchAll(DATABASE)];
  if (!names.some(name => name[1].toLowerCase() === "sqlite")) return false;
  return [...text.matchAll(VERDICT)].some(verdict => {
    const nearest = names.reduce((best, name) =>
      Math.abs(name.index - verdict.index) <
      Math.abs(best.index - verdict.index)
        ? name
        : best
    );
    return nearest[1].toLowerCase() === "sqlite";
  });
}

/**
 * The sentences of a page that describe SQLite in other words: read whole,
 * with the agreed wording taken out, they still pass a verdict on SQLite. So
 * a verdict added beside the agreed wording ("…choose PostgreSQL, and SQLite
 * is recommended for production") counts, and so does one in a table cell
 * after SQLite's, while a "recommended" column beside "One of `postgresql`,
 * `mysql`, `sqlite`" lands on PostgreSQL. A sentence ends at a full stop, a
 * question or exclamation mark, or a line break.
 */
export function otherDescriptionsIn(text) {
  const found = [];
  // The database the previous sentence or line ended on, for a verdict that
  // follows it without naming one: "SQLite. It is not for production." and a
  // list item under "- SQLite" are about SQLite.
  let carried = null;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
    const rest = withoutSentence(sentence);
    const names = [...rest.matchAll(DATABASE)];
    const verdicts = [...rest.matchAll(VERDICT)];
    // A place a fragment names ("Vercel Blob", "a single server") is too weak
    // to inherit a subject; a judging word ("not for production", "demo") is
    // not.
    const judging = verdicts.some(
      verdict => !/^(?:vercel|single server)$/i.test(verdict[0])
    );
    if (
      judgesSqlite(rest) ||
      (names.length === 0 && judging && carried === "sqlite")
    ) {
      found.push(sentence.trim());
    }
    // Only the next fragment inherits, and only when it is not blank.
    if (names.length > 0) carried = names[names.length - 1][1].toLowerCase();
    else if (sentence.trim() !== "") carried = null;
  }
  return found;
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
      expect.arrayContaining([
        "README.md",
        "packages/adapter-sqlite/README.md",
        "templates/base/AGENTS.md.template",
        // READMEs below a template's top folder ship with it too.
        "templates/blank/src/app/(frontend)/components/README.md",
        "templates/blog/src/endpoints/seed/media/README.md",
      ])
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
      "Use SQLite for quick experiments.",
      "SQLite works for a quick demo.",
      "| SQLite | Local only |",
      "SQLite adapter (not for production)",
    ]) {
      expect(oldWordingsIn("page.mdx", line)).toHaveLength(1);
    }
    expect(oldWordingsIn("page.mdx", `SQLite is ${SENTENCE}.`)).toEqual([]);
    // The same words about something other than SQLite are not this check's.
    expect(
      oldWordingsIn(
        "page.mdx",
        "The mock mailer is for local work and demos only."
      )
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
      otherDescriptionsIn(
        "SQLite is a local file; remote access does not exist."
      )
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

  it.each([
    "SQLite adapter (not for production)",
    "| [SQLite](x) | 3.38+ | Not recommended for production. |",
    "| SQLite | Local only |",
    `SQLite is ${SENTENCE} (but not in production).`,
    "Pick SQLite only when you are prototyping.",
    "- SQLite — recommended for production",
    "| @foo | SQLite | Not for production |",
    "SQLite is production-ready.",
    "SQLite is suitable for production.",
    // A verdict in the next sentence or list line, without naming SQLite.
    "SQLite. It is not for production.",
    "- SQLite\n  - Not for production",
  ])("would catch the verdict in %s", line => {
    expect(otherDescriptionsIn(line)).toHaveLength(1);
  });

  it.each([
    // A plugin's own track record, beside SQLite named as a test harness.
    "exercised it in production** (against a real database, not just the SQLite test harness).",
    // A table row about a setting, whose "recommended" column is the setting's.
    "| `DB_DIALECT`   | recommended | (auto-detected from URL) | One of `postgresql`, `mysql`, `sqlite`.",
    // A list whose "(recommended)" belongs to the PostgreSQL adapter before it.
    "- [`@nextlyhq/adapter-postgres`](https://github.com/x/adapter-postgres) (recommended), [`@nextlyhq/adapter-mysql`](https://github.com/x/adapter-mysql), [`@nextlyhq/adapter-sqlite`](https://github.com/x/adapter-sqlite): database adapters",
    // A fact about SQLite in production, which passes no verdict.
    "In production, SQLite runs migrations in one transaction.",
    // A place named after SQLite is not a verdict carried over to it.
    "PostgreSQL, MySQL, or SQLite. Local disk by default; S3, Vercel Blob, or UploadThing for storage.",
  ])("would leave %s alone", line => {
    expect(otherDescriptionsIn(line)).toEqual([]);
  });
});
