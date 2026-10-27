import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The Next.js and React versions Nextly supports are stated on one docs page,
 * and every other page, package README and agent skill links there. Two copies
 * of a version range drift apart the first time only one of them is updated,
 * and a page still naming a dropped major tells a reader it works. These tests
 * hold the statement to one page and keep the dropped majors out of everything
 * a reader or an agent is pointed at.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The page that states the supported versions. */
const CANONICAL = "docs/getting-started/installation.mdx";
const NEXT_RANGE = "`^16.4.1`";
const REACT_RANGE = "`^19.3.0`";
/** Any spelling of either range's version, so a restatement without backticks is caught too. */
const RANGE_VERSION = /16\.4\.1|19\.3\.0/;

/** Every file under `dir` (relative to the repository root) whose name passes `keep`. */
function filesUnder(dir, keep) {
  const out = [];
  const walk = abs => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (keep(entry.name)) out.push(relative(repoRoot, path));
    }
  };
  walk(resolve(repoRoot, dir));
  return out.sort();
}

const isDoc = name => /\.mdx?$/.test(name);
const docsPages = () => filesUnder("docs", isDoc);
const packageReadmes = () =>
  readdirSync(resolve(repoRoot, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join("packages", entry.name, "README.md"))
    .filter(file => {
      try {
        readFileSync(resolve(repoRoot, file));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
const skillFiles = () => filesUnder(".agents/skills", isDoc);

const read = file => readFileSync(resolve(repoRoot, file), "utf8");

/**
 * Ways of naming Next.js 15 or React 18. Bare numbers are only read on a line
 * that mentions Next or React, so `2^15`, PostgreSQL 15 or a port number are
 * not mistaken for one.
 */
const OLD_MAJOR_ANYWHERE = [
  /\bNext(?:\.js)?\s+v?15\b/,
  /\bReact(?:\s+DOM)?\s+v?18\b/i,
  /\bnext@[\^~>=]*15\b/i,
  /\breact(?:-dom)?@[\^~>=]*18\b/i,
];
const MENTIONS_NEXT_OR_REACT = /\b(?:next|react)/i;
const OLD_MAJOR_ON_A_NEXT_OR_REACT_LINE = [
  // A caret, tilde or lower-bound range on the dropped major: `^15.5.28`, `^18`, `>=18.0.0`.
  /(?<![\w.^])(?:\^|~|>=?\s*)(?:15|18)(?![\d])/,
  // A list of majors that includes a dropped one: "18 or 19", "15.5+ and 16".
  /(?<![\w.^])(?:15|18)(?:\.[\dx]+)*\+?\s+(?:or|and|to|\|\|)\s+v?(?:16|19)\b/,
];

/** The lines of `text` that name Next.js 15 or React 18. */
function oldMajorMentions(text) {
  return text
    .split("\n")
    .filter(
      line =>
        OLD_MAJOR_ANYWHERE.some(pattern => pattern.test(line)) ||
        (MENTIONS_NEXT_OR_REACT.test(line) &&
          OLD_MAJOR_ON_A_NEXT_OR_REACT_LINE.some(pattern => pattern.test(line)))
    );
}

describe("supported Next.js and React versions", () => {
  it("are stated on exactly one docs page", () => {
    const pages = docsPages();
    // An empty walk would find no restatements and pass; a known page in the
    // list proves the walk reached the docs.
    expect(pages).toContain(CANONICAL);
    const stating = pages.filter(page => RANGE_VERSION.test(read(page)));
    expect(
      stating,
      "the supported versions belong on one page; link to it instead of restating them"
    ).toEqual([CANONICAL]);
    const canonical = read(CANONICAL);
    expect(canonical).toContain(NEXT_RANGE);
    expect(canonical).toContain(REACT_RANGE);
  });

  it("finds a restatement on a second page", () => {
    // The check above in miniature, against a stand-in for a second page.
    const restated = "Nextly needs Next.js 16.4.1 or newer.";
    expect(RANGE_VERSION.test(restated)).toBe(true);
    expect(RANGE_VERSION.test("Next.js 16.4 turns Cache Components on.")).toBe(
      false
    );
  });

  it("names neither Next.js 15 nor React 18 in docs, READMEs or skills", () => {
    const files = [...docsPages(), "README.md", ...packageReadmes(), ...skillFiles()];
    expect(files).toContain("packages/nextly/README.md");
    expect(files.some(file => file.startsWith(".agents/skills/"))).toBe(true);
    const found = files.flatMap(file =>
      oldMajorMentions(read(file)).map(line => `${file}: ${line.trim()}`)
    );
    expect(found, "Next.js 15 and React 18 are not supported").toEqual([]);
  });

  // The repository README is the first page most readers and coding agents
  // see. Its Next.js and React rows link to the one place rather than copy a
  // range that would drift from it.
  it("has the root README's Next.js and React rows link to that place and name no version", () => {
    const rows = read("README.md")
      .split("\n")
      .filter(line => /^\|\s*(Next\.js|React)\s*\|/.test(line));
    expect(rows.map(row => row.split("|")[1].trim())).toEqual(["Next.js", "React"]);
    for (const row of rows) {
      expect(row).toContain("nextlyhq.com/docs/getting-started/installation#requirements");
      expect(row.split("|")[2]).not.toMatch(/\d/);
    }
  });

  it("recognises the ways a page names a dropped major", () => {
    for (const sentence of [
      "Nextly supports Next.js 15 and 16.",
      "Works on Next 15.5 with the App Router.",
      "Requires React 18 or newer.",
      "React DOM 18 works too.",
      "Install next@15 alongside it.",
      "pnpm add react@^18.3.1",
      "| `next` | ^15.5.28 or ^16.4.1 |",
      "| `react` | ^18 or ^19 |",
      "| React | 18 or 19 |",
      "Works across the supported Next range (`^15.5.28 || ^16.4.1`).",
      "react: >=18.0.0",
    ]) {
      expect(oldMajorMentions(sentence), sentence).toEqual([sentence]);
    }
  });

  it("leaves other versions alone", () => {
    for (const sentence of [
      "| Next.js | `^16.4.1`: 16.4.1 or any later 16.x release |",
      "| React and React DOM | `^19.3.0` |",
      "Minimum version: PostgreSQL 15.0.",
      "scrypt at N = 2^15, r = 8, p = 3",
      "The next 15 lines explain it.",
      "React 19 renders it; Next.js 16.4 builds it.",
    ]) {
      expect(oldMajorMentions(sentence), sentence).toEqual([]);
    }
  });
});
