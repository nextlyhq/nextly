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
  HEAVY_SCRIPTS,
  boundsProblems,
  handoverProblems,
  heavyScriptProblems,
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

  /*
   * 🔴 Grepping the source for one `--maxWorkers=` was the first version, and
   * one occurrence anywhere satisfied it — so a SECOND test phase could run
   * uncapped while the runner reported the smaller derived number. Given the
   * phases, each one that runs tests is judged on its own.
   */
  it("names the uncapped phase when another phase is capped", () => {
    const phases = [
      { name: "unit tests", argv: ["turbo", "run", "test", "--", "--maxWorkers=2"] },
      { name: "script tests", argv: ["run", "test:scripts"] },
    ];
    expect(runnerProblems(sound, phases)).toEqual([
      expect.stringContaining("'script tests'"),
    ]);
  });

  /*
   * 🔴 Matching a standalone `test` token alone skipped the phase that invokes
   * vitest DIRECTLY — `exec vitest run --dir scripts` contains no such token,
   * so the one phase whose cap is not carried by turbo was the one phase never
   * checked. Removing its cap reported zero problems.
   */
  it("checks a phase that names vitest directly, not only a test task", () => {
    const phases = [
      { name: "script tests", argv: ["exec", "vitest", "run", "--dir", "scripts"] },
    ];
    expect(runnerProblems(sound, phases)).toEqual([
      expect.stringContaining("'script tests'"),
    ]);
  });

  /*
   * A guard its subject's PROSE can satisfy is checking the wrong thing: this
   * module's own header names the variable, and so does the runner's.
   */
  it("does not accept a concurrency bound that exists only in a comment", () => {
    expect(runnerProblems("// sets TURBO_CONCURRENCY: somewhere\nconst x = 1;", [])).toEqual([
      expect.stringContaining("TURBO_CONCURRENCY"),
    ]);
  });

  it("is silent when every test phase carries a cap", () => {
    const phases = [
      { name: "unit tests", argv: ["turbo", "run", "test", "--", "--maxWorkers=2"] },
      { name: "script tests", argv: ["exec", "vitest", "run", "--dir", "scripts", "--maxWorkers=2"] },
      { name: "build", argv: ["turbo", "run", "build"] },
    ];
    expect(runnerProblems(sound, phases)).toEqual([]);
  });

  it("names the runner by the path the scripts delegate to", () => {
    expect(BOUNDED_RUNNER).toBe("scripts/verify.mjs");
  });
});

describe("handing the hook's gates to the bounded runner", () => {
  /** The control: the hand-over first, then the gates. */
  const handedOver = [
    "#!/usr/bin/env sh",
    'if [ -z "$NEXTLY_BOUNDED" ]; then',
    '  exec node scripts/bounded.mjs sh -e .husky/pre-push "$@"',
    "fi",
    ...BOUNDED.split("\n").slice(1),
  ].join("\n");

  it("is silent when every gate runs after the hand-over", () => {
    expect(handoverProblems(handedOver)).toEqual([]);
  });

  it("names a hook that never hands over, which takes no heavy slot", () => {
    expect(handoverProblems(BOUNDED)).toEqual([expect.stringContaining("never hands its gates")]);
  });

  /*
   * A gate above the hand-over runs in the first pass, before the slot is
   * taken or the group exists — bounded in name only, and every other line of
   * the hook still reads correctly.
   */
  it("names a gate that runs before the hand-over", () => {
    const early = handedOver.replace("#!/usr/bin/env sh", "#!/usr/bin/env sh\npnpm turbo lint --continue");
    expect(handoverProblems(early)).toEqual([expect.stringContaining(":2: runs turbo before handing over")]);
  });

  it("does not accept a hand-over that exists only in a comment", () => {
    const commented = handedOver.replace("  exec node", "  # exec node");
    expect(handoverProblems(commented)).toEqual([expect.stringContaining("never hands its gates")]);
  });
});

