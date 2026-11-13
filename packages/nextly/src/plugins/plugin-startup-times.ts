/**
 * How long each plugin's own start-up code took (its `init` and `onReady`), and the line a start
 * logs about the slow ones.
 *
 * A plugin's start-up code runs inside every cold start, before Nextly serves, and Nextly cannot
 * make it faster: what it can do is say which plugin took the time. The core's work on a plugin's
 * behalf (sealing its stored settings) is not counted, nor is work a hook starts without waiting
 * for it.
 *
 * @module plugins/plugin-startup-times
 */

/** A plugin whose start-up code takes longer than this is named at every start. */
export const SLOW_PLUGIN_STARTUP_MS = 500;

/** Each plugin's start-up time, in milliseconds, summed over its hooks. */
export class PluginStartupTimes {
  private readonly times = new Map<string, number>();

  /** Run one of `plugin`'s start-up hooks, adding the time it took to the plugin's. */
  async time<T>(plugin: string, hook: () => Promise<T> | T): Promise<T> {
    const began = performance.now();
    try {
      return await hook();
    } finally {
      this.times.set(
        plugin,
        (this.times.get(plugin) ?? 0) + (performance.now() - began)
      );
    }
  }

  /**
   * Log every plugin's time at debug level, and a warning naming each plugin over
   * {@link SLOW_PLUGIN_STARTUP_MS} with its time. Nothing is warned when none is.
   */
  report(logger: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
  }): void {
    if (this.times.size === 0) return;
    const rounded = [...this.times].map(
      ([plugin, ms]) => [plugin, Math.round(ms)] as const
    );
    logger.debug?.(
      `[nextly] Plugin start-up times: ${rounded
        .map(([plugin, ms]) => `"${plugin}" ${ms} ms`)
        .join(", ")}.`
    );
    const slow = rounded.filter(([, ms]) => ms > SLOW_PLUGIN_STARTUP_MS);
    if (slow.length === 0) return;
    logger.warn?.(
      `[nextly] Plugin start-up took longer than ${SLOW_PLUGIN_STARTUP_MS} ms: ${slow
        .map(([plugin, ms]) => `"${plugin}" ${ms} ms`)
        .join(", ")}. Every cold start waits for it before Nextly serves.`
    );
  }
}
