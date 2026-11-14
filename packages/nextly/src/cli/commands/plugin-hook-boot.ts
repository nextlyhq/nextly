/**
 * Booting the app inside a CLI command to run plugin hooks against it: the
 * one way a command builds a `PluginContext`, shared by `nextly plugins
 * install`/`uninstall` (`onInstall`, `onUninstall`) and `nextly migrate`
 * (`onMigrate`).
 *
 * The hook takes a `PluginContext`, and the only thing that builds one is
 * `registerServices`, so running a hook means booting the runtime, which no
 * other part of a command does. Kept proportionate by its callers, which boot
 * only when a plugin actually declares the hook, and here, which:
 *
 * - reuses the adapter the command already opened, so the boot makes no
 *   second connection;
 * - turns migrations-on-boot off: a command running hooks has done, or is
 *   doing, its own migrating, and a boot that migrated again would apply a
 *   module behind the command's back;
 * - tears the boot down in a `finally`, so a hook that fails, or a boot that
 *   fails part way, leaves no running plugins or registered container
 *   behind. `destroyRegisteredPlugins` and `clearServices`, not
 *   `shutdownServices`: the latter disconnects the adapter, which the command
 *   is still using (and on MySQL, releasing the connection drops a migrate
 *   lock bound to it).
 *
 * Every plugin's `init()` runs during the boot, which is the point: a hook is
 * documented as running against a booted context, and one booted without its
 * siblings is not the context the plugin lives in.
 *
 * @module cli/commands/plugin-hook-boot
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginConsent } from "../../plugins/plugin-consent";
import type { PluginContext } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";

/**
 * How long a command waits, after a plugin's hook, for the event handlers it
 * set off before shutting the runtime down: long enough for a deletion's
 * follow-up work, short enough that one handler that never settles cannot
 * hold the command open.
 */
export const PLUGIN_HOOK_HANDLER_WAIT_MS = 30_000;

/** What a command hands the boot: the app as it wrote it, and its open adapter. */
export interface PluginHookBootInputs {
  /** The config as the app wrote it, before any `setup` transformer ran. */
  appConfig: SanitizedNextlyConfig;
  /** The grants the loader read before any `setup` transformer ran. */
  pluginConsent: PluginConsent;
  adapter: DrizzleAdapter;
  logger: CommandContext["logger"];
  /** The project `--cwd` names, whose Next.js and React the start judges. */
  projectRoot: string;
  /** Wraps the boot, as the lifecycle command's install-state gate does. */
  wrapBoot?: (boot: () => Promise<void>) => Promise<void>;
  /**
   * What is run, as a refusal names it ("@acme/notes's onInstall"), and the
   * log context it carries.
   */
  running: { name: string; logContext: Record<string, unknown> };
}

/**
 * Boot the app, run `work` with a way to read each initialized plugin's
 * context, then wait for the event handlers set off under `cause` and tear
 * the boot down. Answers whether those handlers finished within
 * {@link PLUGIN_HOOK_HANDLER_WAIT_MS}, and what `work` answered.
 *
 * Refuses when this process already has a registration: one this command did
 * not make is not its to tear down.
 */
export async function withBootedPlugins<T>(
  inputs: PluginHookBootInputs,
  cause: symbol,
  work: (contextOf: (name: string) => PluginContext | undefined) => Promise<T>
): Promise<{ value: T; handlersFinished: boolean }> {
  const {
    registerServices,
    getInitializedPluginContext,
    clearServices,
    destroyRegisteredPlugins,
  } = await import("../../di/register");
  const { isServicesRegistered } = await import("../../di/service-access");
  const { buildServiceConfig } = await import(
    "../../init/build-service-config"
  );
  const { getImageProcessor } = await import("../../storage/image-processor");
  const { getHookRegistry } = await import("../../hooks/hook-registry");
  const { getEventBus } = await import("../../events/event-bus");

  if (isServicesRegistered()) {
    throw new NextlyError({
      code: "CONFLICT",
      publicMessage: `Services are already registered in this process, so ${inputs.running.name} was not run.`,
      logContext: {
        reason: "plugin-hook-services-registered",
        ...inputs.running.logContext,
      },
    });
  }

  // The handlers of the events the hooks set off are let finish before the
  // teardown, their own follow-up events included: emitting is
  // fire-and-forget, and torn down under them, that work would stop part
  // way. Only those traced to the hooks, for a bounded time, once on every
  // path out.
  let settled = false;
  const settle = (): Promise<boolean> => {
    settled = true;
    return getEventBus().settleCaused(cause, PLUGIN_HOOK_HANDLER_WAIT_MS);
  };
  try {
    // Inside the `try`, so the cleanup covers a registration that fails part
    // way: plugins initialize before registration finishes, so one that
    // throws after that point leaves their `init()` work running with the
    // registered flag never set.
    const boot = async (): Promise<void> => {
      await registerServices({
        ...buildServiceConfig({
          // The config as the app wrote it. The boot runs every `setup`
          // transformer and contribution fold itself; booting from a config
          // that holds their result ran each twice.
          config: {
            ...inputs.appConfig,
            db: { ...inputs.appConfig.db, runMigrationsOnBoot: false },
          },
          pluginConsent: inputs.pluginConsent,
          adapter: inputs.adapter,
          imageProcessor: getImageProcessor(),
          hookRegistry: getHookRegistry(),
          logger: inputs.logger,
        }),
        appRoot: inputs.projectRoot,
      });
    };
    await (inputs.wrapBoot === undefined ? boot() : inputs.wrapBoot(boot));
    const value = await work(name => getInitializedPluginContext(name));
    const handlersFinished = await settle();
    return { value, handlersFinished };
  } finally {
    if (!settled) await settle();
    await destroyRegisteredPlugins();
    clearServices();
  }
}
