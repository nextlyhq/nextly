/**
 * Redirects at request time: the site's Proxy asks this handler about every
 * page request, and it answers with the redirect that holds the address, if
 * any, before the page is served.
 *
 * A request no redirect is for, nearly every one, is passed without reading
 * the database: the addresses redirects hold are kept in this process
 * (`held-keys`). Only an address one of them matches is read, from the
 * address record by the claim keys of the address itself and of every range
 * above it, which decides the redirect: an address a page holds, exactly or
 * in one of its ranges, is served, whatever pattern covers it. A saved
 * redirect applies at once on the server that saved it, and within
 * `REDIRECT_KEYS_REFRESH_MS` on every other.
 *
 * @module redirects/proxy-handler
 */
import {
  languageAddressOf,
  type KeptAddress,
  type PluginContext,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import { notAPageAddress } from "../not-found/page-address";

import { destinationOf, withQuery } from "./addresses";
import { redirectsSlug } from "./collection";
import { heldRedirectKeys, type HeldRedirectKeys } from "./held-keys";
import { redirectHits, type RedirectHits } from "./hits";
import { redirectMeeting } from "./meeting";
import { proxySeenNotes } from "./proxy-seen";
import { askedAddress } from "./served";
import { redirectOf, type StoredRedirect } from "./store";

/**
 * The request header a page renders with, naming the address that was asked
 * for, so the site's not-found page can log it (`logNotFound`).
 */
export const ASKED_FOR_HEADER = "x-nextly-seo-asked-for";

/**
 * The request header naming one request the Proxy let through, so a
 * not-found page Next.js renders more than once for it is counted once.
 */
export const REQUEST_HEADER = "x-nextly-seo-request";

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

/** What an address that is gone for good answers: 410, and a line to read. */
function goneResponse(): Response {
  return new Response("This page is gone.", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * The handler the plugin contributes to the site's Proxy, answering from
 * `keys`: the plugin forgets them when a redirect saved here commits. Each
 * request a redirect answers is counted on it by `hits`, in the background.
 */
export function redirectsProxyHandler(
  keys: HeldRedirectKeys = heldRedirectKeys(),
  hits: RedirectHits = redirectHits()
): PluginProxyHandler {
  const seen = proxySeenNotes();
  return {
    name: "redirects",
    async handle(request, ctx) {
      // Noted in the background, so the admin can tell the Proxy runs.
      seen.note(ctx);
      const url = new URL(request.url);
      const address = await pageAddressOf(ctx, request, url);
      if (address === "not-a-page") {
        // Emptied rather than left alone: a value a visitor sent in this
        // header themselves must never be logged as an address asked for.
        return {
          requestHeaders: { [ASKED_FOR_HEADER]: "", [REQUEST_HEADER]: "" },
        };
      }
      const redirect = (await keys.mayMeet(ctx, address))
        ? await redirectFor(ctx, address)
        : undefined;
      if (redirect?.gone === true) {
        hits.note(ctx, redirect.id);
        return { response: goneResponse() };
      }
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
        hits.note(ctx, redirect.id);
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
        requestHeaders: {
          [ASKED_FOR_HEADER]: `${url.origin}${url.pathname}`,
          [REQUEST_HEADER]: crypto.randomUUID(),
        },
      };
    },
  };
}
