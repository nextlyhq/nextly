import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isSingleCommand,
  namesScript,
  LANES,
  packagesInPlan,
  packagesRunTwice,
  packagesWithTask,
  planForScript,
  directLaneCommand,
  isDirectLaneFor,
  readWorkspace,
  unrunPackages,
  workspaceManifests,
} from "./check-test-lanes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = (name, extra = {}) =>
  JSON.stringify({ name, scripts: { build: "tsup", ...extra } });

describe("packagesInPlan", () => {
  const plan = {
    tasks: [
      { package: "a", task: "test", command: "vitest run" },
      { package: "config", task: "test", command: "<NONEXISTENT>" },
      { package: "b", task: "build", command: "tsup" },
      { package: "c", task: "test:integration", command: "vitest run" },
    ],
  };

  it("names the packages that actually run the task", () => {
    expect(packagesInPlan(plan, "test")).toEqual(["a"]);
  });

  it("does not count a package turbo selected but has nothing to run", () => {
    // 🔴 A location filter reaches config packages with no suites, and turbo
    // marks those `<NONEXISTENT>`. Counting them would be this check inventing
    // coverage for packages that were never going to run anything.
    expect(packagesInPlan(plan, "test")).not.toContain("config");
  });

  it("does not let one task answer for another", () => {
    expect(packagesInPlan(plan, "test:integration")).toEqual(["c"]);
  });

  it("reports nothing for a plan with no tasks at all", () => {
    expect(packagesInPlan({}, "test")).toEqual([]);
  });
});

describe("packagesRunTwice", () => {
  it("names a package two scripts both run, and which ones", () => {
    expect(
      packagesRunTwice([
        ["lane:test", ["a", "nextly"]],
        ["lane:test:nextly", ["nextly"]],
      ])
    ).toEqual([{ name: "nextly", scripts: ["lane:test", "lane:test:nextly"] }]);
  });

  it("is silent when the scripts partition the work", () => {
    expect(
      packagesRunTwice([
        ["lane:test", ["a", "b"]],
        ["lane:test:nextly", ["nextly"]],
      ])
    ).toEqual([]);
  });
});

describe("unrunPackages", () => {
  it("names a package no lane reaches", () => {
    expect(unrunPackages(["a", "b"], ["a"])).toEqual(["b"]);
  });

  it("is silent when every declared package is covered", () => {
    expect(unrunPackages(["a", "b"], ["b", "a", "extra"])).toEqual([]);
  });
});

describe("isDirectLaneFor", () => {
  it("accepts the package running its own task command", () => {
    expect(
      isDirectLaneFor(
        "pnpm --filter playground exec vitest run",
        "playground",
        "vitest run"
      )
    ).toBe(true);
  });

  it("refuses a run narrowed by a selective flag", () => {
    // 🔴 Reconstructed from the package rather than matched against a list of
    // the vitest options that narrow a run: such a list would be a second,
    // ageing copy of vitest's own, and `--changed` runs only what a diff
    // touched.
    for (const narrowed of ["--changed", "--shard=1/4", "--project=x"]) {
      expect(
        isDirectLaneFor(
          `pnpm --filter playground exec vitest run ${narrowed}`,
          "playground",
          "vitest run"
        )
      ).toBe(false);
    }
  });

  it("refuses a lane pointed at a different package", () => {
    // 🔴 The half an `endsWith` could not answer. This ends with `vitest run`
    // exactly as the real lane does, so the lane would have reported the
    // playground covered while running someone else's suites.
    expect(
      isDirectLaneFor(
        "pnpm --filter @nextlyhq/admin exec vitest run",
        "playground",
        "vitest run"
      )
    ).toBe(false);
  });

  it("refuses a script that runs something else entirely", () => {
    expect(
      isDirectLaneFor("pnpm --filter playground exec jest", "playground", "vitest run")
    ).toBe(false);
  });

  it("builds the command an entry implies", () => {
    expect(directLaneCommand("playground", "vitest run")).toBe(
      "pnpm --filter playground exec vitest run"
    );
  });
});

describe("namesScript", () => {
  it("finds the script the workflow calls", () => {
    expect(namesScript("        run: pnpm lane:test\n", "lane:test")).toBe(true);
  });

  it("does not let a longer name vouch for a shorter one", () => {
    // 🔴 These names nest. A plain containment test let `lane:test:playground`
    // stand in for a `lane:test` step that had been replaced, and the check
    // then reported every package covered while the suites ran nowhere.
    expect(
      namesScript("        run: pnpm lane:test:playground\n", "lane:test")
    ).toBe(false);
  });

  it("does not let an argument be appended to the call", () => {
    // 🔴 `pnpm lane:test --dry=json` would otherwise satisfy this while the
    // step only printed a plan: the check would measure the manifest's script
    // and the job would run something else.
    expect(
      namesScript("        run: pnpm lane:test --dry=json\n", "lane:test")
    ).toBe(false);
  });

  it("is false when nothing calls it", () => {
    expect(namesScript("        run: echo skipped\n", "lane:test")).toBe(false);
  });
});

describe("isSingleCommand", () => {
  it("accepts the shape a lane script has", () => {
    expect(isSingleCommand("turbo run test --filter='./packages/*'")).toBe(true);
  });

  it("refuses an operator that could swallow the failure", () => {
    // 🔴 `|| true` plans the same work and reports success however the suites
    // end, so the plan would be right while the gate was gone.
    expect(isSingleCommand("turbo run test || true")).toBe(false);
    expect(isSingleCommand("turbo run test && echo ok")).toBe(false);
    expect(isSingleCommand("turbo run test; true")).toBe(false);
  });

  it("refuses a second command on a new line", () => {
    // 🔴 A newline separates commands as surely as `;`. This one plans the
    // work, runs none of it, and ends successfully — the exact bypass the
    // predicate exists to refuse, and the operators alone did not see it.
    expect(isSingleCommand("turbo run test --dry=json\ntrue")).toBe(false);
    expect(isSingleCommand("turbo run test\r\ntrue")).toBe(false);
  });

  it("refuses substitution, which can introduce a command the text does not show", () => {
    expect(isSingleCommand("turbo run test $(echo --dry=json)")).toBe(false);
    expect(isSingleCommand("turbo run test `echo x`")).toBe(false);
  });
});

