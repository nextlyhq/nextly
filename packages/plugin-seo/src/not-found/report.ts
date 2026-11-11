/**
 * What a site's not-found page calls to log the address that was not found.
 *
 * The site's Proxy passes the address a page was asked for on to its render
 * in a request header; the not-found page hands its request headers here,
 * and the address is counted in the log. A request the Proxy did not pass
 * on (the admin, the API, an asset, or a site without the Proxy) carries no
 * such header and is not logged.
 *
 * @module not-found/report
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { ASKED_FOR_HEADER } from "../redirects/proxy-handler";

import { recordNotFound } from "./log";

/**
 * The SEO plugin's context, once it has started, on `globalThis` so the
 * not-found page reaches it even where its module is evaluated apart from
 * the one the plugin started in.
 */
const shared = globalThis as unknown as {
  __nextly_seoPluginContext?: PluginContext;
};

/** Keep the started plugin's context for {@link logNotFound}. */
export function keepSeoContext(ctx: PluginContext): void {
  shared.__nextly_seoPluginContext = ctx;
}

/** Anything that reads a request header by name, as `headers()` does. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Log that the address this request asked for was not found. Call it from
 * the site's not-found page with its request headers:
 *
 * ```tsx
 * import { headers } from "next/headers";
 * import { logNotFound } from "@nextlyhq/plugin-seo";
 *
 * export default async function NotFound() {
 *   await logNotFound(await headers());
 *   return <h1>Page not found</h1>;
 * }
 * ```
 *
 * It never throws: a log that cannot be written must not break the page.
 */
export async function logNotFound(headers: HeaderReader): Promise<void> {
  const ctx = shared.__nextly_seoPluginContext;
  const asked = headers.get(ASKED_FOR_HEADER);
  if (ctx === undefined || asked === null || asked === "") return;
  try {
    await recordNotFound(ctx, new URL(asked).pathname);
  } catch (error) {
    ctx.logger.warn("An address not found could not be logged", { error });
  }
}

/** The started plugin's context, if it has started: for the plugin's own code and tests. */
export function keptSeoContext(): PluginContext | undefined {
  return shared.__nextly_seoPluginContext;
}
