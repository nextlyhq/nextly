/**
 * Every document that states the supported Node range must state the same one.
 *
 * `package.json` holds the enforced value -- the range a package manager
 * actually refuses a checkout on -- and two guides repeat it in prose for
 * humans and agents. A guide that disagrees sends its reader to a runtime the
 * install rejects, or worse to one it accepts while the test environment does
 * not support it.
 *
 * Prose cannot be checked by a compiler or a linter: a stale requirement is
 * not malformed, it is merely untrue of another file. Comparing the copies is
 * the only thing that makes the claim falsifiable.
 *
 * This lives in the playground because the playground is why the range has the
 * shape it has: its `jsdom` is the dependency with the disjoint-major
 * constraint, so the value is not arbitrary and its reason is here.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);

const read = (file: string) => readFileSync(resolve(repoRoot, file), "utf8");

/** The enforced range: what a package manager actually refuses a checkout on. */
const ENFORCED: string = (
  JSON.parse(read("package.json")) as { engines?: { node?: string } }
).engines?.node as string;

/**
 * Documents that state the requirement in prose, and how to find it.
 *
 * Each pattern is anchored on the surrounding words rather than on the value,
 * so a document that has drifted still MATCHES and reports its stale value.
 * Matching on the expected value would make a stale document look like a
 * missing one, and the message would send a reader to add a line that is
 * already there.
 */
const DOCUMENTED: ReadonlyArray<{ file: string; pattern: RegExp }> = [
  { file: "AGENTS.md", pattern: /Requirements: Node `([^`]+)`/ },
  { file: "CONTRIBUTING.md", pattern: /Node\.js `([^`]+)`/ },
];

describe("the supported Node range", () => {
  it("is enforced somewhere, and stated in more than one document", () => {
    // Both halves can go empty and leave the rule below trivially true: an
    // engines field that was removed, or a document list nothing matches.
    expect(ENFORCED).toBeTruthy();
    expect(DOCUMENTED.length).toBeGreaterThan(1);
    for (const { file, pattern } of DOCUMENTED) {
      expect(pattern.test(read(file)), `${file} states no Node range`).toBe(
        true
      );
    }
  });

  it("is the same in every document that states it", () => {
    const disagreeing = DOCUMENTED.map(({ file, pattern }) => {
      const stated = read(file).match(pattern)?.[1];
      return { file, stated };
    }).filter(row => row.stated !== ENFORCED);

    expect(
      disagreeing.map(row => `${row.file} says "${row.stated}"`).sort(),
      `A guide states a Node range the repository does not enforce ` +
        `("${ENFORCED}"). Nothing fails at build time -- a contributor or an ` +
        `agent simply follows the document onto a runtime the install then ` +
        `refuses, or worse, one it accepts while the test environment does ` +
        `not support it.`
    ).toEqual([]);
  });
});