describe("readWorkspace", () => {
  it("keeps the name and the scripts, which is all this asks of a package", () => {
    expect(
      readWorkspace(() => manifest("@scope/a", { test: "vitest run" }), [
        "packages/a/package.json",
      ])
    ).toEqual([
      { name: "@scope/a", scripts: { build: "tsup", test: "vitest run" } },
    ]);
  });

  it("skips a manifest it cannot read rather than throwing", () => {
    expect(readWorkspace(() => "not json", ["packages/a/package.json"])).toEqual(
      []
    );
  });
});

describe("packagesWithTask", () => {
  const files = {
    "packages/a/package.json": manifest("@scope/a", { test: "vitest run" }),
    "packages/b/package.json": manifest("@scope/b"),
    "packages/c/package.json": manifest("@scope/c", {
      "test:integration": "vitest run",
    }),
  };

  it("names only the packages that declare the task", () => {
    expect(packagesWithTask(path => files[path], Object.keys(files), "test")).toEqual(
      ["@scope/a"]
    );
    expect(
      packagesWithTask(path => files[path], Object.keys(files), "test:integration")
    ).toEqual(["@scope/c"]);
  });
});

describe("this repository", () => {
  const manifests = workspaceManifests(root);
  const readManifest = path => readFileSync(join(root, path), "utf8");
  const rootScripts = JSON.parse(readManifest("package.json")).scripts;

  it("asks pnpm for the workspace rather than scanning two directories", () => {
    // 🔴 The positive control for the inventory. `e2e` is a workspace member
    // that sits under neither `packages/` nor `apps/`, so a scan of those two
    // would judge a smaller workspace than the one that runs — and a package
    // outside the scan is the silent gap this whole check reports.
    expect(manifests).toContain("e2e/package.json");
    expect(manifests).toContain("packages/nextly/package.json");
    expect(manifests).toContain("apps/playground/package.json");
    expect(manifests).not.toContain("package.json");
  });

  it("has each direct lane script run its package's whole task", () => {
    const packages = readWorkspace(readManifest, manifests);
    const direct = LANES.flatMap(lane =>
      lane.direct.map(entry => ({ ...entry, task: lane.task }))
    );
    expect(direct.length).toBeGreaterThan(0);
    for (const entry of direct) {
      const command = packages.find(p => p.name === entry.package)?.scripts?.[entry.task];
      expect(typeof command).toBe("string");
      expect(isDirectLaneFor(rootScripts[entry.script], entry.package, command)).toBe(
        true
      );
    }
  });

  it("keeps every lane script a single command", () => {
    const named = LANES.flatMap(lane => [
      ...lane.scripts,
      ...lane.direct.map(entry => entry.script),
    ]);
    expect(named.length).toBeGreaterThan(0);
    for (const script of named) {
      expect(isSingleCommand(rootScripts[script])).toBe(true);
    }
  });

  it("says whether each lane's scripts partition the work", () => {
    // A lane whose legs each take a dialect names the same package on purpose,
    // so this is a declared property rather than one to infer. Asserted as a
    // boolean so a new lane cannot leave it undefined and be read as false.
    for (const lane of LANES) {
      expect(typeof lane.partitioned).toBe("boolean");
    }
  });

  it("declares every lane script it names", () => {
    const named = LANES.flatMap(lane => [
      ...lane.scripts,
      ...lane.direct.map(entry => entry.script),
    ]);
    expect(named.length).toBeGreaterThan(0);
    for (const script of named) {
      expect(typeof rootScripts[script]).toBe("string");
    }
  });

  for (const lane of LANES) {
    describe(`the \`${lane.task}\` lane`, () => {
      it("is the one the workflow calls", () => {
        // A containment test, not a reading of the step. What this can show is
        // that the script is named; how the step is guarded is deliberately
        // outside what this check claims.
        const workflow = readFileSync(join(root, lane.workflow), "utf8");
        for (const script of [
          ...lane.scripts,
          ...lane.direct.map(entry => entry.script),
        ]) {
          expect(workflow).toContain(`pnpm ${script}`);
        }
      });

      it("runs every package that declares the task", () => {
        // Against the real tree and the real command, not a fixture: turbo is
        // asked what the lane script would execute, so what is measured is what
        // CI runs rather than a restatement of it.
        const declared = packagesWithTask(readManifest, manifests, lane.task);
        const covered = new Set(lane.direct.map(entry => entry.package));
        for (const script of lane.scripts) {
          for (const name of packagesInPlan(planForScript(script, root), lane.task)) {
            covered.add(name);
          }
        }

        // The population before the verdict: an empty side agrees with anything.
        expect(manifests.length).toBeGreaterThan(10);
        expect(declared.length).toBeGreaterThan(0);
        expect(covered.size).toBeGreaterThan(0);

        expect(unrunPackages(declared, [...covered])).toEqual([]);
      },
      // Sized for SUBPROCESS LAUNCHES, not for the assertions: this asks turbo
      // for a plan per lane script, and the integration lane has three. They
      // run in about 8s on a loaded runner, past the 5s default that is sized
      // for a unit test doing arithmetic. The value is the one the integration
      // configs in this repo already carry for the same reason.
      30_000);
    });
  }
});
