/**
 * What a plugin contributes to the site's Proxy (`contributes.proxy`): a
 * handler asked about every request the app's `proxy.ts` sends through
 * `createNextlyProxy`, before the page is served.
 *
 * @module plugins/proxy/proxy-types
 * @experimental
 */
import type { PluginContext } from "../plugin-context";

/**
 * @experimental What a proxy handler says about one request. Every part is
 * optional, and an answer with none, like `undefined`, leaves the request as
 * it was.
 */
export interface ProxyAnswer {
  /**
   * Answer the request with this response instead of serving the page, as a
   * redirect does. The first handler, in plugin order, to give one answers.
   */
  response?: Response;
  /**
   * Headers set on whatever is served: the page, prerendered ones included,
   * or the response a handler answered with. A later plugin's value for a
   * header replaces an earlier one's.
   */
  headers?: Record<string, string>;
  /**
   * Headers added to the request the page is rendered for, which the page
   * reads with `headers()`. Never sent to the visitor.
   */
  requestHeaders?: Record<string, string>;
}

/**
 * @experimental One handler of `contributes.proxy`.
 *
 * It runs on every request the site's Proxy matches, so keep it short: a
 * page waits for every handler before it is served. A handler that throws is
 * logged and passed over, and the page is served as if it had answered
 * nothing.
 */
export interface PluginProxyHandler {
  /** Names the handler in logs. Unique within the plugin. */
  name: string;
  /**
   * Asked about `request` with the plugin's own context. Return what to do,
   * or nothing to leave the request alone.
   */
  handle(
    request: Request,
    ctx: PluginContext
  ): ProxyAnswer | undefined | Promise<ProxyAnswer | undefined>;
}