describe("holding the heavy root scripts to the bounded runner", () => {
  /** The control: every heavy script through the runner, tests with the cap. */
  const heavy = Object.fromEntries(
    HEAVY_SCRIPTS.map(name => [
      name,
      name.startsWith("test")
        ? "node scripts/bounded.mjs --vitest-workers turbo run test"
        : "node scripts/bounded.mjs turbo run build",
    ])
  );

  it("is silent when every heavy script runs through it", () => {
    expect(heavyScriptProblems(heavy)).toEqual([]);
  });

  /*
   * 🔴 The shape this list exists for: `pnpm lint` as a bare `turbo run lint`
   * is ten eslint processes at about 1.9 GiB each, and it is the command the
   * agent guide tells every agent to run.
   */
  it("names a heavy script that runs turbo directly", () => {
    expect(heavyScriptProblems({ ...heavy, lint: "turbo run lint" })).toEqual([
      expect.stringContaining("'lint' runs heavy work without scripts/bounded.mjs"),
    ]);
  });

  it("names a test script that runs through it without the worker cap", () => {
    expect(heavyScriptProblems({ ...heavy, test: "node scripts/bounded.mjs turbo run test" })).toEqual([
      expect.stringContaining("'test' runs tests without --vitest-workers"),
    ]);
    expect(
      heavyScriptProblems({ ...heavy, "test:scripts": "node scripts/bounded.mjs vitest run --dir scripts" })
    ).toEqual([expect.stringContaining("'test:scripts' runs tests without --vitest-workers")]);
  });

  /*
   * Starting with the runner is not the same as running inside it: the shell
   * runs whatever follows `&&`, `;` or `|` as a second command, outside the
   * slot and the bounds.
   */
  it.each([
    "node scripts/bounded.mjs turbo run lint && turbo run build",
    "node scripts/bounded.mjs true; turbo run build",
    "node scripts/bounded.mjs turbo run lint | tee out.log",
    "node scripts/bounded.mjs $(echo turbo) run build",
  ])("rejects a second command composed after the runner: %s", body => {
    expect(heavyScriptProblems({ ...heavy, build: body })).toEqual([
      expect.stringContaining("'build' runs a second command after scripts/bounded.mjs"),
    ]);
  });

  /*
   * The runner reads `--vitest-workers` only as its first argument; anywhere
   * else it is passed to turbo, and a bare `--maxWorkers` before `--` is
   * turbo's own flag, not Vitest's.
   */
  it.each([
    "node scripts/bounded.mjs turbo run test --vitest-workers",
    "node scripts/bounded.mjs turbo run test --maxWorkers=2",
  ])("rejects a worker cap in a position the runner does not read: %s", body => {
    expect(heavyScriptProblems({ ...heavy, test: body })).toEqual([
      expect.stringContaining("'test' runs tests without --vitest-workers straight after"),
    ]);
  });

  it("reads a script that sets its database URL before the command", () => {
    const leg = "TEST_MYSQL_URL=mysql://root:root@localhost:3307/x node scripts/bounded.mjs --vitest-workers turbo run test:integration";
    expect(heavyScriptProblems({ ...heavy, "test:integration:mysql": leg })).toEqual([]);
  });

  /*
   * Named anywhere but as the command, the runner bounds nothing: here turbo
   * runs unbounded after an echo that mentions it.
   */
  it("does not accept the runner named anywhere but as the command", () => {
    expect(
      heavyScriptProblems({ ...heavy, build: "echo node scripts/bounded.mjs && turbo run build" })
    ).toEqual([expect.stringContaining("'build' runs heavy work without")]);
  });

  it("holds the verify entry points to it too, which is what gives them the slot", () => {
    expect(heavyScriptProblems({ ...heavy, "verify:pr": "node scripts/verify.mjs pr" })).toEqual([
      expect.stringContaining("'verify:pr' runs heavy work without"),
    ]);
  });

  it("names a heavy script that has gone missing rather than passing it", () => {
    const { lint: _lint, ...rest } = heavy;
    expect(heavyScriptProblems(rest)).toEqual([expect.stringContaining("'lint' is missing")]);
  });
});
