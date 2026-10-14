import {
  NextlyError,
  respondDoc,
  respondList,
  respondMutation,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import type { CartResult, CartService } from "../cart/cart-service";
import {
  cartCookieHeader,
  clearCartCookieHeader,
  readCartToken,
} from "../cart/token";
import { parseRequest, readJsonBody } from "../request-input";

import {
  MAX_FIND_REFERENCES,
  type CatalogueService,
} from "./catalogue-service";

/** What the routes need from the plugin, resolved per request. */
export interface StorefrontRuntime {
  /** Whether the cart cookie is `Secure`, with the `__Host-` name. */
  readonly secureCookies: boolean;
  /** Whether the configured source can be browsed, so the listing route exists. */
  readonly listable: boolean;
  /** How many cart changes one client may make in a window. */
  readonly writeLimit: { readonly max: number; readonly windowMs: number };
  cart(ctx: PluginContext): CartService;
  catalogue(ctx: PluginContext): CatalogueService;
}

/**
 * How often one client may call each cart write route unless the site says
 * otherwise. Reads take core's general allowance; writes take a tighter one,
 * since each may call the catalogue source and write rows. Core counts it per
 * route and method, and per process until it shares its limiter between
 * instances.
 */
export const DEFAULT_CART_WRITE_LIMIT = { max: 60, windowMs: 60_000 };

// A JSON body with a line's fields. Anything else in it, such as a price or a
// cart id a page sent, is dropped here and never reaches the cart: the cart
// takes prices only from the catalogue source, and finds a cart only by its
// cookie.
const lineBody = z.object({
  reference: z.string(),
  quantity: z.number(),
});

/**
 * The storefront's REST routes, mirroring the typed server functions.
 *
 * Every route is public, since shoppers are anonymous, and answers
 * `no-store`, since every answer is one shopper's or priced at that moment.
 * The route's own CSRF option checks only callers with a session cookie, so
 * every write checks the request itself with `verifyCsrf`, as the first thing
 * it does: an anonymous shopper's cart is exactly what a cross-site form
 * would otherwise be able to change.
 */
export function storefrontRoutes(runtime: StorefrontRuntime): PluginRoute[] {
  const secure = runtime.secureCookies;

  function respond(result: CartResult, message: string | null): Response {
    const headers = new Headers();
    const cookie = result.cookie;
    if (cookie.action === "set") {
      headers.append(
        "set-cookie",
        cartCookieHeader({
          token: cookie.token,
          expiresAt: cookie.expiresAt,
          now: new Date(),
          secure,
        })
      );
    } else if (cookie.action === "clear") {
      headers.append("set-cookie", clearCartCookieHeader(secure));
    }
    return message === null
      ? respondDoc(result.cart, { headers })
      : respondMutation(message, result.cart, { headers });
  }

  function cartWrite(
    method: PluginRoute["method"],
    path: string,
    write: (
      cart: CartService,
      token: string | null,
      req: Request
    ) => Promise<CartResult>,
    message: string
  ): PluginRoute {
    return {
      method,
      path,
      public: true,
      noStore: true,
      rateLimit: { ...runtime.writeLimit },
      handler: async (req, ctx) => {
        await assertSameSiteWrite(req, ctx);
        const result = await write(
          runtime.cart(ctx),
          readCartToken(req, secure),
          req
        );
        return respond(result, message);
      },
    };
  }

  const routes: PluginRoute[] = [
    {
      method: "GET",
      path: "/cart",
      public: true,
      noStore: true,
      rateLimit: "general",
      handler: async (req, ctx) =>
        respond(
          await runtime.cart(ctx).get({ token: readCartToken(req, secure) }),
          null
        ),
    },
    cartWrite(
      "POST",
      "/cart/lines",
      async (cart, token, req) => {
        const body = parseRequest(lineBody, await readJsonBody(req));
        return cart.add({
          token,
          reference: body.reference,
          quantity: body.quantity,
        });
      },
      "Added to the cart."
    ),
    cartWrite(
      "PATCH",
      "/cart/lines",
      async (cart, token, req) => {
        const body = parseRequest(lineBody, await readJsonBody(req));
        return cart.setQuantity({
          token,
          reference: body.reference,
          quantity: body.quantity,
        });
      },
      "Cart updated."
    ),
    cartWrite(
      "DELETE",
      "/cart/lines",
      async (cart, token, req) =>
        cart.remove({
          token,
          // A reference may hold any character, a `/` included, so it travels
          // in the query rather than as a path segment.
          reference: new URL(req.url).searchParams.get("reference") ?? "",
        }),
      "Removed from the cart."
    ),
    cartWrite(
      "DELETE",
      "/cart",
      async (cart, token) => cart.clear({ token }),
      "Cart emptied."
    ),
    {
      method: "GET",
      path: "/catalogue/items",
      public: true,
      noStore: true,
      rateLimit: "general",
      handler: async (req, ctx) => {
        const references = new URL(req.url).searchParams.getAll("reference");
        const items = await runtime.catalogue(ctx).find({ references });
        // One page holding every item found: a lookup by reference is never
        // paged, and it asks for at most `MAX_FIND_REFERENCES`.
        return respondList([...items], {
          total: items.length,
          page: 1,
          limit: MAX_FIND_REFERENCES,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        });
      },
    },
  ];

  if (runtime.listable) {
    routes.push({
      method: "GET",
      path: "/catalogue",
      public: true,
      noStore: true,
      rateLimit: "general",
      handler: async (req, ctx) => {
        const query = new URL(req.url).searchParams;
        const limit = query.get("limit");
        const cursor = query.get("cursor");
        const search = query.get("search");
        // A source pages by cursor and knows no total, so a page is answered
        // as the document it is, items with the cursor to the next, rather
        // than as a numbered page of a known total.
        return respondDoc(
          await runtime.catalogue(ctx).list({
            ...(limit === null ? {} : { limit: wholeNumber(limit) }),
            ...(cursor === null ? {} : { cursor }),
            ...(search === null ? {} : { search }),
          })
        );
      },
    });
  }

  return routes;
}

/**
 * Refuse a write that did not come from the site's own pages: core's origin
 * check and double-submit CSRF token, the same validation core's own routes
 * use.
 */
async function assertSameSiteWrite(
  req: Request,
  ctx: PluginRouteContext
): Promise<void> {
  const verdict = await ctx.auth.verifyCsrf(req);
  if (!verdict.valid) {
    throw NextlyError.csrfFailed({
      logMessage: "A storefront cart write failed the CSRF check.",
      logContext: { reason: verdict.reason },
    });
  }
}

// A query value is text; one that is not a whole number is passed on as NaN,
// which the catalogue's own input check refuses with the rest of its rules.
function wholeNumber(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
