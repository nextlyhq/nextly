/**
 * `runBlocks` is the reader every workflow gate built on it inherits, so the
 * cases here are the ones where a reader can be wrong while looking right.
 *
 * The load-bearing one is the boundary. A reader that took each step's text as
 * "everything up to the next `- name:`" would sweep in the comment block that
 * introduces the FOLLOWING step — and workflow comments in this repository
 * quote commands verbatim, so a comment about step N+1 would satisfy an
 * assertion about step N. `ci-steps-report-independently.test.mjs` records
 * making exactly that mistake, which is why it is pinned here rather than
 * trusted.
 *
 * @module workflow-run-blocks.test
 */
import { describe, expect, it } from "vitest";

import { runBlocks } from "./workflow-run-blocks.mjs";

describe("runBlocks", () => {
  it("reads a step's run block", () => {
    const blocks = runBlocks(
      ["    steps:", "      - name: Build", "        run: |", "          pnpm build", ""].join("\n")
    );

    expect(blocks.get("Build")).toBe("          pnpm build");
  });

  it("stops at `env:` rather than swallowing the keys after the script", () => {
    const blocks = runBlocks(
      [
        "      - name: Test",
        "        run: |",
        "          pnpm test",
        "        env:",
        "          TOKEN: shhh",
      ].join("\n")
    );

    expect(blocks.get("Test")).toBe("          pnpm test");
    expect(blocks.get("Test")).not.toContain("TOKEN");
  });

  it("does NOT let a comment introducing the next step land in this one", () => {
    // The defect this reader exists to avoid: the comment below belongs to
    // `Second`, and it names a command. A chunk bounded by the next `- name:`
    // would put it inside `First`, and an assertion that `First` runs
    // `dangerous-thing` would pass on a step that does no such thing.
    const blocks = runBlocks(
      [
        "      - name: First",
        "        run: |",
        "          safe-thing",
        "",
        "      # This step runs `dangerous-thing` because of a long reason.",
        "      - name: Second",
        "        run: |",
        "          dangerous-thing",
      ].join("\n")
    );

    expect(blocks.get("First")).toBe("          safe-thing");
    expect(blocks.get("First")).not.toContain("dangerous-thing");
    expect(blocks.get("Second")).toBe("          dangerous-thing");
  });

  it("keeps a blank line inside a script from truncating it", () => {
    // A reader that ended the block at the first blank line would return a
    // PREFIX of the script — and a prefix still contains the first command, so
    // an assertion about that command passes while the rest is invisible.
    const blocks = runBlocks(
      [
        "      - name: Two parts",
        "        run: |",
        "          first",
        "",
        "          second",
      ].join("\n")
    );

    expect(blocks.get("Two parts")).toContain("first");
    expect(blocks.get("Two parts")).toContain("second");
  });

  it("ignores a run block that no named step owns", () => {
    // Anonymous steps are legal. Attributing one to whatever name came last
    // would credit a step with a script it does not run.
    const blocks = runBlocks(["      - run: |", "          orphan"].join("\n"));

    expect([...blocks.keys()]).toEqual([]);
  });

  it("returns nothing for a file with no steps, rather than throwing", () => {
    expect([...runBlocks("name: Nothing\non: push\n").keys()]).toEqual([]);
  });
});
