/**
 * `workflowSteps` is the reader every workflow gate built on it inherits, so
 * the cases here are the ones where a reader can be wrong while looking right.
 *
 * Three of them credit a step with a script it does not run, and each makes a
 * gate pass over exactly what it exists to catch:
 *
 * - a chunk bounded by the next `- name:` sweeps in the comment block
 *   introducing the FOLLOWING step, and workflow comments here quote commands
 *   verbatim, so a comment about step N+1 satisfies an assertion about step N;
 * - an ANONYMOUS step — a bare `-` with an indented `run:` — has no name, so a
 *   reader tracking ownership by name records its script against whichever
 *   named step came before it;
 * - two steps may legitimately share a name, and a map keeps the last, so a
 *   wrapped later step hides an unwrapped earlier one.
 *
 * @module workflow-run-blocks.test
 */
import { describe, expect, it } from "vitest";

import { jobTimeouts, workflowSteps } from "./workflow-run-blocks.mjs";

describe("workflowSteps", () => {
  it("reads a step's run block", () => {
    const { blocks } = workflowSteps(
      [
        "    steps:",
        "      - name: Build",
        "        run: |",
        "          pnpm build",
        "",
      ].join("\n")
    );

    expect(blocks.get("Build")).toBe("          pnpm build");
  });

  it("stops at `env:` rather than swallowing the keys after the script", () => {
    const { blocks } = workflowSteps(
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
    const { blocks } = workflowSteps(
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

  it("does NOT credit a named step with a following ANONYMOUS step's script", () => {
    // A bare `-` is a legal step. A reader that changed owner only on `name:`
    // records `unbounded-thing` against `Guarded` — so a gate asserting that
    // `Guarded` runs a wrapped command reads one that another step runs.
    const { blocks } = workflowSteps(
      [
        "      - name: Guarded",
        "        run: |",
        "          wrapped-thing",
        "      -",
        "        run: |",
        "          unbounded-thing",
      ].join("\n")
    );

    expect(blocks.get("Guarded")).toBe("          wrapped-thing");
    expect(blocks.get("Guarded")).not.toContain("unbounded-thing");
  });

  it("keeps a blank line inside a script from truncating it", () => {
    // A reader that ended the block at the first blank line would return a
    // PREFIX of the script — and a prefix still contains the first command, so
    // an assertion about that command passes while the rest is invisible.
    const { blocks } = workflowSteps(
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

  it("does not treat a list nested INSIDE a step as a new step", () => {
    // The `- chromium` belongs to `with:`. Ending the step there would leave
    // the script that follows owned by nobody and silently unchecked.
    const { blocks } = workflowSteps(
      [
        "      - name: Install",
        "        with:",
        "          browsers:",
        "            - chromium",
        "        run: |",
        "          install-thing",
      ].join("\n")
    );

    expect(blocks.get("Install")).toBe("          install-thing");
  });

  it("reports a repeated step name instead of keeping only the last", () => {
    // Conditional variants of one step legitimately share a name. Keeping the
    // last lets a wrapped variant hide an unwrapped one, which is a gate
    // passing on the strength of the step it did not read.
    const { blocks, duplicated } = workflowSteps(
      [
        "      - name: Run tests",
        "        if: matrix.dialect == 'mysql'",
        "        run: |",
        "          bare-thing",
        "      - name: Run tests",
        "        if: matrix.dialect == 'postgres'",
        "        run: |",
        "          wrapped-thing",
      ].join("\n")
    );

    expect(duplicated).toEqual(["Run tests"]);
    // Still readable, so a caller can refuse rather than having nothing.
    expect(blocks.has("Run tests")).toBe(true);
  });

  it("reports nothing duplicated when every step name is distinct", () => {
    const { duplicated } = workflowSteps(
      ["      - name: A", "        run: |", "          a"].join("\n")
    );

    expect(duplicated).toEqual([]);
  });

  it("ignores a run block that no step owns", () => {
    const { blocks } = workflowSteps(["      - run: |", "          orphan"].join("\n"));

    // The step is anonymous, so there is no name to record it under — and
    // attributing it to whichever name came last is the defect above.
    expect([...blocks.keys()]).toEqual([]);
  });

  it("returns nothing for a file with no steps, rather than throwing", () => {
    expect([...workflowSteps("name: Nothing\non: push\n").blocks.keys()]).toEqual(
      []
    );
  });
});

describe("jobTimeouts", () => {
  const workflow = [
    "on:",
    "  push:",
    "jobs:",
    "  integration:",
    "    name: Integration",
    "    timeout-minutes: 75",
    "  integration-sqlite:",
    "    timeout-minutes: 60",
  ].join("\n");

  it("keys each ceiling to the job that declares it", () => {
    expect([...jobTimeouts(workflow).entries()]).toEqual([
      ["integration", 75],
      ["integration-sqlite", 60],
    ]);
  });

  it("omits a job that declares no ceiling, rather than inventing one", () => {
    // The absence is the finding. A reader that supplied a default would report
    // an unbounded job as bounded, which is the state a ceiling removes.
    const missing = ["jobs:", "  a:", "    timeout-minutes: 30", "  b:", "    name: B"].join(
      "\n"
    );

    expect(jobTimeouts(missing).has("b")).toBe(false);
  });

  it("does not read a two-space key from OUTSIDE jobs as a job", () => {
    // `on:` has `push:` and `pull_request:` at the same indentation as a job id.
    expect([...jobTimeouts(workflow).keys()]).not.toContain("push");
  });
});
