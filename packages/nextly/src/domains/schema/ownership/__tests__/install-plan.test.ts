/**
 * What an install decides about its dependencies before it touches anything.
 *
 * The mirror of the uninstall plan's dependents refusal: a plugin installed
 * over a dependency whose own install never happened has neither the
 * dependency's tables nor the setup its `onInstall` performs.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertDependenciesInstalled,
  missingDependencies,
  type InstallCandidate,
  type InstallDependencyInput,
} from "../install-plan";
import type { OwnerRecord } from "../owner-registry";

function plugin(
  name: string,
  over: Partial<InstallCandidate> = {}
): InstallCandidate {
  return {
    name,
    requires: [],
    optionallyRequires: [],
    declaredModules: [],
    ...over,
  };
}

function ownerRow(ownerId: string, state: OwnerRecord["state"]): OwnerRecord {
  return {
    tableName: `${ownerId}__things`,
    ownerKind: "plugin",
    ownerId,
    migratedBy: `plugin:${ownerId}`,
    ownerVersion: "1.0.0",
    schemaVersion: 1,
    state,
  };
}

const input = (
  over: Partial<InstallDependencyInput> = {}
): InstallDependencyInput => ({
  pluginName: "sso",
  configured: [
    plugin("sso", { requires: ["auth"] }),
    plugin("auth", { declaredModules: ["001_init", "002_more"] }),
  ],
  appliedFilenames: new Set(["plugin:auth/001_init", "plugin:auth/002_more"]),
  owners: [ownerRow("auth", "active")],
  ...over,
});

function refusal(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("expected a refusal, and the install was allowed");
}

describe("missingDependencies", () => {
  it("allows a dependency whose modules are all applied and rows active", () => {
    expect(missingDependencies(input())).toEqual([]);
  });

  it("refuses a dependency with a module the ledger does not show applied", () => {
    // `002_more` absent: rolled back, or never applied — either way, not the
    // schema the dependent was written against.
    expect(
      missingDependencies(
        input({ appliedFilenames: new Set(["plugin:auth/001_init"]) })
      )
    ).toEqual([
      { name: "auth", reason: "pending-modules", pending: ["002_more"] },
    ]);
  });

  it("refuses a dependency whose owner rows are uninstalled", () => {
    // Every module still reads applied here — the case the ledger alone
    // cannot see, so the owner state is what separates it from installed.
    expect(
      missingDependencies(input({ owners: [ownerRow("auth", "uninstalled")] }))
    ).toEqual([{ name: "auth", reason: "uninstalled" }]);
  });

  it("refuses a dependency uninstalled with --keep-data (orphaned rows)", () => {
    // Its tables are still there, which is exactly why this is the case to
    // pin: every module reads applied, the tables exist, and its onUninstall
    // has nonetheless run.
    expect(
      missingDependencies(input({ owners: [ownerRow("auth", "orphaned")] }))
    ).toEqual([{ name: "auth", reason: "uninstalled" }]);
  });

  it("ignores other plugins' uninstalled rows", () => {
    expect(
      missingDependencies(
        input({
          owners: [
            ownerRow("auth", "active"),
            ownerRow("other", "uninstalled"),
          ],
        })
      )
    ).toEqual([]);
  });

  it("treats a dependency with no modules and no owner rows as installed", () => {
    expect(
      missingDependencies(
        input({
          configured: [plugin("sso", { requires: ["auth"] }), plugin("auth")],
          appliedFilenames: new Set(),
          owners: [],
        })
      )
    ).toEqual([]);
  });

  it("follows dependencies transitively, listing them in install order", () => {
    // sso -> auth -> crypto, neither installed: crypto has to go first.
    const result = missingDependencies(
      input({
        configured: [
          plugin("sso", { requires: ["auth"] }),
          plugin("auth", {
            requires: ["crypto"],
            declaredModules: ["001_init"],
          }),
          plugin("crypto", { declaredModules: ["001_keys"] }),
        ],
        appliedFilenames: new Set(),
        owners: [],
      })
    );
    expect(result.map(dep => dep.name)).toEqual(["crypto", "auth"]);
  });

  it("finds a transitive dependency missing even when the direct one is installed", () => {
    const result = missingDependencies(
      input({
        configured: [
          plugin("sso", { requires: ["auth"] }),
          plugin("auth", { requires: ["crypto"] }),
          plugin("crypto", { declaredModules: ["001_keys"] }),
        ],
        appliedFilenames: new Set(),
        owners: [],
      })
    );
    expect(result).toEqual([
      { name: "crypto", reason: "pending-modules", pending: ["001_keys"] },
    ]);
  });

  it("ignores an optional dependency that is not configured", () => {
    expect(
      missingDependencies(
        input({
          configured: [plugin("sso", { optionallyRequires: ["audit"] })],
          appliedFilenames: new Set(),
          owners: [],
        })
      )
    ).toEqual([]);
  });

  it("requires an optional dependency that IS configured", () => {
    expect(
      missingDependencies(
        input({
          configured: [
            plugin("sso", { optionallyRequires: ["audit"] }),
            plugin("audit", { declaredModules: ["001_log"] }),
          ],
          appliedFilenames: new Set(),
          owners: [],
        })
      )
    ).toEqual([
      { name: "audit", reason: "pending-modules", pending: ["001_log"] },
    ]);
  });

  it("reports a required dependency that is not configured at all", () => {
    expect(
      missingDependencies(
        input({ configured: [plugin("sso", { requires: ["auth"] })] })
      )
    ).toEqual([{ name: "auth", reason: "not-configured" }]);
  });

  it("does not check the target itself", () => {
    // Its own modules are what this install is about to apply.
    expect(
      missingDependencies(
        input({
          configured: [plugin("sso", { declaredModules: ["001_init"] })],
          appliedFilenames: new Set(),
        })
      )
    ).toEqual([]);
  });

  it("terminates on a dependency cycle", () => {
    const result = missingDependencies(
      input({
        configured: [
          plugin("sso", { requires: ["auth"] }),
          plugin("auth", { requires: ["sso"], declaredModules: ["001_init"] }),
        ],
        appliedFilenames: new Set(),
        owners: [],
      })
    );
    expect(result.map(dep => dep.name)).toEqual(["auth"]);
  });
});

describe("assertDependenciesInstalled", () => {
  it("passes when everything is installed", () => {
    expect(() => assertDependenciesInstalled(input())).not.toThrow();
  });

  it("names every missing dependency, in order, with the command to run", () => {
    const error = refusal(() =>
      assertDependenciesInstalled(
        input({
          configured: [
            plugin("sso", { requires: ["auth"] }),
            plugin("auth", {
              requires: ["crypto"],
              declaredModules: ["001_init"],
            }),
            plugin("crypto", { declaredModules: ["001_keys"] }),
          ],
          appliedFilenames: new Set(),
          owners: [],
        })
      )
    );
    expect(error.code).toBe("PLUGIN_DEPENDENCY_NOT_INSTALLED");
    expect(error.publicMessage).toContain("nextly plugins install crypto");
    expect(error.publicMessage).toContain("nextly plugins install auth");
    expect(error.publicMessage.indexOf("crypto")).toBeLessThan(
      error.publicMessage.indexOf('"auth"')
    );
  });
});
