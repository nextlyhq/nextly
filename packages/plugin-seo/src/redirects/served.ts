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

/** Whether `text` is a path on this site: it starts with one `/`. */
function onThisSite(text: string): boolean {
  const value = text.trim();
  return value.startsWith("/") && !value.startsWith("//");
}

/** `text` as an http(s) address, or undefined. */
function absoluteUrl(text: string): URL | undefined {
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
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
 * The language and kept path of a full address on one of the domains the
 * site's rule gives a language, or undefined for any other site's: the
 * address must be the one that language serves its path at, origin and all,
 * since a request is read on any host.
 */
async function onLanguageDomain(url: URL): Promise<KeptAddress | undefined> {
  const kept = await addressOfRequest(url);
  if (kept === undefined) return undefined;
  const served = await languageAddressOf(kept.path, kept.locale);
  return served.status === "resolved" && served.origin === url.origin
    ? kept
    : undefined;
}

/**
 * The language and kept path an address a person typed stands for, as a
 * visitor would open it on `origin`, its query and fragment kept on the
 * path. A full address on one of the site's language domains is read in
 * that language. Anything else (an address on another site, text that is no
 * address) comes back unchanged, for `putRedirect` to refuse or keep as it is.
 */
export async function keptFrom(
  ctx: PluginContext,
  text: string,
  origin: string
): Promise<{ locale?: string; path: string }> {
  const value = text.trim();
  if (/\s/.test(value)) return { path: value };
  const absolute = absoluteUrl(value);
  if (absolute !== undefined) {
    const kept = await onLanguageDomain(absolute);
    return kept === undefined
      ? { path: value }
      : {
          locale: kept.locale,
          path: `${kept.path}${absolute.search}${absolute.hash}`,
        };
  }
  if (!onThisSite(value)) return { path: value };
  const url = new URL(value, origin);
  const kept = await askedAddress(ctx, url);
  return { ...kept, path: `${kept.path}${url.search}${url.hash}` };
}

/**
 * The origin a person's relative address is read on, beside `served`: the
 * origin of a full address (another language's domain), or `fallback`.
 */
export function originBeside(served: string, fallback: string): string {
  return absoluteUrl(served)?.origin ?? fallback;
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
