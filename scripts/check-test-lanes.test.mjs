import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  commandCoverage,
  fileArguments,
  filtersIn,
  joinContinuations,
  laneDrift,
  locationMatches,
  packagesWithTask,
  readWorkspace,
  selectedPackages,
  shellStatements,
  staticallyDisabled,
  taskInvocations,
  workflowSteps,
  workspaceManifests,
} from "./check-test-lanes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = (name, extra = {}) =>
  JSON.stringify({ name, scripts: { build: "tsup", ...extra } });

describe("workflowSteps", () => {
  it("keeps a literal block's lines as separate commands", () => {
    const workflow = [
      "      - name: Two things",
      "        run: |",
      "          pnpm turbo build --filter=nextly",
      "          pnpm turbo test --filter=nextly",
      "        env:",
      "          TURBO_CACHE_DIR: .turbo",
    ].join("\n");

    expect(workflowSteps(workflow)[0].commands).toEqual([
      "pnpm turbo build --filter=nextly",
      "pnpm turbo test --filter=nextly",
    ]);
  });

  it("folds a folded block into one command", () => {
    // 🔴 The distinction decides what a command IS. The unit step spells its
    // `turbo test` and twenty filters this way, and reading the lines apart
    // leaves a `turbo test` selecting nobody and twenty flags running nothing.
    const workflow = [
      "      - name: Test",
      "        run: >-",
      "          pnpm turbo test",
      "          --filter=@scope/a",
      "          --filter=@scope/b",
    ].join("\n");

    expect(workflowSteps(workflow)[0].commands).toEqual([
      "pnpm turbo test --filter=@scope/a --filter=@scope/b",
    ]);
  });

  it("joins a shell line continuation into one command", () => {
    const workflow = [
      "      - name: Named files",
      "        run: |",
      "          pnpm --filter nextly exec vitest run \\",
      "            src/a.test.ts \\",
      "            src/b.test.ts",
    ].join("\n");

    expect(workflowSteps(workflow)[0].commands).toEqual([
      "pnpm --filter nextly exec vitest run src/a.test.ts src/b.test.ts",
    ]);
  });

  it("keeps the condition with the step it guards", () => {
    const workflow = [
      "      - name: Run integration tests (mysql)",
      "        if: matrix.dialect == 'mysql'",
      "        run: pnpm turbo test:integration --filter=nextly",
    ].join("\n");

    expect(workflowSteps(workflow)[0].condition).toBe(
      "matrix.dialect == 'mysql'"
    );
  });

  it("does not read the prose that explains the workflow", () => {
    const workflow = [
      "      # The others would run pnpm turbo test --filter=@scope/a twice.",
      "      - name: Something",
      "        run: pnpm turbo test --filter=nextly",
    ].join("\n");

    expect(workflowSteps(workflow).flatMap(s => s.commands)).toEqual([
      "pnpm turbo test --filter=nextly",
    ]);
  });
});

describe("joinContinuations", () => {
  it("returns a line with no continuation unchanged", () => {
    expect(joinContinuations(["a b", "c d"])).toEqual(["a b", "c d"]);
  });

  it("joins across several continuations", () => {
    expect(joinContinuations(["a \\", "b \\", "c"])).toEqual(["a b c"]);
  });
});

describe("filtersIn", () => {
  it("reads every spelling the workflows use", () => {
    expect(
      filtersIn("pnpm turbo test --filter=@scope/a --filter b --filter 'c'")
    ).toEqual({ names: ["@scope/a", "b", "c"], locations: [] });
  });

  it("keeps a location whole, for the tree to resolve", () => {
    expect(filtersIn("pnpm turbo test --filter='./packages/*'")).toEqual({
      names: [],
      locations: ["./packages/*"],
    });
  });

  it("drops a name pattern it cannot enumerate", () => {
    // 🔴 A NAME glob selects a set this cannot resolve without knowing which
    // names exist. Guessing would report coverage that may not exist, which is
    // the direction that costs most.
    expect(filtersIn("pnpm exec publint --filter '@nextlyhq/*'")).toEqual({
      names: [],
      locations: [],
    });
  });
});

describe("locationMatches", () => {
  it("matches one segment per star", () => {
    expect(locationMatches("./packages/*", "packages/nextly")).toBe(true);
    expect(locationMatches("./packages/*", "apps/playground")).toBe(false);
  });

  it("does not let a star cross a separator", () => {
    // Otherwise `./packages/*` would claim a nested workspace it never selects.
    expect(locationMatches("./packages/*", "packages/a/b")).toBe(false);
  });

  it("matches a literal directory", () => {
    expect(locationMatches("./e2e", "e2e")).toBe(true);
    expect(locationMatches("./e2e", "e2e-helpers")).toBe(false);
  });

  it("matches nothing for a pattern it cannot answer", () => {
    // 🔴 Fails the LOUD way. An unmatched package is reported as unrun; a
    // guessed match would credit coverage nobody is getting.
    expect(locationMatches("./packages/**", "packages/a")).toBe(false);
  });
});

