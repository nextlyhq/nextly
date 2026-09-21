/**
 * What an uninstall decides before it touches anything.
 *
 * Every refusal here is the last thing standing between an operator and
 * deleted data.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { OwnerRecord } from "../owner-registry";
import { planUninstall, type UninstallInput } from "../uninstall-plan";

const owned: OwnerRecord[] = [
  {
    tableName: "auth__identities",
    ownerKind: "plugin",
    ownerId: "auth",
    migratedBy: "plugin:auth",
    ownerVersion: "1.0.0",
    schemaVersion: 2,
    state: "active",
  },
];

const input = (over: Partial<UninstallInput> = {}): UninstallInput => ({
  pluginName: "auth",
  enabled: [{ name: "auth", dependsOn: [] }],
  owned,
  modules: [
    { name: "001_init", reversible: true },
    { name: "002_add_column", reversible: true },
  ],
  keepData: false,
  ...over,
});

function refusal(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("expected a refusal, and the plan was produced");
}

describe("dependents", () => {
  it("refuses while an enabled plugin depends on this one", () => {
    // The dependent is by construction the plugin least able to notice: it
    // declared the dependency precisely so it could assume the tables exist.
    const error = refusal(() =>
      planUninstall(
        input({
          enabled: [
            { name: "auth", dependsOn: [] },
            { name: "sso", dependsOn: ["auth"] },
          ],
        })
      )
    );
    expect(error.publicMessage).toMatch(/"sso"/);
  });

  it("allows it when the dependent is not enabled", () => {
    // The discriminator: a check reading the whole config rather than the
    // ENABLED set would refuse an uninstall nothing actually depends on.
    expect(() =>
      planUninstall(input({ enabled: [{ name: "auth", dependsOn: [] }] }))
    ).not.toThrow();
  });

  it("does not count the plugin as its own dependent", () => {
    expect(() =>
      planUninstall(input({ enabled: [{ name: "auth", dependsOn: ["auth"] }] }))
    ).not.toThrow();
  });
});

describe("--keep-data", () => {
  it("keeps the tables and marks the owner orphaned", () => {
    const plan = planUninstall(input({ keepData: true }));
    expect(plan).toEqual({
      finalState: "orphaned",
      downModules: [],
      tablesDropped: [],
      supersedeFilenames: [],
    });
  });

  it("is allowed even when a module cannot be undone", () => {
    // The whole point of the flag: nothing is executed, so reversibility is
    // irrelevant.
    expect(() =>
      planUninstall(
        input({
          keepData: true,
          modules: [{ name: "001_init", reversible: false }],
        })
      )
    ).not.toThrow();
  });
});

describe("a full uninstall", () => {
  it("runs DOWN in reverse apply order", () => {
    // A later module may depend on what an earlier one created, so undoing
    // forwards would drop a table a later DOWN still needs.
    expect(planUninstall(input()).downModules).toEqual([
      "002_add_column",
      "001_init",
    ]);
  });

  it("names the tables the operator is about to lose", () => {
    expect(planUninstall(input()).tablesDropped).toEqual(["auth__identities"]);
  });

  it("supersedes the plugin's qualified ledger rows", () => {
    expect(planUninstall(input()).supersedeFilenames).toEqual([
      "plugin:auth/002_add_column",
      "plugin:auth/001_init",
    ]);
  });

  it("refuses when any module cannot be undone", () => {
    // Running the reversible ones and stopping would leave the schema
    // half-undone — worse than either end, because the tables partly exist
    // and no module describes what is there.
    const error = refusal(() =>
      planUninstall(
        input({
          modules: [
            { name: "001_init", reversible: true },
            { name: "002_irreversible", reversible: false },
          ],
        })
      )
    );
    expect(error.publicMessage).toMatch(/--keep-data/);
    expect(error.publicMessage).toMatch(/002_irreversible/);
  });

  it("checks dependents BEFORE reversibility", () => {
    // The operator can act on one refusal at a time, and a dependent is the
    // more consequential: telling them to use --keep-data first would hand
    // them a flag that still leaves the dependent broken.
    const error = refusal(() =>
      planUninstall(
        input({
          enabled: [
            { name: "auth", dependsOn: [] },
            { name: "sso", dependsOn: ["auth"] },
          ],
          modules: [{ name: "001_init", reversible: false }],
        })
      )
    );
    expect(error.code).toBe("PLUGIN_HAS_DEPENDENTS");
  });
});
