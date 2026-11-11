/**
 * Addresses as people see them and as redirects keep them: a person types
 * and reads an address as a visitor opens it (`/de/alt` on a site with
 * language prefixes), and a redirect keeps it by language and kept path.
 * The screen's routes and the file import both turn one into the other here.
 *
 * @module redirects/served
 */
import {
  addressOfRequest,
  languageAddressOf,
  type KeptAddress,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

/** The site path a screen address stands for: without a query or fragment. */
function onThisSite(text: string): boolean {
  const value = text.trim();
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * The language and kept path a request for `url` asks for. An address no
 * language serves by the site's rule (an unprefixed one on a site whose
 * every language is prefixed, as a site's addresses from before it had
 * languages are) is read in the default language: the address an old link
 * still asks for, which is what a redirect and the not-found log are for.
 */
export async function askedAddress(
  ctx: PluginContext,
  url: URL
): Promise<KeptAddress> {
  return (
    (await addressOfRequest(url)) ?? {
      locale: await ctx.publicAddresses.defaultLanguage(),
      path: url.pathname,
    }
  );
}

/**
 * The language and kept path an address a person typed stands for, as a
 * visitor would open it on `origin`, or the text unchanged where it is not a
 * path on this site (for `putRedirect` to refuse or keep as it is).
 */
export async function keptFrom(
  ctx: PluginContext,
  text: string,
  origin: string
): Promise<{ locale?: string; path: string }> {
  const value = text.trim();
  if (!onThisSite(value) || /[\s?#]/.test(value)) return { path: value };
  return askedAddress(ctx, new URL(value, origin));
}

/** An address kept in `locale` as a visitor opens it, a pattern's `*` kept. */
export async function servedOf(path: string, locale: string): Promise<string> {
  if (!onThisSite(path)) return path;
  const served = await languageAddressOf(path, locale);
  if (served.status !== "resolved") return path;
  return served.origin === undefined
    ? served.path
    : `${served.origin}${served.path}`;
}
