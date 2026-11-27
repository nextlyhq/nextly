import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The docs describe SQLite in one sentence, the one the installer uses:
 * great on your own machine and on a single server, and PostgreSQL on
 * Vercel, where a function's disk does not last. Earlier pages called it
 * "for local demos only", which told people a database the installer picks by
 * default was not fit for the single-server site it serves well. These tests
 * keep the sentence on the pages people read first and the old wording out of
 * every page.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The agreed description, as it reads inside a sentence. */
const SENTENCE =
  "great on your own machine and on a single server; on Vercel, choose PostgreSQL";

/** The pages that describe SQLite to someone choosing a database. */
const PAGES = [
  "docs/database/index.mdx",
  "docs/database/sqlite.mdx",
  "docs/getting-started/installation.mdx",
  "docs/getting-started/quick-start.mdx",
];

/** What the docs said before, in each spelling a page used. */
const OLD_WORDINGS = [
  /\bdemos? only\b/i,
  /not recommended for serious/i,
  /one-off (?:local )?demos?\b/i,
];

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

/** Whether a page states the sentence, its first letter in either case. */
export const statesTheSentence = text =>
  text.toLowerCase().includes(SENTENCE.toLowerCase());

/** The lines of a page that use an old wording, as `file:line: text`. */
export function oldWordingsIn(file, text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      OLD_WORDINGS.some(pattern => pattern.test(line))
        ? [`${file}:${String(index + 1)}: ${line.trim()}`]
        : []
    );
}

describe("docs: how SQLite is described", () => {
  it.each(PAGES)("%s states the agreed sentence", file => {
    expect(statesTheSentence(read(file))).toBe(true);
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
    // page really carried, and the agreed sentence is shown not to.
    for (const line of [
      "SQLite is for local demos only.",
      "| **Local demos only.** Not recommended for serious local development",
      "MySQL, or SQLite (local demo only)",
      "Pick SQLite only for one-off local demos.",
    ]) {
      expect(oldWordingsIn("page.mdx", line)).toHaveLength(1);
    }
    expect(oldWordingsIn("page.mdx", `SQLite is ${SENTENCE}.`)).toEqual([]);
    expect(statesTheSentence(`Great on your own machine and on a single server; on Vercel, choose PostgreSQL.`)).toBe(true);
  });
});
