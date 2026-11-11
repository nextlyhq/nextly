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
  languageAddressOf,
  type KeptAddress,
  type PluginContext,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import { notAPageAddress } from "../not-found/log";

import { destinationOf, withQuery } from "./addresses";
import { redirectsSlug } from "./collection";
import { redirectMeeting } from "./meeting";
import { askedAddress } from "./served";
import { redirectOf, type StoredRedirect } from "./store";

/**
 * The request header a page renders with, naming the address that was asked
 * for, so the site's not-found page can log it (`logNotFound`).
 */
export const ASKED_FOR_HEADER = "x-nextly-seo-asked-for";

/** The redirect that answers `address`, if any. */
async function redirectFor(
  ctx: PluginContext,
  address: KeptAddress
): Promise<StoredRedirect | undefined> {
  const id = await redirectMeeting(ctx, address);
  if (id === null) return undefined;
  try {
    return redirectOf(
      await ctx.services.ownCollections.findEntryById(redirectsSlug(ctx), id)
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
  // The visitor's own query goes with them, unless the To address names one.
  const sent = withQuery(destinationOf(redirect, address.path), url.search);
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
  return location.toString();
}

/**
 * The language and kept path a page request asks for, without a trailing
 * slash, as a From address is stored: `/old/` is the address `/old`. None
 * for a request no redirect or log is for: one that only reads no page, or
 * one for the admin, the API or an asset.
 */
async function pageAddressOf(
  ctx: PluginContext,
  request: Request,
  url: URL
): Promise<KeptAddress | "not-a-page"> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return "not-a-page";
  }
  if (notAPageAddress(url.pathname)) return "not-a-page";
  const asked = await askedAddress(ctx, url);
  if (asked.path.length <= 1 || !asked.path.endsWith("/")) return asked;
  return { ...asked, path: asked.path.slice(0, -1) };
}

/** The handler the plugin contributes to the site's Proxy. */
export function redirectsProxyHandler(): PluginProxyHandler {
  return {
    name: "redirects",
    async handle(request, ctx) {
      const url = new URL(request.url);
      const address = await pageAddressOf(ctx, request, url);
      if (address === "not-a-page") {
        // Emptied rather than left alone: a value a visitor sent in this
        // header themselves must never be logged as an address asked for.
        return { requestHeaders: { [ASKED_FOR_HEADER]: "" } };
      }
      const redirect = await redirectFor(ctx, address);
      const location =
        redirect !== undefined
          ? await locationOf(redirect, address, url)
          : undefined;
      // A redirect to the very address asked for would answer it again and
      // again, as one to this site's own full address would: it is served.
      if (
        redirect !== undefined &&
        location !== undefined &&
        location !== url.href
      ) {
        return {
          response: new Response(null, {
            status: redirect.permanent ? 301 : 302,
            headers: { location },
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
