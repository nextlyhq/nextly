/**
 * The boot's install-state gate: a configured plugin that was never
 * installed, that was uninstalled, or whose uninstall stopped part way.
 *
 * The gate takes no migration mode, so a refusal here holds with boot
 * migrations on and off alike; that it runs before them is pinned by
 * `di/__tests__/boot-order.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import type { SchemaEventRow } from "../../events/schema-events-repository";
import type { OwnerRecord } from "../owner-registry";
import {
  assertBootPluginsInstalled,
  assertPluginsInstalled,
} from "../plugin-install-gate";
import type { PluginLifecycleRecord } from "../plugin-lifecycle-state";

const plugins = [{ name: "auth" }, { name: "seo" }];

const states = (entries: Record<string, PluginLifecycleRecord>) =>
  new Map(Object.entries(entries));

const installed: PluginLifecycleRecord = { state: "installed" };

/** What `run` throws; fails the test when it throws nothing. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and the boot was allowed");
}

function judge(
  entries: Record<string, PluginLifecycleRecord>,
  production: boolean
) {
  const warn = vi.fn();
  const run = () =>
    assertPluginsInstalled({
      plugins,
      states: states(entries),
      production,
      warn,
    });
  return { run, warn };
}

describe("assertPluginsInstalled", () => {
  it("boots when every configured plugin is recorded installed", () => {
    const { run, warn } = judge({ auth: installed, seo: installed }, true);
    expect(run).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a production boot while a plugin was never installed, naming each install to run", () => {
    const { run } = judge({ auth: installed }, true);
    expect(thrown(run)).toMatchObject({
      code: "PLUGIN_NOT_INSTALLED",
      publicMessage: expect.stringContaining("nextly plugins install seo"),
    });
  });

  it("names every plugin not installed in one refusal", () => {
    const { run } = judge({}, true);
    expect(thrown(run)).toMatchObject({
      logContext: { plugins: ["auth", "seo"] },
    });
  });

  it("only warns in development about a plugin never installed", () => {
    const { run, warn } = judge({ auth: installed }, false);
    expect(run).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("nextly plugins install seo")
    );
  });

  describe("a disabled plugin", () => {
    // `enabled: false` withholds a plugin's hooks, so no install can run its
    // `onInstall`; requiring one would refuse every such production boot.
    const withSeo = (enabled: boolean) => [
      { name: "auth" },
      { name: "seo", enabled },
    ];
    function judgeWith(
      enabled: boolean,
      entries: Record<string, PluginLifecycleRecord>,
      production: boolean
    ) {
      const warn = vi.fn();
      const run = () =>
        assertPluginsInstalled({
          plugins: withSeo(enabled),
          states: states(entries),
          production,
          warn,
        });
      return { run, warn };
    }

    it("boots in production when it was never installed, and says nothing of it", () => {
      const { run, warn } = judgeWith(false, { auth: installed }, true);
      expect(run).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });

    it("is refused, naming the install, once it is enabled and still not installed", () => {
      // The same config with the plugin switched on: its `onInstall` has
      // still never run, and the refusal names the command that runs it.
      const { run } = judgeWith(true, { auth: installed }, true);
      expect(thrown(run)).toMatchObject({
        code: "PLUGIN_NOT_INSTALLED",
        publicMessage: expect.stringContaining(
          'Run "nextly plugins install seo"'
        ),
      });
    });

    it.each([
      [{ state: "uninstalled" } as const, "PLUGIN_SCHEMA_UNINSTALLED"],
      [{ state: "orphaned" } as const, "PLUGIN_SCHEMA_UNINSTALLED"],
      [
        { state: "uninstalling", keepData: false } as const,
        "PLUGIN_UNINSTALL_UNFINISHED",
      ],
    ])("is still refused when recorded %o", (record, code) => {
      for (const production of [true, false]) {
        const { run } = judgeWith(
          false,
          { auth: installed, seo: record },
          production
        );
        expect(thrown(run)).toMatchObject({ code });
      }
    });
  });

  it.each([true, false])(
    "refuses an uninstall that began and did not finish (production: %s)",
    production => {
      const { run } = judge(
        { auth: installed, seo: { state: "uninstalling", keepData: true } },
        production
      );
      expect(thrown(run)).toMatchObject({
        code: "PLUGIN_UNINSTALL_UNFINISHED",
        publicMessage: expect.stringContaining(
          "nextly plugins uninstall seo --keep-data"
        ),
      });
    }
  );

  it.each([
    ["uninstalled", true],
    ["uninstalled", false],
    ["orphaned", true],
    ["orphaned", false],
  ] as const)(
    "refuses a plugin recorded %s while it is configured (production: %s)",
    (state, production) => {
      const { run } = judge({ auth: installed, seo: { state } }, production);
      expect(thrown(run)).toMatchObject({ code: "PLUGIN_SCHEMA_UNINSTALLED" });
    }
  );
});

function lifecycleRow(
  plugin: string,
  note: string,
  at: number
): SchemaEventRow {
  return {
    id: `${plugin}-${String(at)}`,
    eventType: "plugin_lifecycle",
    status: "applied",
    source: "cli-plugin-migrate",
    filename: `plugin-lifecycle:${plugin}`,
    sha256: null,
    scopeKind: "plugin",
    scopeSlug: plugin,
    startedAt: new Date(at),
    endedAt: null,
    durationMs: null,
    note,
    statementsExecuted: null,
    supersededEventIds: null,
    supersededBy: null,
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

describe("assertBootPluginsInstalled", () => {
  const boot = (
    over: Partial<Parameters<typeof assertBootPluginsInstalled>[0]>
  ) =>
    assertBootPluginsInstalled({
      plugins,
      readLifecycleEvents: async () => [],
      ledgerExists: async () => true,
      readOwners: async () => [],
      registryExists: async () => true,
      production: true,
      warn: () => {},
      ...over,
    });

  it("reads each plugin's newest event", async () => {
    await expect(
      boot({
        readLifecycleEvents: async () => [
          lifecycleRow("auth", "installed", 1),
          lifecycleRow("seo", "installed", 1),
          lifecycleRow("seo", "uninstalling:full", 2),
        ],
      })
    ).rejects.toMatchObject({ code: "PLUGIN_UNINSTALL_UNFINISHED" });
  });

  it("boots once a reinstall follows the uninstall", async () => {
    await expect(
      boot({
        readLifecycleEvents: async () => [
          lifecycleRow("auth", "installed", 1),
          lifecycleRow("seo", "uninstalled", 1),
          lifecycleRow("seo", "installed", 2),
        ],
      })
    ).resolves.toBeUndefined();
  });

  it("refuses a plugin whose owner rows an uninstall marked before these events existed", async () => {
    await expect(
      boot({
        production: false,
        readLifecycleEvents: async () => [lifecycleRow("auth", "installed", 1)],
        readOwners: async () => [ownerRow("seo", "uninstalled")],
      })
    ).rejects.toMatchObject({ code: "PLUGIN_SCHEMA_UNINSTALLED" });
  });

  it("does not take a note it does not write for installed", async () => {
    await expect(
      boot({
        readLifecycleEvents: async () => [
          lifecycleRow("auth", "installed", 1),
          lifecycleRow("seo", "something-newer", 1),
        ],
      })
    ).rejects.toMatchObject({ code: "PLUGIN_NOT_INSTALLED" });
  });

  it("reads a missing ledger and registry as nothing installed", async () => {
    await expect(
      boot({
        readLifecycleEvents: () => Promise.reject(new Error("no such table")),
        ledgerExists: async () => false,
        readOwners: () => Promise.reject(new Error("no such table")),
        registryExists: async () => false,
      })
    ).rejects.toMatchObject({ code: "PLUGIN_NOT_INSTALLED" });
  });

  it("does not turn a ledger it cannot read into an empty one", async () => {
    const fault = new Error("connection reset");
    await expect(
      boot({ readLifecycleEvents: () => Promise.reject(fault) })
    ).rejects.toBe(fault);
  });

  it("does not turn an owner registry it cannot read into an empty one", async () => {
    // Read as empty, a plugin uninstalled before the events existed would
    // boot, and a development push would recreate its tables.
    const fault = new Error("connection reset");
    await expect(
      boot({
        readLifecycleEvents: async () => [
          lifecycleRow("auth", "installed", 1),
          lifecycleRow("seo", "installed", 1),
        ],
        readOwners: () => Promise.reject(fault),
      })
    ).rejects.toBe(fault);
  });

  it("checks nothing with no plugin configured", async () => {
    const readLifecycleEvents = vi.fn(async () => []);
    await assertBootPluginsInstalled({
      plugins: [],
      readLifecycleEvents,
      ledgerExists: async () => true,
      readOwners: async () => [],
      registryExists: async () => true,
      production: true,
      warn: () => {},
    });
    expect(readLifecycleEvents).not.toHaveBeenCalled();
  });
});