describe("fileArguments", () => {
  it("finds a path argument", () => {
    expect(fileArguments(" src/a.test.ts")).toEqual(["src/a.test.ts"]);
  });

  it("finds a file after a boolean option", () => {
    // 🔴 The mistake this replaced consumed the token after ANY option, so
    // `--passWithNoTests src/a.test.ts` read as a whole-suite run and a partial
    // run counted as the package's task — the exact shape this check exists to
    // refuse.
    expect(fileArguments(" --passWithNoTests src/a.test.ts")).toEqual([
      "src/a.test.ts",
    ]);
  });

  it("does not mistake an option's value for a file", () => {
    expect(fileArguments(" --config vitest.config.ts")).toEqual([]);
    expect(fileArguments(" --reporter=verbose")).toEqual([]);
  });

  it("finds a test file that names itself without a separator", () => {
    expect(fileArguments(" smoke.test.ts")).toEqual(["smoke.test.ts"]);
  });
});

describe("shellStatements", () => {
  it("splits a chain into its own commands", () => {
    expect(shellStatements("a --filter=x && b --filter=y")).toEqual([
      "a --filter=x",
      "b --filter=y",
    ]);
  });

  it("does not split inside quotes", () => {
    expect(shellStatements("a --filter='./packages/*'")).toEqual([
      "a --filter='./packages/*'",
    ]);
  });
});

describe("commandCoverage", () => {
  it("counts a turbo run of the task", () => {
    expect(commandCoverage("pnpm turbo test --filter=nextly", "test")).toEqual({
      names: ["nextly"],
      locations: [],
    });
  });

  it("does not let `test` swallow `test:integration`", () => {
    expect(
      commandCoverage("pnpm turbo test:integration --filter=nextly", "test")
    ).toBeNull();
  });

  it("counts a bare vitest run, which runs the whole suite", () => {
    expect(
      commandCoverage("pnpm --filter playground exec vitest run", "test")
    ).toEqual({ names: ["playground"], locations: [] });
  });

  it("does not count a run of named files hidden behind an option", () => {
    // 🔴 The negative control for the option-arity mistake. A boolean option
    // before the paths must not turn a partial run into the package's task:
    // that is the same silent gap as counting twelve of 907 files, reached by
    // a different route.
    expect(
      commandCoverage(
        "pnpm --filter nextly exec vitest run --passWithNoTests src/a.test.ts",
        "test"
      )
    ).toBeNull();
  });

  it("does not count a run of named files", () => {
    // 🔴 The subtlety that hid the gap: two ci.yml steps run twelve `nextly`
    // files by name, 1.3% of its suite. Counting that as the task is why the
    // package looked present in the workflow while 895 files ran nowhere.
    expect(
      commandCoverage(
        "pnpm --filter nextly exec vitest run src/a.test.ts src/b.test.ts",
        "test"
      )
    ).toBeNull();
  });

  it("does not count a run scoped to a directory", () => {
    expect(
      commandCoverage("pnpm exec vitest run --dir scripts", "test")
    ).toBeNull();
  });
});

describe("packagesWithTask", () => {
  const files = {
    "packages/a/package.json": manifest("@scope/a", { test: "vitest run" }),
    "packages/b/package.json": manifest("@scope/b"),
    "packages/c/package.json": "{ not json",
  };

  it("names only the packages that declare the task", () => {
    expect(
      packagesWithTask(path => files[path], Object.keys(files), "test")
    ).toEqual(["@scope/a"]);
  });

  it("skips a manifest it cannot read rather than throwing", () => {
    expect(() =>
      packagesWithTask(path => files[path], Object.keys(files), "test")
    ).not.toThrow();
  });
});

describe("staticallyDisabled", () => {
  it("is true only for a literal false", () => {
    expect(staticallyDisabled("false")).toBe(true);
    expect(staticallyDisabled("${{ false }}")).toBe(true);
  });

  it("leaves a condition the run decides alone", () => {
    // 🔴 A matrix condition SELECTS a leg rather than disabling one. Reading it
    // as disabled would report the postgres and mysql legs as covering nothing.
    expect(staticallyDisabled("matrix.dialect == 'mysql'")).toBe(false);
    expect(staticallyDisabled("success()")).toBe(false);
    expect(staticallyDisabled(undefined)).toBe(false);
  });
});

