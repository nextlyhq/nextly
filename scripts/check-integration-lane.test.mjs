import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  integrationInvocations,
  laneDrift,
  packagesWithIntegrationTask,
  staticallyDisabled,
  workflowSteps,
} from "./check-integration-lane.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = (name, extra = {}) =>
  JSON.stringify({ name, scripts: { test: "vitest run", ...extra } });

describe("workflowSteps", () => {
  it("reads a block scalar's body and stops at the next key", () => {
    const workflow = [
      "      - name: Run integration tests",
      "        run: |",
      "          pnpm turbo build --filter=nextly",
      "          pnpm turbo test:integration --filter=nextly",
      "        env:",
      "          TURBO_CACHE_DIR: .turbo",
    ].join("\n");

    expect(workflowSteps(workflow)).toEqual([
      {
        indent: 6,
        condition: undefined,
        commands: [
          "pnpm turbo build --filter=nextly",
          "pnpm turbo test:integration --filter=nextly",
        ],
      },
    ]);
  });

  it("reads the one-line form too", () => {
    expect(workflowSteps("      - run: pnpm install --frozen-lockfile")).toEqual([
      { indent: 6, condition: undefined, commands: ["pnpm install --frozen-lockfile"] },
    ]);
  });

  it("keeps the condition with the step it guards", () => {
    const workflow = [
      "      - name: Run integration tests (mysql)",
      "        if: matrix.dialect == 'mysql'",
      "        run: pnpm turbo test:integration --filter=nextly",
    ].join("\n");

    expect(workflowSteps(workflow)[0].condition).toBe("matrix.dialect == 'mysql'");
  });

  it("does not read the prose that explains the workflow", () => {
    // 🔴 The comments here describe what each leg runs, so a paragraph naming a
    // command is written exactly like the command. Only `run:` executes.
    const workflow = [
      "      # `plugin-seo` runs on THIS leg only. The others would run",
      "      # pnpm turbo test:integration --filter=@nextlyhq/plugin-seo twice.",
      "      - name: Something",
      "        run: pnpm turbo test:integration --filter=nextly",
    ].join("\n");

    expect(workflowSteps(workflow).flatMap(s => s.commands)).toEqual([
      "pnpm turbo test:integration --filter=nextly",
    ]);
  });
});

describe("staticallyDisabled", () => {
  it("is true only for a literal false", () => {
    expect(staticallyDisabled("false")).toBe(true);
    expect(staticallyDisabled("${{ false }}")).toBe(true);
  });

  it("leaves a condition the run decides alone", () => {
    // 🔴 The control that keeps this from over-reporting: a matrix condition is
    // the workflow SELECTING a leg, not disabling one. Reading it as disabled
    // would report the postgres and mysql legs as covering nothing.
    expect(staticallyDisabled("matrix.dialect == 'mysql'")).toBe(false);
    expect(staticallyDisabled("success()")).toBe(false);
    expect(staticallyDisabled(undefined)).toBe(false);
  });
});

