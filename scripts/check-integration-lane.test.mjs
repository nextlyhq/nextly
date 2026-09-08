import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  integrationInvocations,
  laneDrift,
  packagesWithIntegrationTask,
} from "./check-integration-lane.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = (name, extra = {}) =>
  JSON.stringify({ name, scripts: { test: "vitest run", ...extra } });

describe("integrationInvocations", () => {
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