describe("taskInvocations", () => {
  it("does not count a step that cannot run", () => {
    const workflow = [
      "      - name: Test",
      "        if: ${{ false }}",
      "        run: pnpm turbo test --filter=nextly",
    ].join("\n");

    expect(taskInvocations(workflow, "test")).toEqual([]);
  });

  it("does not count an invocation that was commented out", () => {
    const workflow = [
      "      - name: Test",
      "        run: |",
      "          # pnpm turbo test --filter=nextly",
    ].join("\n");

    expect(taskInvocations(workflow, "test")).toEqual([]);
  });

  it("stops at a trailing comment, with or without a space after the hash", () => {
    const workflow = [
      "      - name: Test",
      "        run: |",
      "          pnpm turbo test --filter=nextly #--filter=@scope/a",
    ].join("\n");

    expect(taskInvocations(workflow, "test")).toEqual([
      {
        line: "pnpm turbo test --filter=nextly",
        filters: { names: ["nextly"], locations: [] },
      },
    ]);
  });

  it("credits a filter only to the command it was written on", () => {
    // 🔴 A `--filter` belongs to its own invocation. Reading the whole shell
    // line would credit `turbo test` with what the `turbo build` beside it
    // selects, so `@scope/b`'s suites would run nowhere while the lane
    // reported them covered.
    const workflow = [
      "      - name: Test",
      "        run: |",
      "          pnpm turbo test --filter=@scope/a && pnpm turbo build --filter=@scope/b",
    ].join("\n");

    expect(taskInvocations(workflow, "test")).toEqual([
      {
        line: "pnpm turbo test --filter=@scope/a",
        filters: { names: ["@scope/a"], locations: [] },
      },
    ]);
  });
});

describe("laneDrift", () => {
  const selection = (covered, named = covered) => ({ covered, named });

  it("reports a package no command runs", () => {
    expect(laneDrift(["a", "b"], selection(["a"]))).toEqual({
      unrun: ["b"],
      stale: [],
    });
  });

  it("reports a filter for a package that has no such task", () => {
    expect(laneDrift(["a"], selection(["a", "gone"]))).toEqual({
      unrun: [],
      stale: ["gone"],
    });
  });

  it("does not call a location stale for reaching a package with no task", () => {
    // 🔴 `--filter=./packages/*` claims a PLACE, not that everything in it has
    // suites. turbo skipping a config package there is the pattern working.
    // Reporting it would be a check that fails on every correct run.
    expect(laneDrift(["a"], selection(["a", "tsconfig"], []))).toEqual({
      unrun: [],
      stale: [],
    });
  });

  it("is silent when the two agree", () => {
    expect(laneDrift(["a", "b"], selection(["b", "a"]))).toEqual({
      unrun: [],
      stale: [],
    });
  });
});

describe("readWorkspace", () => {
  it("carries the manifest's own location, for a location filter to match", () => {
    expect(
      readWorkspace(() => manifest("@scope/a"), ["packages/a/package.json"])
    ).toEqual([
      {
        name: "@scope/a",
        directory: "packages/a",
        scripts: { build: "tsup" },
      },
    ]);
  });
});

describe("selectedPackages", () => {
  const packages = [
    { name: "@scope/a", directory: "packages/a", scripts: {} },
    { name: "@scope/b", directory: "packages/b", scripts: {} },
    { name: "app", directory: "apps/app", scripts: {} },
  ];

  it("resolves a location against the tree that will run", () => {
    const invocations = [
      { line: "", filters: { names: [], locations: ["./packages/*"] } },
    ];

    expect(selectedPackages(invocations, packages)).toEqual({
      covered: ["@scope/a", "@scope/b"],
      // 🔴 A location names nobody, so nothing it reaches can be a stale name.
      named: [],
    });
  });

  it("keeps a written-out name answerable for itself", () => {
    const invocations = [
      { line: "", filters: { names: ["app"], locations: [] } },
    ];

    expect(selectedPackages(invocations, packages)).toEqual({
      covered: ["app"],
      named: ["app"],
    });
  });
});

describe("this repository", () => {
  const manifests = workspaceManifests(root);

  it("asks pnpm for the workspace rather than scanning two directories", () => {
    // 🔴 The positive control for the inventory. `e2e` is a workspace member
    // that sits under neither `packages/` nor `apps/`, so a scan of those two
    // would judge a smaller workspace than the one that runs — and a package
    // outside the scan is the silent gap this whole check reports.
    expect(manifests).toContain("e2e/package.json");
    expect(manifests).toContain("packages/nextly/package.json");
    expect(manifests).toContain("apps/playground/package.json");
    // The workspace root is a project to pnpm and not a package to this.
    expect(manifests).not.toContain("package.json");
  });

  for (const [task, workflow] of [
    ["test", ".github/workflows/ci.yml"],
    ["test:integration", ".github/workflows/integration.yml"],
  ]) {
    it(`runs every package that declares \`${task}\``, () => {
      // Against the real tree, not a fixture: a guard proved only on fixtures
      // has not been shown to agree with the thing it guards.
      const readManifest = path => readFileSync(join(root, path), "utf8");
      const declared = packagesWithTask(readManifest, manifests, task);
      const invocations = taskInvocations(
        readFileSync(join(root, workflow), "utf8"),
        task
      );
      const selection = selectedPackages(
        invocations,
        readWorkspace(readManifest, manifests)
      );

      // The population before the verdict: an empty side agrees with anything.
      expect(manifests.length).toBeGreaterThan(10);
      expect(invocations.length).toBeGreaterThan(0);
      expect(declared.length).toBeGreaterThan(0);
      expect(selection.covered.length).toBeGreaterThan(0);

      expect(laneDrift(declared, selection)).toEqual({ unrun: [], stale: [] });
    });
  }
});
