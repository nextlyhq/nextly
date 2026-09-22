/**
 * Each case is a way the local gates lose their bound, and each one reads as
 * ordinary in a diff.
 *
 * The measured event behind them: `.husky/pre-push` ran `pnpm turbo test`
 * unfiltered with no concurrency cap, turbo's default of 10 package tasks met
 * Vitest's default of one worker per core in 23 uncapped packages, and the
 * machine ran out of memory. What the kernel killed was not the build: an init
 * and a session daemon went first, taking the desktop with them.
 */
import { describe, expect, it } from "vitest";

import {
  BOUNDED_RUNNER,
  boundsProblems,
  runnerProblems,
  concurrencyExportLine,
  scriptProblems,
  turboInvocations,
} from "./check-local-gate-bounds.mjs";

/** A minimal hook that is correctly bounded, used as the control. */
const BOUNDED = [
  "#!/usr/bin/env sh",
  'TURBO_CONCURRENCY="${NEXTLY_LOCAL_CONCURRENCY:-2}"',
  "export TURBO_CONCURRENCY",
  'VITEST_WORKERS="${NEXTLY_LOCAL_MAX_WORKERS:-2}"',
  "pnpm turbo lint --continue",
  "pnpm run build",
  'pnpm turbo test --continue -- --maxWorkers="$VITEST_WORKERS"',
].join("\n");

describe("finding the commands that consume the machine", () => {
  it("sees turbo invocations and the build that wraps one", () => {
    expect(turboInvocations(BOUNDED).map(i => i.line)).toEqual([5, 6, 7]);
  });

  /*
   * The instrument must not read its own subject matter. This module's header
   * names every command it searches for, so a scanner over raw text would
   * find the prose and certify a hook on the strength of a paragraph about
   * boundedness.
   */
  it("does not mistake a comment naming a command for the command", () => {
    expect(turboInvocations("# runs pnpm turbo test --continue here")).toEqual([]);
  });
});

describe("finding where the bound is established", () => {
  it("reads the assignment-then-export spelling", () => {
    expect(concurrencyExportLine(BOUNDED)).toBe(3);
  });

  it("reads a single-line export", () => {
    expect(concurrencyExportLine("export TURBO_CONCURRENCY=2")).toBe(1);
  });

  it("reports none when the variable is only assigned, never exported", () => {
    // An unexported variable does not reach turbo's process at all, so the
    // hook reads as bounded and behaves as though it were not.
    expect(concurrencyExportLine("TURBO_CONCURRENCY=2\npnpm turbo test")).toBeNull();
  });
});

describe("judging whether the gates are bounded", () => {
  it("is silent on a correctly bounded hook", () => {
    expect(boundsProblems(BOUNDED)).toEqual([]);
  });

  /*
   * The population assertion. A scan that found no invocation reports no
   * problem, which is byte-identical to a hook that is correctly bounded — so
   * it has to refuse rather than pass.
   */
  it("refuses rather than passing when it found nothing to judge", () => {
    expect(boundsProblems("#!/usr/bin/env sh\necho hello")).toEqual([
      expect.stringContaining("NOT CHECKABLE"),
    ]);
  });

  it("names a hook that never exports the concurrency bound", () => {
    const broken = BOUNDED.split("\n").filter(l => !/export TURBO_CONCURRENCY/.test(l)).join("\n");
    expect(boundsProblems(broken)).toEqual([
      expect.stringContaining("never exported"),
    ]);
  });

  it("names a test run that does not cap Vitest workers", () => {
    const broken = BOUNDED.replace(' -- --maxWorkers="$VITEST_WORKERS"', "");
    expect(boundsProblems(broken)).toEqual([
      expect.stringContaining("--maxWorkers"),
    ]);
  });

  /*
   * Establishing a bound after the command it bounds is the same as not
   * establishing it, and it is the version that reads as correct in a diff
   * because every required line is present.
   */
  it("names a turbo run that happens before the bound is set", () => {
    const broken = [
      "pnpm turbo lint --continue",
      'TURBO_CONCURRENCY="2"',
      "export TURBO_CONCURRENCY",
      'pnpm turbo test --continue -- --maxWorkers=2',
    ].join("\n");
    expect(boundsProblems(broken)).toEqual([
      expect.stringContaining("before TURBO_CONCURRENCY is exported"),
    ]);
  });

  /*
   * The VALUE is deliberately not asserted: the hook documents an override for
   * a machine with headroom, and a check that pinned the number would report
   * the documented escape hatch as a violation.
   */
  it("accepts any bound, because the documented override raises it", () => {
    expect(boundsProblems(BOUNDED.replace("2}", "8}"))).toEqual([]);
    expect(boundsProblems(BOUNDED.replace(/\$\{NEXTLY_LOCAL_CONCURRENCY:-2\}/, "6"))).toEqual([]);
  });
});

