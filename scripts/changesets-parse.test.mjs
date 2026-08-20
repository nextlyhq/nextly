import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import parse from "@changesets/parse";
import { describe, expect, it } from "vitest";

/**
 * Every changeset must parse, because the release workflow reads them all at
 * once and one malformed file fails the whole run.
 *
 * The failure is remote from its cause in both directions, which is what makes
 * it worth a test rather than a convention. A changeset is authored at one
 * commit and read by `Version & Publish` on a LATER push to `main`, so the run
 * that goes red need not be the one that introduced the file — and nothing in
 * `lint`, `check-types` or any package's suite opens these files at all.
 *
 * 🔴 Uses the release tooling's OWN parser rather than a reader of the same
 * question. A blank line between the opening `---` and the first package, and a
 * frontmatter block that never closes, are both accepted by every Markdown tool
 * and by a human reader, and both are rejected by `@changesets/parse`. A
 * hand-rolled reader encodes whichever spellings its author thought of and
 * answers differently from the tool that actually decides.
 *
 * Both spellings have reached `main` and stopped the release train for every
 * package, with "could not parse changeset - missing or invalid frontmatter".
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changesetDir = resolve(repoRoot, ".changeset");

/** `parse` is published CJS; the namespace import carries it on `default`. */
const parseChangeset = parse.default ?? parse;

/**
 * The changeset files, which are every `.md` except the directory's own README.
 *
 * `config.json` and `pre.json` are not Markdown and are not candidates.
 */
const changesetFiles = readdirSync(changesetDir)
  .filter(name => name.endsWith(".md") && name !== "README.md")
  .sort();

describe("every changeset", () => {
  /**
   * Asserted before the verdict, and by a floor rather than by nothing.
   *
   * The check below passes on an empty list of files exactly as it passes on a
   * directory of valid ones — so a glob that stopped matching, or a directory
   * that moved, would certify the release train while reading nothing at all.
   */
  it("is discovered at all", () => {
    expect(
      changesetFiles.length,
      "changeset files found in .changeset"
    ).toBeGreaterThan(0);
  });

  it("parses with the parser the release workflow uses", () => {
    const unparseable = [];
    for (const name of changesetFiles) {
      try {
        parseChangeset(readFileSync(join(changesetDir, name), "utf8"));
      } catch (error) {
        // The message is kept whole and the file named, because the release log
        // truncates the offending content and the reader otherwise cannot tell
        // WHICH of several hundred files failed.
        unparseable.push(`${name}: ${error.message.split("\n")[0]}`);
      }
    }

    expect(
      unparseable,
      "the release workflow reads every changeset in one pass, so one of these fails the whole publish"
    ).toEqual([]);
  });
});
