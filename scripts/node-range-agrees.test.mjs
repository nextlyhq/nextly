import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The supported Node range is stated in prose in more than one guide and
 * enforced in exactly one place. Nothing at build time notices when a guide
 * drifts from the enforced value: a contributor or an agent simply follows the
 * document onto a runtime the install then refuses, or onto one it accepts
 * while the test environment does not support it.
 *
 * Lives beside the other repository-wide script tests rather than inside a
 * package, because it makes a claim about the repository as a whole and no
 * feature owns it. An earlier copy sat inside a development harness and was
 * deleted along with it, which removed the check without removing the rule.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(repoRoot, file), "utf8");

/** What a package manager actually refuses a checkout on. */
const ENFORCED = JSON.parse(read("package.json")).engines?.node;

/**
 * Documents that state the requirement in prose, and how to find it.
 *
 * Each pattern is anchored on the surrounding WORDS rather than on the value,
 * so a document that has drifted still matches and reports its stale value.
 * Anchoring on the expected value would make a stale document look like a
 * missing one, and the failure would tell a reader to add a line that is
 * already there.
 */
const DOCUMENTED = [
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
    const disagreeing = DOCUMENTED.map(({ file, pattern }) => ({
      file,
      stated: read(file).match(pattern)?.[1],
    })).filter(row => row.stated !== ENFORCED);

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
