/**
 * `workflowSteps` is the reader every workflow gate built on it inherits, so
 * the cases here are the ones where a reader can be wrong while looking right.
 *
 * Each of these credits a step with a script it does not run, or fails to see
 * a script at all — and each makes a gate pass over exactly what it exists to
 * catch:
 *
 * - a chunk bounded by the next `- name:` sweeps in the comment block
 *   introducing the FOLLOWING step, and workflow comments here quote commands
 *   verbatim, so a comment about step N+1 satisfies an assertion about step N;
 * - an ANONYMOUS step — a bare `-` with an indented `run:` — has no name, so a
 *   reader tracking ownership by name records its script against whichever
 *   named step came before it, and a reader that DROPS it instead cannot see
 *   the unwrapped command it runs;
 * - two steps may legitimately share a name, and a map keeps only the last;
 * - a script may be INLINE (`run: pnpm test`), which a reader matching only
 *   `run: |` never sees;
 * - `timeout-minutes` is legal on a step, and an indentation-blind matcher
 *   records a step's value as its job's ceiling.
 *
 * @module workflow-run-blocks.test
 */
import { describe, expect, it } from "vitest";

import { jobIds, jobTimeouts, workflowSteps } from "./workflow-run-blocks.mjs";

/** The script of the FIRST step with this name, or undefined. */
function blockOf(steps, name) {
  return steps.find(step => step.name === name)?.block;
}

describe("workflowSteps", () => {
  it("reads a step's run block", () => {
    const steps = workflowSteps(
      [
        "    steps:",
        "      - name: Build",
        "        run: |",
        "          pnpm build",
        "",
      ].join("\n")
    );

    expect(blockOf(steps, "Build")).toBe("          pnpm build");
  });

  it("reads an INLINE run command as well as a block scalar", () => {
    // `run: pnpm test` is as ordinary as `run: |`. A reader that saw only the
    // block form would report this step as running nothing — and a lane
    // invoked this way would be invisible to a gate scanning for bare ones.
    const steps = workflowSteps(
      ["      - name: Quick", "        run: pnpm test"].join("\n")
    );

    expect(blockOf(steps, "Quick")).toBe("pnpm test");
  });

  it("stops at `env:` rather than swallowing the keys after the script", () => {
    const steps = workflowSteps(
      [
        "      - name: Test",
        "        run: |",
        "          pnpm test",
        "        env:",
        "          TOKEN: shhh",
      ].join("\n")
    );

    expect(blockOf(steps, "Test")).toBe("          pnpm test");
    expect(blockOf(steps, "Test")).not.toContain("TOKEN");
  });

  it("does NOT let a comment introducing the next step land in this one", () => {
    const steps = workflowSteps(
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

    expect(blockOf(steps, "First")).toBe("          safe-thing");
    expect(blockOf(steps, "First")).not.toContain("dangerous-thing");
    expect(blockOf(steps, "Second")).toBe("          dangerous-thing");
  });

  it("keeps an ANONYMOUS step's script, under no name, rather than mis-crediting or dropping it", () => {
    // Both wrong answers are live. Crediting `unbounded-thing` to `Guarded`
    // makes a gate read a wrapped command on a step that runs none; dropping
    // it makes the gate unable to see the unwrapped command at all.
    const steps = workflowSteps(
      [
        "      - name: Guarded",
        "        run: |",
        "          wrapped-thing",
        "      -",
        "        run: |",
        "          unbounded-thing",
      ].join("\n")
    );

    expect(blockOf(steps, "Guarded")).toBe("          wrapped-thing");
    expect(steps).toContainEqual({ name: null, block: "          unbounded-thing" });
  });

  it("keeps a blank line inside a script from truncating it", () => {
    // A reader that ended the block at the first blank line would return a
    // PREFIX of the script — and a prefix still contains the first command, so
    // an assertion about that command passes while the rest is invisible.
    const steps = workflowSteps(
      [
        "      - name: Two parts",
        "        run: |",
        "          first",
        "",
        "          second",
      ].join("\n")
    );

    expect(blockOf(steps, "Two parts")).toContain("first");
    expect(blockOf(steps, "Two parts")).toContain("second");
  });

  it("does not treat a list nested INSIDE a step as a new step", () => {
    // The `- chromium` belongs to `with:`. Ending the step there would leave
    // the script that follows owned by nobody.
    const steps = workflowSteps(
      [
        "      - name: Install",
        "        with:",
        "          browsers:",
        "            - chromium",
        "        run: |",
        "          install-thing",
      ].join("\n")
    );

    expect(blockOf(steps, "Install")).toBe("          install-thing");
  });

  it("keeps BOTH steps when two share a name, so neither can hide the other", () => {
    // Conditional variants of one step legitimately share a name, and every job
    // repeats `Install dependencies`. A map keyed by name kept the last, which
    // let a wrapped variant hide an unwrapped one. A list cannot.
    const steps = workflowSteps(
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

    const blocks = steps.filter(s => s.name === "Run tests").map(s => s.block);
    expect(blocks).toEqual(["          bare-thing", "          wrapped-thing"]);
  });

  it("ignores a run key that no step has opened", () => {
    // A `run:` before any list item is not a step's script. Recording it would
    // invent a step the workflow does not have.
    const steps = workflowSteps(["    run: |", "      stray"].join("\n"));

    expect(steps).toEqual([]);
  });

  it("returns nothing for a file with no steps, rather than throwing", () => {
    expect(workflowSteps("name: Nothing\non: push\n")).toEqual([]);
  });
});

describe("jobIds and jobTimeouts", () => {
  const workflow = [
    "on:",
    "  push:",
    "jobs:",
    "  integration:",
    "    name: Integration",
    "    timeout-minutes: 75",
    "    steps:",
    "      - name: Install",
    "        timeout-minutes: 8",
    "        run: pnpm install",
    "  integration-sqlite:",
    "    timeout-minutes: 60",
    "  unbounded:",
    "    name: No ceiling",
    "    steps:",
    "      - name: Slow",
    "        timeout-minutes: 30",
    "        run: pnpm slow",
  ].join("\n");

  it("lists every job the workflow declares, ceiling or not", () => {
    // The population. `jobTimeouts` alone answers only about jobs that HAVE a
    // ceiling, so a job whose ceiling was deleted vanishes from that answer
    // instead of being reported.
    expect(jobIds(workflow)).toEqual([
      "integration",
      "integration-sqlite",
      "unbounded",
    ]);
  });

  it("keys each ceiling to the job that declares it", () => {
    expect([...jobTimeouts(workflow).entries()]).toEqual([
      ["integration", 75],
      ["integration-sqlite", 60],
    ]);
  });

  it("does NOT read a STEP's timeout-minutes as its job's ceiling", () => {
    // `unbounded` has no ceiling of its own; its `Slow` step has one. An
    // indentation-blind matcher would record 30 against the job, and a gate
    // would then call an unbounded job bounded.
    expect(jobTimeouts(workflow).has("unbounded")).toBe(false);
    // And the step-level 8 must not overwrite integration's own 75.
    expect(jobTimeouts(workflow).get("integration")).toBe(75);
  });

  it("does not read a two-space key from OUTSIDE jobs as a job", () => {
    // `on:` has `push:` at the same indentation as a job id.
    expect(jobIds(workflow)).not.toContain("push");
  });
});
