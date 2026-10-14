import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { version as PLUGIN_VERSION } from "../package.json";

import { createCartService, type CartService } from "./cart/cart-service";
import { cartExpiryJob } from "./cart/expiry-job";
import {
  DEFAULT_CART_LIFETIME_DAYS,
  MAX_CART_LIFETIME_DAYS,
} from "./cart/lifetime";
import { productsCollection } from "./catalogue/products-collection";
import { createProductsSource } from "./catalogue/products-source";
import {
  assertCatalogueSource,
  type CatalogueSource,
} from "./contracts/catalogue-source";
import { assertCurrency } from "./money/currency";
import { parseRequest } from "./request-input";
import { commerceSchema, PLUGIN_NAME } from "./schema/definition";
import { SCHEMA_VERSION } from "./schema/tables";
import {
  createCatalogueService,
  type CatalogueService,
} from "./storefront/catalogue-service";
import {
  DEFAULT_CART_WRITE_LIMIT,
  storefrontRoutes,
} from "./storefront/routes";
import {
  CART_SERVICE,
  CATALOGUE_SERVICE,
  forgetInstalled,
  rememberInstalled,
} from "./storefront/server";

/**
 * What a site passes to `commerce()`.
 *
 * @experimental
 */
export interface CommerceOptions {
  /** The store's ISO 4217 currency. Every price and cart is in it. */
  readonly currency: string;
  /**
   * The site's own catalogue source, such as an outside product API. Without
   * one, commerce contributes a products collection and sells from it.
   */
  readonly catalogue?: CatalogueSource;
  /** The built-in products collection's slug. Defaults to `products`. */
  readonly productsSlug?: string;
  /**
   * How many days a cart lives after its last change. 30 by default, at
   * most 365. A change to it reaches each cart at that cart's next change.
   */
  readonly cartLifetimeDays?: number;
  /**
   * Whether the cart cookie is `Secure`, under the `__Host-` name. On in
   * production by default, off otherwise, since a browser drops a `Secure`
   * cookie a plain-HTTP development server sets.
   */
  readonly secureCookies?: boolean;
  /**
   * How many requests one client may make to each cart write route in a
   * window: 60 a minute by default. Core counts a route's own allowance per
   * route and method, so adding lines, setting them, removing one and
   * emptying the cart each have this allowance. A site whose shoppers share a
   * network address, as behind a corporate proxy, may need it higher.
   */
  readonly cartWriteLimit?: { readonly max: number; readonly windowMs: number };
}

const optionsSchema = z.object({
  currency: z.string(),
  catalogue: z.unknown().optional(),
  productsSlug: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,62}$/, "a lower-case slug")
    .optional(),
  cartLifetimeDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_CART_LIFETIME_DAYS)
    .optional(),
  secureCookies: z.boolean().optional(),
  cartWriteLimit: z
    .strictObject({
      max: z.number().int().positive(),
      windowMs: z.number().int().positive(),
    })
    .optional(),
});

/**
 * Commerce for a Nextly site: its tables, the catalogue it sells from, the
 * server-side cart, and the routes and typed functions a storefront uses.
 *
 * @experimental
 * @throws `VALIDATION_ERROR` for options of the wrong shape,
 *   `COMMERCE_UNKNOWN_CURRENCY` for a currency a store cannot sell in, and
 *   `COMMERCE_PROVIDER_CONTRACT` for a malformed catalogue source
 */
export function commerce(options: CommerceOptions) {
  const parsed = parseRequest(optionsSchema, options, { plugin: PLUGIN_NAME });
  assertCurrency(parsed.currency);
  const own = options.catalogue;
  if (own !== undefined) assertCatalogueSource(own);

  const currency = parsed.currency;
  const productsSlug = parsed.productsSlug ?? "products";
  const lifetimeDays = parsed.cartLifetimeDays ?? DEFAULT_CART_LIFETIME_DAYS;
  const secureCookies =
    parsed.secureCookies ?? process.env.NODE_ENV === "production";

  /**
   * The installed context, for the expiry job: a job handler is given no
   * plugin context, and `contributes` is built before there is one. Set in
   * `init`, which runs before any job can.
   */
  let installed: PluginContext | null = null;
  const requireInstalled = (): PluginContext => {
    if (installed === null) {
      throw new Error(
        "[commerce] the cart expiry job ran before the plugin started, so it has no database to sweep"
      );
    }
    return installed;
  };

  function sourceFor(ctx: PluginContext): CatalogueSource {
    if (own !== undefined) return own;
    return createProductsSource({
      collections: ctx.services.collections,
      slug: ctx.self.collections[productsSlug] ?? productsSlug,
      currency,
    });
  }

  function cartFor(ctx: PluginContext): CartService {
    return createCartService({
      db: ctx.db,
      source: sourceFor(ctx),
      currency,
      lifetimeDays,
    });
  }

  function catalogueFor(ctx: PluginContext): CatalogueService {
    return createCatalogueService({ source: sourceFor(ctx), currency });
  }

  return definePlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    // Every package versions in lockstep, so a core at least as new as this
    // build carries every API it calls.
    nextly: `>=${PLUGIN_VERSION}`,
    schemaVersion: SCHEMA_VERSION,
    init(ctx) {
      installed = ctx;
      rememberInstalled(ctx);
    },
    destroy() {
      if (installed) forgetInstalled(installed);
      installed = null;
    },
    contributes: {
      schema: commerceSchema,
      // The built-in catalogue only when the site has none of its own, so a
      // site selling from an outside API gets no empty products screen.
      collections: own === undefined ? [productsCollection(productsSlug)] : [],
      jobs: [cartExpiryJob({ db: () => requireInstalled().db })],
      services: {
        [CART_SERVICE]: ctx => cartFor(ctx),
        [CATALOGUE_SERVICE]: ctx => catalogueFor(ctx),
      },
      routes: storefrontRoutes({
        secureCookies,
        writeLimit: parsed.cartWriteLimit ?? DEFAULT_CART_WRITE_LIMIT,
        listable: own === undefined ? true : typeof own.list === "function",
        cart: cartFor,
        catalogue: catalogueFor,
      }),
    },
  });
}