describe("holding the root scripts to the same bound as the hook", () => {
  const bounded = {
    "verify:pr":
      "TURBO_CONCURRENCY=2 turbo run build && TURBO_CONCURRENCY=2 turbo run test -- --maxWorkers=2",
    "verify:full": "pnpm verify:pr && pnpm test:integration:sqlite",
  };

  it("is silent when both carry it", () => {
    expect(scriptProblems(bounded)).toEqual([]);
  });

  /*
   * verify:full composes verify:pr rather than running turbo itself, so
   * requiring its own bound would make the honest spelling a violation.
   */
  it("does not demand a bound from a script that only delegates", () => {
    expect(scriptProblems({ ...bounded, "verify:full": "pnpm verify:pr" })).toEqual([]);
  });

  it("names a script that runs turbo unbounded", () => {
    expect(scriptProblems({ ...bounded, "verify:pr": "turbo run build" })).toEqual([
      expect.stringContaining("without setting TURBO_CONCURRENCY"),
    ]);
  });

  it("names a script that runs tests without capping workers", () => {
    expect(
      scriptProblems({ ...bounded, "verify:pr": "TURBO_CONCURRENCY=2 turbo run test" })
    ).toEqual([expect.stringContaining("--maxWorkers")]);
  });

  /*
   * A missing entry point is not a pass. The scripts are what make the safe
   * limits the default rather than something each person remembers, so their
   * absence is the defect this check exists to stop.
   */
  it("names a bounded entry point that has gone missing", () => {
    expect(scriptProblems({ "verify:pr": bounded["verify:pr"] })).toEqual([
      expect.stringContaining("'verify:full' is missing"),
    ]);
  });
});

describe("both spellings of a turbo test invocation", () => {
  const bounded = 'TURBO_CONCURRENCY="2"\nexport TURBO_CONCURRENCY\n';

  /*
   * 🔴 `turbo run test` is the canonical spelling used throughout
   * package.json, and the narrower pattern skipped it entirely — so removing
   * --maxWorkers from that form left the check reporting clean while every
   * package spawned one Vitest worker per core.
   */
  it.each(["pnpm turbo test --continue", "pnpm turbo run test --continue"])(
    "reports '%s' when it forwards no worker cap",
    invocation => {
      expect(boundsProblems(bounded + invocation)).toEqual([
        expect.stringContaining("--maxWorkers"),
      ]);
    }
  );

  it.each([
    "pnpm turbo test --continue -- --maxWorkers=2",
    "pnpm turbo run test --continue -- --maxWorkers=2",
  ])("is silent on '%s'", invocation => {
    expect(boundsProblems(bounded + invocation)).toEqual([]);
  });
});

describe("an export that carries no value", () => {
  /*
   * 🔴 `export TURBO_CONCURRENCY` with no assignment anywhere satisfied the
   * old pattern. It exports an UNSET variable, which turbo reads as absent and
   * answers with its default of 10 — a hook that looks bounded and is not.
   */
  it("rejects a bare export with no assignment", () => {
    expect(
      boundsProblems("export TURBO_CONCURRENCY\npnpm turbo test -- --maxWorkers=2")
    ).toEqual([expect.stringContaining("never exported")]);
  });

  it("accepts an export that assigns in one statement", () => {
    expect(
      boundsProblems("export TURBO_CONCURRENCY=2\npnpm turbo test -- --maxWorkers=2")
    ).toEqual([]);
  });

  it("accepts an assignment followed by an export", () => {
    expect(
      boundsProblems('TURBO_CONCURRENCY="2"\nexport TURBO_CONCURRENCY\npnpm turbo test -- --maxWorkers=2')
    ).toEqual([]);
  });
});

describe("validating the runner the root scripts delegate to", () => {
  const sound = 'const workers = `--maxWorkers=${limits.maxWorkers}`;\nenv: { TURBO_CONCURRENCY: String(limits.concurrency) }';

  it("is silent when the runner applies both bounds", () => {
    expect(runnerProblems(sound)).toEqual([]);
  });

  /*
   * 🔴 The delegation was accepted on the strength of the filename, so the
   * runner could drop either bound and both entry points would still be
   * certified clean — a control unable to enforce the rule it names.
   */
  it("names a runner that sets no concurrency on what it spawns", () => {
    expect(runnerProblems("const workers = `--maxWorkers=2`;")).toEqual([
      expect.stringContaining("TURBO_CONCURRENCY"),
    ]);
  });

  it("names a runner that caps no workers", () => {
    expect(runnerProblems("env: { TURBO_CONCURRENCY: '2' }")).toEqual([
      expect.stringContaining("--maxWorkers"),
    ]);
  });

  it("names the runner by the path the scripts delegate to", () => {
    expect(BOUNDED_RUNNER).toBe("scripts/verify.mjs");
  });
});
