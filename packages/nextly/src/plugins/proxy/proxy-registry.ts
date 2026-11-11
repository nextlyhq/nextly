/**
 * The proxy handlers plugins contribute, checked at boot and kept with each
 * plugin's context, and the one place a request is put to all of them.
 *
 * @module plugins/proxy/proxy-registry
 * @experimental
 */
import type { PluginContext, PluginDefinition } from "../plugin-context";
import { resolutionError } from "../resolution-error";

import type { PluginProxyHandler } from "./proxy-types";

/** A handler collected from a plugin, ready to register. */
export interface CollectedProxyHandler {
  pluginName: string;
  handler: PluginProxyHandler;
}

/** A registered handler, with the context it is handed. */
interface RegisteredProxyHandler extends CollectedProxyHandler {
  ctx: PluginContext;
}

/**
 * Every enabled plugin's `contributes.proxy`, in plugin order, each checked:
 * a handler with no name, a name the plugin uses twice, or no `handle`
 * function fails the boot. Checked rather than trusted to the type, since a
 * plugin authored in JavaScript reaches here unchecked.
 */
export function collectProxyHandlers(
  plugins: readonly PluginDefinition[]
): CollectedProxyHandler[] {
  const collected: CollectedProxyHandler[] = [];
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const seen = new Set<string>();
    for (const handler of plugin.contributes?.proxy ?? []) {
      seen.add(checkedName(plugin.name, handler, seen));
      collected.push({ pluginName: plugin.name, handler });
    }
  }
  return collected;
}

/** The name of `handler`, refused where it cannot be registered. */
function checkedName(
  pluginName: string,
  handler: PluginProxyHandler,
  seen: ReadonlySet<string>
): string {
  const name: unknown = handler?.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw resolutionError(
      "invalid-proxy-handler",
      `Plugin "${pluginName}" contributes a proxy handler with no name`,
      { pluginName }
    );
  }
  if (typeof handler.handle !== "function") {
    throw resolutionError(
      "invalid-proxy-handler",
      `Plugin "${pluginName}" contributes the proxy handler "${name}" with no handle function`,
      { pluginName, handler: name }
    );
  }
  if (seen.has(name)) {
    throw resolutionError(
      "duplicate-proxy-handler",
      `Plugin "${pluginName}" contributes two proxy handlers named "${name}"`,
      { pluginName, handler: name }
    );
  }
  return name;
}

/**
 * Register each collected handler with the context its plugin was started
 * with. A handler whose plugin has no context (one that never started) is
 * left out.
 */
export function registerProxyHandlers(
  collected: readonly CollectedProxyHandler[],
  contexts: ReadonlyMap<string, PluginContext>
): void {
  for (const each of collected) {
    const ctx = contexts.get(each.pluginName);
    if (ctx) registerProxyHandler(each, ctx);
  }
}

/**
 * The registered handlers, on `globalThis` like the route registry, so a
 * module evaluated more than once (Next.js and Turbopack can) still reads
 * the list the boot filled.
 */
const shared = globalThis as unknown as {
  __nextly_proxyHandlers?: RegisteredProxyHandler[];
};
shared.__nextly_proxyHandlers ??= [];
const registered = shared.__nextly_proxyHandlers;

/** Forget every handler, as each boot does before registering its own. */
export function clearProxyHandlers(): void {
  registered.length = 0;
}

/** Register a collected handler with its plugin's context. */
export function registerProxyHandler(
  collected: CollectedProxyHandler,
  ctx: PluginContext
): void {
  registered.push({ ...collected, ctx });
}

/** Whether any plugin contributes a handler, so a site with none does no work. */
export function hasProxyHandlers(): boolean {
  return registered.length > 0;
}

/**
 * Set each of `from`'s headers on `into` under its lower-case name: header
 * names are case-insensitive, so a later plugin's value for a header replaces
 * an earlier one's however either spells it.
 */
function mergeHeaders(
  into: Record<string, string>,
  from: Record<string, string> | undefined
): void {
  for (const [name, value] of Object.entries(from ?? {})) {
    into[name.toLowerCase()] = value;
  }
}

/** What every handler said about one request, put together. */
export interface CombinedProxyAnswer {
  response?: Response;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
}

/**
 * Put `request` to every registered handler, all at once, and combine their
 * answers in plugin order: the first response answers, and headers are
 * merged, a later handler's value for one replacing an earlier one's. A
 * handler that throws is logged through its own plugin's logger and passed
 * over, so one plugin's failure never stops the site serving pages.
 */
export async function answerProxyRequest(
  request: Request
): Promise<CombinedProxyAnswer> {
  const handlers = [...registered];
  const answers = await Promise.all(
    handlers.map(async ({ pluginName, handler, ctx }) => {
      try {
        return await handler.handle(request, ctx);
      } catch (error) {
        ctx.logger.error("A proxy handler failed; the request goes on", {
          plugin: pluginName,
          handler: handler.name,
          error,
        });
        return undefined;
      }
    })
  );
  const combined: CombinedProxyAnswer = { headers: {}, requestHeaders: {} };
  for (const answer of answers) {
    if (answer === undefined || answer === null) continue;
    if (combined.response === undefined && answer.response !== undefined) {
      combined.response = answer.response;
    }
    mergeHeaders(combined.headers, answer.headers);
    mergeHeaders(combined.requestHeaders, answer.requestHeaders);
  }
  return combined;
}