describe("integrationInvocations", () => {
  it("does not count an invocation that was commented out", () => {
    // 🔴 The defect this exists to prevent, in the check itself: a leg disabled
    // by a `#` still describes its filters perfectly. Counting them reports a
    // covered lane while nothing runs, which is the one answer worse than none.
    const workflow = [
      "      - name: Run integration tests",
      "        run: |",
      "          # pnpm turbo test:integration --filter=nextly --filter=@scope/a",
    ].join("\n");

    expect(integrationInvocations(workflow)).toEqual([]);
  });

  it("does not count a step that cannot run", () => {
    // 🔴 A step turned off still describes its filters perfectly, so counting
    // them reports a lane covered by something that never executes.
    const workflow = [
      "      - name: Run integration tests",
      "        if: ${{ false }}",
      "        run: pnpm turbo test:integration --filter=nextly",
    ].join("\n");

    expect(integrationInvocations(workflow)).toEqual([]);
  });

  it("still counts a step whose condition the run decides", () => {
    // The control for the case above.
    const workflow = [
      "      - name: Run integration tests (mysql)",
      "        if: matrix.dialect == 'mysql'",
      "        run: pnpm turbo test:integration --filter=nextly",
    ].join("\n");

    expect(integrationInvocations(workflow)).toHaveLength(1);
  });

  it("treats a comment with no space after the hash as a comment", () => {
    // `cmd #--filter=x` runs `cmd`; the shell needs no space after the hash.
    // Splitting on `# ` alone read the commented flag as coverage.
    const workflow = [
      "      - name: Run integration tests",
      "        run: |",
      "          pnpm turbo test:integration --filter=nextly #--filter=@scope/a",
    ].join("\n");

    expect(integrationInvocations(workflow)).toEqual([
      { line: "pnpm turbo test:integration --filter=nextly", filters: ["nextly"] },
    ]);
  });

  it("stops at a trailing comment rather than reading its filters", () => {
    const workflow = [
      "      - name: Run integration tests",
      "        run: |",
      "          pnpm turbo test:integration --filter=nextly # later --filter=@scope/a",
    ].join("\n");

    expect(integrationInvocations(workflow)).toEqual([
      { line: "pnpm turbo test:integration --filter=nextly", filters: ["nextly"] },
    ]);
  });

  it("reads the filters off the command, not off the step name", () => {
    // The name is prose somebody can reword; the command is what runs.
    const workflow = [
      "      - name: Something else entirely",
      "        run: |",
      "          pnpm turbo build --filter=@nextlyhq/adapter-sqlite",
      "          pnpm turbo test:integration --filter=nextly --filter=@nextlyhq/plugin-seo",
    ].join("\n");

    expect(integrationInvocations(workflow)).toEqual([
      {
        line: "pnpm turbo test:integration --filter=nextly --filter=@nextlyhq/plugin-seo",
        filters: ["nextly", "@nextlyhq/plugin-seo"],
      },
    ]);
  });

  it("ignores a build that filters the same packages", () => {
    // 🔴 The control that matters: a `turbo build` line carries an identical
    // filter list, so a reader matching only `--filter=` would count packages
    // as covered because they were BUILT.
    const workflow =
      "          pnpm turbo build --filter=nextly --filter=@nextlyhq/plugin-seo";

    expect(integrationInvocations(workflow)).toEqual([]);
  });

  it("finds nothing when the task is not run", () => {
    expect(integrationInvocations("          pnpm turbo test --filter=nextly")).toEqual(
      []
    );
  });
});

describe("packagesWithIntegrationTask", () => {
  const files = {
    "packages/a/package.json": manifest("@scope/a", {
      "test:integration": "vitest run --config vitest.integration.config.ts",
    }),
    "packages/b/package.json": manifest("@scope/b"),
    "packages/c/package.json": "{ not json",
    "packages/d/package.json": JSON.stringify({ scripts: {} }),
  };

  it("names only the packages that declare the task", () => {
    expect(
      packagesWithIntegrationTask(path => files[path], Object.keys(files))
    ).toEqual(["@scope/a"]);
  });

  it("skips a manifest it cannot read rather than throwing", () => {
    // An unreadable manifest is the workspace linter's finding, not this one,
    // and crashing here would take the real answer with it.
    expect(() =>
      packagesWithIntegrationTask(path => files[path], Object.keys(files))
    ).not.toThrow();
  });
});

describe("laneDrift", () => {
  it("reports a package no leg selects", () => {
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
  it("runs every package that declares the task", () => {
    // Against the real tree, not a fixture: a guard proved only on fixtures has
    // not been shown to agree with the thing it guards.
    const manifests = execFileSync(
      "git",
      ["ls-files", "packages/*/package.json", "apps/*/package.json"],
      { cwd: root, encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);
    const declared = packagesWithIntegrationTask(
      path => readFileSync(join(root, path), "utf8"),
      manifests
    );
    const invocations = integrationInvocations(
      readFileSync(join(root, ".github/workflows/integration.yml"), "utf8")
    );
    const selected = [...new Set(invocations.flatMap(i => i.filters))];

    // The population before the verdict: an empty side agrees with anything.
    expect(manifests.length).toBeGreaterThan(10);
    expect(invocations.length).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(0);

    expect(laneDrift(declared, selected)).toEqual({ unrun: [], stale: [] });
  });
});
