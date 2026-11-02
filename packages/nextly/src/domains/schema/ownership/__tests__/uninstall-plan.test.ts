/**
 * What an uninstall decides before it touches anything.
 *
 * Every refusal here is the last thing standing between an operator and
 * deleted data.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { OwnerRecord } from "../owner-registry";
import {
  planUninstall,
  type UninstallDependent,
  type UninstallInput,
} from "../uninstall-plan";

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

describe("disabled dependents", () => {
  it("refuses while a disabled plugin still REQUIRES this one", () => {
    // A disabled plugin still takes part in schema ordering: with this one
    // removed from the config, its required `dependsOn` fails the boot.
    expect(
      refusal(() =>
        planUninstall(
          input({ disabled: [{ name: "reports", requires: ["auth"] }] })
        )
      ).code
    ).toBe("PLUGIN_HAS_DEPENDENTS");
  });

  it("allows one that depends on it only optionally", () => {
    // The control: an optional dependency missing is not a boot failure.
    expect(
      planUninstall(input({ disabled: [{ name: "reports", requires: [] }] }))
        .finalState
    ).toBe("uninstalled");
  });
});

describe("--keep-data", () => {
  it("keeps the tables and marks the owner orphaned", () => {
    const plan = planUninstall(input({ keepData: true }));
    expect(plan).toEqual({
      finalState: "orphaned",
      downModules: [],
      tablesDropped: [],
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

describe("element-aware planning (C7)", () => {
  it("element rows do not multiply the table list", () => {
    const plan = planUninstall({
      pluginName: "fx",
      enabled: [{ name: "fx", dependsOn: [] }],
      owned: [
        {
          tableName: "fx__notes",
          ownerKind: "plugin",
          ownerId: "fx",
          migratedBy: "plugin:fx",
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active",
        },
        {
          tableName: "fx__notes",
          elementKind: "index",
          elementName: "idx_fx__notes_label",
          ownerKind: "plugin",
          ownerId: "fx",
          migratedBy: "plugin:fx",
          ownerVersion: null,
          schemaVersion: null,
          state: "active",
        },
      ],
      modules: [{ name: "001", reversible: true }],
      keepData: false,
    });
    expect(plan.tablesDropped).toEqual(["fx__notes"]);
  });
});

describe("what other owners built on the plugin's schema", () => {
  const appColumn: UninstallDependent = {
    kind: "column",
    name: "app_label",
    table: "auth__identities",
    owner: "the app",
  };
  const inboundKey: UninstallDependent = {
    kind: "foreign key",
    name: "fk_sso_identity",
    table: "sso__links",
    owner: "plugin sso",
  };
  const onContributed: UninstallDependent = {
    kind: "index",
    name: "idx_users_auth_handle",
    table: "users",
    owner: "plugin audit (removed from the config)",
  };

  it("refuses a full uninstall that would drop another owner's element, naming it, its owner and the way out", () => {
    const error = refusal(() =>
      planUninstall(input({ dependents: [appColumn] }))
    );
    expect(error.code).toBe("PLUGIN_UNINSTALL_WOULD_DROP_OTHERS");
    expect(error.publicMessage).toContain("app_label");
    expect(error.publicMessage).toContain("auth__identities");
    expect(error.publicMessage).toContain("the app");
    expect(error.publicMessage).toContain("--keep-data");
  });

  it("names every dependent at once, whatever its kind", () => {
    const error = refusal(() =>
      planUninstall(
        input({ dependents: [appColumn, inboundKey, onContributed] })
      )
    );
    for (const name of [
      "app_label",
      "fk_sso_identity",
      "idx_users_auth_handle",
    ]) {
      expect(error.publicMessage).toContain(name);
    }
    expect(error.publicMessage).toContain("removed from the config");
  });

  it("refuses before checking whether its modules can be undone", () => {
    // Taking another owner's data is the more consequential refusal, and the
    // one an operator cannot fix by changing this plugin.
    const error = refusal(() =>
      planUninstall(
        input({
          dependents: [inboundKey],
          modules: [{ name: "001_init", reversible: false }],
        })
      )
    );
    expect(error.publicMessage).toContain("fk_sso_identity");
  });

  it("CONTROL: keeping the data takes nothing from anyone, so it is allowed", () => {
    const plan = planUninstall(
      input({ dependents: [appColumn, inboundKey], keepData: true })
    );
    expect(plan.finalState).toBe("orphaned");
  });

  it("CONTROL: with nothing built on it, the full uninstall is planned", () => {
    const plan = planUninstall(input({ dependents: [] }));
    expect(plan.finalState).toBe("uninstalled");
  });
});
