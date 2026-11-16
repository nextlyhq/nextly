/**
 * The plugins' `onMigrate`, as `nextly migrate` runs it once a run leaves
 * nothing pending: only an enabled, installed plugin that declares it, each
 * in a boot of its own scoped to it; nothing booted where none declares it;
 * and a hook that throws reported, the next one still run, and the command's
 * failure named.
 *
 * The boot is a double here: what booting does, and its teardown, is the
 * lifecycle runner's suite's subject, through the same helper.
 */
import { describe, expect, it, vi } from "vitest";

import type { PluginLifecycleRecord } from "../../../domains/schema/ownership/plugin-lifecycle-state";
import { isLifecycleCommandBoot } from "../../../domains/schema/ownership/plugin-lifecycle-state";
import type {
  PluginContext,
  PluginDefinition,
} from "../../../plugins/plugin-context";
import { runOnMigrateHooks, runPluginsOnMigrate } from "../migrate-hooks";
import type { withBootedPlugins } from "../plugin-hook-boot";

const INSTALLED: PluginLifecycleRecord = { state: "installed" };

function plugin(
  name: string,
  onMigrate?: PluginDefinition["onMigrate"],
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    ...(onMigrate === undefined ? {} : { onMigrate }),
    ...(enabled === undefined ? {} : { enabled }),
  } as PluginDefinition;
}

/**
 * A boot that records which plugin each was scoped to, and whether the
 * install-state gate's command scope was in force while it booted.
 */
function bootDouble() {
  const boots: { running: string; scoped: boolean }[] = [];
  // A generic function, as the helper is: what it answers is what `work`
  // answers, whatever that is.
  const withBoot: typeof withBootedPlugins = async (inputs, _cause, work) => {
    let scoped = false;
    const boot = async (): Promise<void> => {
      scoped = isLifecycleCommandBoot();
    };
    await (inputs.wrapBoot === undefined ? boot() : inputs.wrapBoot(boot));
    boots.push({ running: inputs.running.name, scoped });
    const value = await work(
      name => ({ pluginName: name }) as unknown as PluginContext
    );
    return { value, handlersFinished: true };
  };
  return { boots, withBoot };
}

const BOOT = {} as Parameters<typeof runOnMigrateHooks>[0]["boot"];

describe("running the plugins' onMigrate", () => {
  it("boots nothing, and reads no state, where no plugin declares it", async () => {
    const { boots, withBoot } = bootDouble();
    const lifecycle = vi.fn(async () => new Map());
    const outcome = await runOnMigrateHooks({
      plugins: [plugin("@acme/a"), plugin("@acme/b")],
      applied: 3,
      boot: BOOT,
      lifecycle,
      withBoot,
    });
    expect(outcome.ran).toEqual([]);
    expect(boots).toEqual([]);
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it("runs each installed plugin's hook in a boot scoped to it, with what the run applied", async () => {
    const { boots, withBoot } = bootDouble();
    const first = vi.fn();
    const second = vi.fn();
    const outcome = await runOnMigrateHooks({
      plugins: [plugin("@acme/a", first), plugin("@acme/b", second)],
      applied: 2,
      boot: BOOT,
      lifecycle: async () =>
        new Map([
          ["@acme/a", INSTALLED],
          ["@acme/b", INSTALLED],
        ]),
      withBoot,
    });
    expect(outcome.ran).toEqual(["@acme/a", "@acme/b"]);
    expect(first).toHaveBeenCalledWith(
      { pluginName: "@acme/a" },
      { applied: 2 }
    );
    expect(second).toHaveBeenCalledWith(
      { pluginName: "@acme/b" },
      { applied: 2 }
    );
    // One boot each, scoped so only that plugin initialises and the
    // install-state gate does not refuse a sibling not installed yet.
    expect(boots).toEqual([
      { running: "@acme/a's onMigrate", scoped: true },
      { running: "@acme/b's onMigrate", scoped: true },
    ]);
  });

  it("skips a plugin not installed on this database, and a disabled one, without booting for them", async () => {
    const { boots, withBoot } = bootDouble();
    const notInstalled = vi.fn();
    const disabled = vi.fn();
    const installed = vi.fn();
    const outcome = await runOnMigrateHooks({
      plugins: [
        plugin("@acme/new", notInstalled),
        plugin("@acme/off", disabled, false),
        plugin("@acme/on", installed),
      ],
      applied: 0,
      boot: BOOT,
      lifecycle: async () =>
        new Map<string, PluginLifecycleRecord>([
          ["@acme/off", INSTALLED],
          ["@acme/on", INSTALLED],
          ["@acme/gone", { state: "uninstalled" }],
        ]),
      withBoot,
    });
    expect(outcome.ran).toEqual(["@acme/on"]);
    expect(outcome.notInstalled).toEqual(["@acme/new"]);
    expect(notInstalled).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();
    expect(boots).toHaveLength(1);
  });

  it("reports a hook that throws, still runs the next, and names the failure the command ends with", async () => {
    const { withBoot } = bootDouble();
    const next = vi.fn();
    const logged: string[] = [];
    const logger = {
      success: (line: string) => logged.push(`ok ${line}`),
      info: (line: string) => logged.push(`info ${line}`),
      error: (line: string) => logged.push(`error ${line}`),
    } as unknown as Parameters<typeof runPluginsOnMigrate>[0]["logger"];
    const failure = await runPluginsOnMigrate({
      plugins: [
        plugin("@acme/broken", () => {
          throw new Error("the index is unreachable");
        }),
        plugin("@acme/next", next),
      ],
      applied: 1,
      boot: BOOT,
      lifecycle: async () =>
        new Map([
          ["@acme/broken", INSTALLED],
          ["@acme/next", INSTALLED],
        ]),
      logger,
      withBoot,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      "error @acme/broken: onMigrate failed: the index is unreachable"
    );
    expect(logged).toContain("ok @acme/next: onMigrate done.");
    expect(failure?.publicMessage).toBe(
      "The schema was applied, but the after-migrate step of @acme/broken failed. Run nextly migrate again to finish it."
    );
  });

  it("answers no failure when every hook ran", async () => {
    const { withBoot } = bootDouble();
    const logger = {
      success: () => undefined,
      info: () => undefined,
      error: () => undefined,
    } as unknown as Parameters<typeof runPluginsOnMigrate>[0]["logger"];
    expect(
      await runPluginsOnMigrate({
        plugins: [plugin("@acme/a", vi.fn())],
        applied: 0,
        boot: BOOT,
        lifecycle: async () => new Map([["@acme/a", INSTALLED]]),
        logger,
        withBoot,
      })
    ).toBeNull();
  });
});
