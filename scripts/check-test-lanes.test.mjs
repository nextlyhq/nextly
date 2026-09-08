import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  commandCoverage,
  filtersIn,
  joinContinuations,
  laneDrift,
  packagesWithTask,
  staticallyDisabled,
  taskInvocations,
  workflowSteps,
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
    ).toEqual(["@scope/a", "b", "c"]);
  });

  it("drops a pattern it cannot enumerate", () => {
    // 🔴 A glob selects a set this cannot resolve. Guessing would report
    // coverage that may not exist, which is the direction that costs most.
    expect(filtersIn("pnpm exec publint --filter '@nextlyhq/*'")).toEqual([]);
    expect(filtersIn("pnpm lint --filter='./packages/*'")).toEqual([]);
  });
});

describe("commandCoverage", () => {
  it("counts a turbo run of the task", () => {
    expect(commandCoverage("pnpm turbo test --filter=nextly", "test")).toEqual([
      "nextly",
    ]);
  });

  it("does not let `test` swallow `test:integration`", () => {
    expect(
      commandCoverage("pnpm turbo test:integration --filter=nextly", "test")
    ).toBeNull();
  });

  it("counts a bare vitest run, which runs the whole suite", () => {
    expect(
      commandCoverage("pnpm --filter playground exec vitest run", "test")
    ).toEqual(["playground"]);
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
      { line: "pnpm turbo test --filter=nextly", filters: ["nextly"] },
    ]);
  });
});

describe("laneDrift", () => {
  it("reports a package no command runs", () => {
    expect(laneDrift(["a", "b"], ["a"])).toEqual({ unrun: ["b"], stale: [] });
  });

  it("reports a filter for a package that has no such task", () => {
    expect(laneDrift(["a"], ["a", "gone"])).toEqual({
      unrun: [],
      stale: ["gone"],
    });
  });

  it("is silent when the two agree", () => {
    expect(laneDrift(["a", "b"], ["b", "a"])).toEqual({ unrun: [], stale: [] });
  });
});

describe("this repository", () => {
  const manifests = execFileSync(
    "git",
    ["ls-files", "packages/*/package.json", "apps/*/package.json"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);

  for (const [task, workflow] of [
    ["test", ".github/workflows/ci.yml"],
    ["test:integration", ".github/workflows/integration.yml"],
  ]) {
    it(`runs every package that declares \`${task}\``, () => {
      // Against the real tree, not a fixture: a guard proved only on fixtures
      // has not been shown to agree with the thing it guards.
      const declared = packagesWithTask(
        path => readFileSync(join(root, path), "utf8"),
        manifests,
        task
      );
      const invocations = taskInvocations(
        readFileSync(join(root, workflow), "utf8"),
        task
      );
      const selected = [...new Set(invocations.flatMap(i => i.filters))];

      // The population before the verdict: an empty side agrees with anything.
      expect(manifests.length).toBeGreaterThan(10);
      expect(invocations.length).toBeGreaterThan(0);
      expect(declared.length).toBeGreaterThan(0);

      expect(laneDrift(declared, selected)).toEqual({ unrun: [], stale: [] });
    });
  }
});
