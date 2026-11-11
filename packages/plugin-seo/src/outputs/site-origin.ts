/**
 * The site's origin, as every output that names the site's own addresses
 * reads it: the sitemap, robots.txt, llms.txt and each page's plain-text
 * copy.
 *
 * @module outputs/site-origin
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { productionAddressesOf } from "../canonical";
import type { ReadRules } from "../resolver/provider";

/**
 * The site's origin for a request that reached `asked`: one of the site's
 * production addresses, as the page's head reads them, the one the request
 * reached where it is among them; else the configured origin; else none,
 * where only the request's own origin is left.
 */
export async function siteOriginFor(
  asked: string,
  ctx: PluginContext,
  config: { origin?: string; readRules: ReadRules }
): Promise<string | undefined> {
  const production = productionAddressesOf(
    (await config.readRules(ctx, undefined)).productionAddresses
  );
  return (
    production.find(address => address === asked) ??
    production[0] ??
    config.origin
  );
}
