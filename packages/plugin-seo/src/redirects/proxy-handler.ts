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
 * for, so a route that answers not found can log it (`notFoundLogged`).
 */
export const ASKED_FOR_HEADER = "x-nextly-seo-asked-for";

/**
 * The request header naming one request the Proxy let through, so a request
 * whose page and head both answer not found is counted once.
 */
export const REQUEST_HEADER = "x-nextly-seo-request";

/**
 * The request headers the App Router's client sends on a prefetch, which asks
 * for a page ahead of a visit that may never come. Next.js keeps them from
 * the render's `headers()`, so only the Proxy can tell a prefetch apart.
 */
const PREFETCH_HEADERS = [
  "next-router-prefetch",
  "next-router-segment-prefetch",
];

/** Whether `request` is the App Router prefetching a page rather than showing it. */
function isPrefetch(request: Request): boolean {
  return PREFETCH_HEADERS.some(name => request.headers.get(name) !== null);
}

/** What a request no log is for is passed on with: both headers emptied. */
const NOT_LOGGED = { [ASKED_FOR_HEADER]: "", [REQUEST_HEADER]: "" };

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

/** What an address that is gone for good answers with no page of the site's: 410, and a line. */
function plainGoneResponse(): Response {
  return new Response("This page is gone.", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** How long the site's own Gone page may take to answer before the plain one is sent. */
const GONE_PAGE_TIMEOUT_MS = 5_000;

/** How the Proxy answers an address made Gone. */
export interface GoneAnswerOptions {
  /**
   * The address of the site's own page for a Gone answer, such as `/gone`,
   * already checked to be an address from the site's root.
   */
  gonePage?: string;
  /** Reads the site's page; `fetch` unless a test gives another. */
  fetchPage?: (url: URL, init: RequestInit) => Promise<Response>;
}

/**
 * What an address that is gone for good answers: the site's own page where
 * it names one, read from the site and sent with status 410, else a short
 * plain page. The plain page also answers where the site's page can't be
 * read or doesn't answer 200, and where the address asked for is that page
 * itself, which would otherwise read itself.
 */
async function goneResponse(
  url: URL,
  asked: KeptAddress,
  options: GoneAnswerOptions
): Promise<Response> {
  const { gonePage } = options;
  if (gonePage === undefined || asked.path === gonePage) {
    return plainGoneResponse();
  }
  try {
    const read = options.fetchPage ?? ((at, init) => fetch(at, init));
    const page = await read(new URL(gonePage, url.origin), {
      headers: { accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(GONE_PAGE_TIMEOUT_MS),
    });
    if (page.status !== 200) return plainGoneResponse();
    return new Response(await page.text(), {
      status: 410,
      headers: {
        "content-type":
          page.headers.get("content-type") ?? "text/html; charset=utf-8",
      },
    });
  } catch {
    // The page couldn't be read: the visitor still gets the Gone answer.
    return plainGoneResponse();
  }
}

/**
 * The handler the plugin contributes to the site's Proxy, answering from
 * `keys`: the plugin forgets them when a redirect saved here commits. Each
 * request a redirect answers is counted on it by `hits`, in the background.
 * An address made Gone is answered as `gone` says.
 */
export function redirectsProxyHandler(
  keys: HeldRedirectKeys = heldRedirectKeys(),
  hits: RedirectHits = redirectHits(),
  gone: GoneAnswerOptions = {}
): PluginProxyHandler {
  const seen = proxySeenNotes();
  return {
    name: "redirects",
    async handle(request, ctx) {
      // Noted in the background, so the admin can tell the Proxy runs.
      void seen.note(ctx);
      const url = new URL(request.url);
      const address = await pageAddressOf(ctx, request, url);
      if (address === "not-a-page") {
        // Emptied rather than left alone: a value a visitor sent in this
        // header themselves must never be logged as an address asked for.
        return { requestHeaders: NOT_LOGGED };
      }
      const redirect = (await keys.mayMeet(ctx, address))
        ? await redirectFor(ctx, address)
        : undefined;
      if (redirect?.gone === true) {
        hits.note(ctx, redirect.id);
        return { response: await goneResponse(url, address, gone) };
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
      // A prefetch is served as any request is, but nobody has asked to see
      // the page yet, so a miss it meets is not logged: the visit, if it
      // comes, is its own request.
      if (isPrefetch(request)) return { requestHeaders: NOT_LOGGED };
      // The page is served; should a route find it missing, its not-found
      // answer reads which address was asked for from this.
      return {
        requestHeaders: {
          [ASKED_FOR_HEADER]: `${url.origin}${url.pathname}`,
          [REQUEST_HEADER]: crypto.randomUUID(),
        },
      };
    },
  };
}
