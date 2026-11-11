/**
 * Redirects at request time: the site's Proxy asks this handler about every
 * page request, and it answers with the redirect that holds the address, if
 * any, before the page is served. A saved redirect is read from the database
 * on the next request, so it applies at once, on every instance.
 *
 * Which redirect answers is read from the address record, by the claim keys
 * of the address itself and of every range above it: one indexed read. An
 * address a page holds, exactly or in one of its ranges, is served, whatever
 * pattern covers it.
 *
 * @module redirects/proxy-handler
 */
import {
  addressOfRequest,
  languageAddressOf,
  type KeptAddress,
  type PluginContext,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import { claimKey, pathsAbove, recordSlug, rowOf } from "../address-record/participant";
import { notAPageAddress } from "../not-found/log";

import { destinationOf, pickRedirect, type HeldRow } from "./addresses";
import { redirectsSlug } from "./collection";
import { redirectOf, type StoredRedirect } from "./store";

/**
 * The request header a page renders with, naming the address that was asked
 * for, so the site's not-found page can log it (`logNotFound`).
 */
export const ASKED_FOR_HEADER = "x-nextly-seo-asked-for";

/** The redirect that answers `address`, if any. */
export async function redirectFor(
  ctx: PluginContext,
  address: KeptAddress
): Promise<StoredRedirect | undefined> {
  const { locale, path } = address;
  const keys = [
    claimKey("address", locale, path),
    ...[path, ...pathsAbove(path)].map(at => claimKey("range", locale, at)),
  ];
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: { claimKey: { in: keys } },
      pagination: { limit: keys.length, page: 1 },
      depth: 0,
    }
  );
  const redirects = redirectsSlug(ctx);
  const rows: HeldRow[] = (data as unknown[]).flatMap(entry => {
    const row = rowOf(entry);
    if (row.address === null || row.holder === null) return [];
    return [
      {
        path: row.address.path,
        range: row.address.range === true,
        redirect:
          row.holder.collection === redirects ? row.holder.id : null,
      },
    ];
  });
  const id = pickRedirect(path, rows);
  if (id === null) return undefined;
  try {
    return redirectOf(
      await ctx.services.ownCollections.findEntryById(redirects, id)
    );
  } catch {
    // Removed between the two reads: the address is answered as if it had
    // never had one.
    return undefined;
  }
}

/** Where `redirect` sends a request for `url`, kept in `locale`, as a full address. */
async function locationOf(
  redirect: StoredRedirect,
  address: KeptAddress,
  url: URL
): Promise<string> {
  const sent = destinationOf(redirect, address.path);
  let location: URL;
  if (sent.startsWith("/")) {
    const served = await languageAddressOf(sent, address.locale);
    const path = served.status === "resolved" ? served.path : sent;
    const origin =
      served.status === "resolved" && served.origin !== undefined
        ? served.origin
        : url.origin;
    location = new URL(path, origin);
  } else {
    location = new URL(sent);
  }
  // The visitor's own query goes with them, unless the To address names one.
  if (location.search === "" && url.search !== "") location.search = url.search;
  return location.toString();
}

/** The handler the plugin contributes to the site's Proxy. */
export function redirectsProxyHandler(): PluginProxyHandler {
  return {
    name: "redirects",
    async handle(request, ctx) {
      const url = new URL(request.url);
      if (
        (request.method !== "GET" && request.method !== "HEAD") ||
        notAPageAddress(url.pathname)
      ) {
        // Emptied rather than left alone: a value a visitor sent in this
        // header themselves must never be logged as an address asked for.
        return { requestHeaders: { [ASKED_FOR_HEADER]: "" } };
      }
      const asked = await addressOfRequest(url);
      // `/old/` is the address `/old`, as a From address is stored.
      const address =
        asked !== undefined && asked.path.length > 1 && asked.path.endsWith("/")
          ? { ...asked, path: asked.path.slice(0, -1) }
          : asked;
      const redirect =
        address === undefined ? undefined : await redirectFor(ctx, address);
      if (redirect !== undefined && address !== undefined) {
        return {
          response: new Response(null, {
            status: redirect.permanent ? 301 : 302,
            headers: { location: await locationOf(redirect, address, url) },
          }),
        };
      }
      // The page is served; should it be found missing, its not-found page
      // reads which address was asked for from this.
      return {
        requestHeaders: { [ASKED_FOR_HEADER]: `${url.origin}${url.pathname}` },
      };
    },
  };
}
