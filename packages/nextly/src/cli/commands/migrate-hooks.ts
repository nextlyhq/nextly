/**
 * The plugins' `onMigrate`, run once a migrate has left nothing pending: the
 * generic point a plugin does the work a deploy owes once the schema is in
 * step, such as filling an index for content that existed before it. Core
 * runs it and knows nothing of what a plugin does there.
 *
 * Run after migrate's lock is released, last among the steps after it, as
 * the localization companions, the user fields' table and the workflow pass
 * are: two migrates can run the hooks at once, which `onMigrate` is declared
 * safe for. Booted only when an enabled, installed plugin declares the hook
 * (`withBootedPlugins`), so a migrate of a site with none boots nothing.
 *
 * @module cli/commands/migrate-hooks
 */

import type { PluginLifecycleRecord } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";

import {
  PLUGIN_HOOK_HANDLER_WAIT_MS,
  type PluginHookBootInputs,
  withBootedPlugins,
} from "./plugin-hook-boot";

/** How a run of the hooks went: who ran, who was skipped, who threw and why. */
export interface MigrateHooksOutcome {
  readonly ran: readonly string[];
  /** Declared but not installed on this database: nothing to run against. */
  readonly notInstalled: readonly string[];
  readonly failed: readonly { plugin: string; reason: string }[];
  /** Whether the event handlers the hooks set off finished in time. */
  readonly handlersFinished: boolean;
}

/** The enabled plugins declaring `onMigrate`, in config order. */
function pluginsWithOnMigrate(
  plugins: readonly PluginDefinition[]
): PluginDefinition[] {
  return plugins.filter(
    plugin => plugin.enabled !== false && typeof plugin.onMigrate === "function"
  );
}

/**
 * Run every enabled, installed plugin's `onMigrate`, in config order.
 *
 * Each runs against a boot of its own, in which only that plugin initialises,
 * as `nextly plugins install` boots for `onInstall` (`asLifecycleCommandBoot`):
 * a sibling not installed yet, which a first deploy's migrate meets before
 * `nextly plugins install`, is neither initialised nor refused there. A
 * plugin not installed on this database is skipped: its tables and state are
 * the install's to make, and its `onInstall` runs then.
 *
 * A hook that throws is reported and the next one still runs: one plugin's
 * failure is no reason to skip another's deploy work. Answers who ran, who
 * was skipped and who failed; the command turns a failure into its exit
 * code, and the schema it applied stays applied.
 */
export async function runOnMigrateHooks(args: {
  plugins: readonly PluginDefinition[];
  applied: number;
  boot: Omit<PluginHookBootInputs, "running" | "wrapBoot">;
  /** Each plugin's recorded state on this database (`readPluginLifecycle`). */
  lifecycle: () => Promise<ReadonlyMap<string, PluginLifecycleRecord>>;
  /** Injected for tests; the default boots the app. */
  withBoot?: typeof withBootedPlugins;
}): Promise<MigrateHooksOutcome> {
  const ran: string[] = [];
  const notInstalled: string[] = [];
  const failed: { plugin: string; reason: string }[] = [];
  let handlersFinished = true;
  const declaring = pluginsWithOnMigrate(args.plugins);
  // Nothing declares the hook: nothing is read and nothing boots.
  if (declaring.length === 0) {
    return { ran, notInstalled, failed, handlersFinished };
  }
  const states = await args.lifecycle();
  const { getEventBus } = await import("../../events/event-bus");
  const { asLifecycleCommandBoot } = await import(
    "../../domains/schema/ownership/plugin-lifecycle-state"
  );
  for (const plugin of declaring) {
    if (states.get(plugin.name)?.state !== "installed") {
      notInstalled.push(plugin.name);
      continue;
    }
    const cause = Symbol(`${plugin.name} onMigrate`);
    try {
      const booted = await (args.withBoot ?? withBootedPlugins)(
        {
          ...args.boot,
          wrapBoot: boot => asLifecycleCommandBoot(plugin.name, boot),
          running: {
            name: `${plugin.name}'s onMigrate`,
            logContext: { plugin: plugin.name, hook: "onMigrate" },
          },
        },
        cause,
        async contextOf => {
          const context = contextOf(plugin.name);
          // Registered but not initialised: nothing to run against.
          if (context === undefined) return false;
          await getEventBus().runCaused(cause, () =>
            plugin.onMigrate?.(context, { applied: args.applied })
          );
          return true;
        }
      );
      if (booted.value) ran.push(plugin.name);
      handlersFinished &&= booted.handlersFinished;
    } catch (error) {
      failed.push({
        plugin: plugin.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ran, notInstalled, failed, handlersFinished };
}

/**
 * `nextly migrate`'s step: run the hooks, say how each went, and answer the
 * failure the command ends with, or null. A failure is answered rather than
 * thrown, so the read-only notices after it still run, and the command ends
 * non-zero once they have.
 */
export async function runPluginsOnMigrate(args: {
  plugins: readonly PluginDefinition[];
  applied: number;
  boot: Omit<PluginHookBootInputs, "running" | "wrapBoot">;
  lifecycle: () => Promise<ReadonlyMap<string, PluginLifecycleRecord>>;
  logger: CommandContext["logger"];
  withBoot?: typeof withBootedPlugins;
}): Promise<NextlyError | null> {
  const outcome = await runOnMigrateHooks(args);
  for (const plugin of outcome.ran) {
    args.logger.success(`${plugin}: onMigrate done.`);
  }
  for (const plugin of outcome.notInstalled) {
    args.logger.info(
      `${plugin}: onMigrate not run, as it is not installed on this database; nextly plugins install runs its install.`
    );
  }
  for (const { plugin, reason } of outcome.failed) {
    args.logger.error(`${plugin}: onMigrate failed: ${reason}`);
  }
  if (outcome.failed.length > 0) {
    const names = outcome.failed.map(failure => failure.plugin).join(", ");
    return new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: `The schema was applied, but the after-migrate step of ${names} failed. Run nextly migrate again to finish it.`,
      logContext: {
        reason: "plugin-on-migrate-failed",
        plugins: outcome.failed.map(failure => failure.plugin),
      },
    });
  }
  if (!outcome.handlersFinished) {
    // Said, not failed: the hooks ran to their end and are written to run
    // again, so the next migrate picks up what a handler stopped part way
    // through had not finished.
    args.logger.warn(
      `Event handlers the plugins' onMigrate set off were still running after ${PLUGIN_HOOK_HANDLER_WAIT_MS / 1000}s and were stopped; the next nextly migrate runs the hooks again.`
    );
  }
  return null;
}
