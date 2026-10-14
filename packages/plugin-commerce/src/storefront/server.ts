import { getCachedNextly, type PluginContext } from "@nextlyhq/plugin-sdk";

import type { CartService } from "../cart/cart-service";
import type { CheckoutService } from "../checkout/checkout-service";
import { PLUGIN_NAME } from "../schema/definition";

import type { CatalogueService } from "./catalogue-service";

/** The service keys commerce registers its typed functions under. */
export const CART_SERVICE = "cart";
export const CATALOGUE_SERVICE = "catalogue";
export const CHECKOUT_SERVICE = "checkout";

/**
 * Commerce's typed server functions: the cart and the catalogue, the same
 * actions the REST routes offer.
 *
 * @experimental
 */
export interface CommerceServer {
  readonly cart: CartService;
  readonly catalogue: CatalogueService;
  readonly checkout: CheckoutService;
}

/**
 * Where the started plugin keeps its context for `commerceServer`.
 *
 * On `globalThis` under a registered symbol, as core keeps its own booted
 * instance, rather than in a module variable: a Next.js build can load this
 * package more than once, in separate server bundles, and a module variable
 * set in one copy is empty in the others. The booted instance core hands
 * server code has no plugin namespace, so this is how server code with no
 * plugin context reaches commerce's functions at all.
 */
const INSTALLED = Symbol.for("@nextlyhq/plugin-commerce/installed");
const holder = globalThis as typeof globalThis & {
  [INSTALLED]?: PluginContext;
};

/** Record the started plugin's context. Called from `init`. */
export function rememberInstalled(ctx: PluginContext): void {
  holder[INSTALLED] = ctx;
}

/**
 * Forget the context a stopped plugin recorded, so `commerceServer` refuses
 * rather than answering with services over a closed database. Only that
 * context is forgotten: a newer boot that recorded its own before this one's
 * teardown ran keeps it.
 */
export function forgetInstalled(ctx: PluginContext): void {
  if (holder[INSTALLED] === ctx) delete holder[INSTALLED];
}

/**
 * Commerce's server functions, for server code with no plugin context: a
 * storefront page, a server action. The cart functions take the token from
 * the cart cookie and say what to do with the cookie after; the caller reads
 * and writes it. Waits for Nextly to finish starting first, so a call made
 * while the boot migrations run answers once they have.
 *
 * @experimental
 */
export async function commerceServer(): Promise<CommerceServer> {
  await getCachedNextly();
  return fromInstalled();
}

/** The started plugin's functions, from the context it recorded. */
export function fromInstalled(): CommerceServer {
  const ctx = holder[INSTALLED];
  if (!ctx) {
    throw new Error(
      `"${PLUGIN_NAME}" has not started. Add commerce() to defineConfig({ plugins: [...] }).`
    );
  }
  return commerceServices(ctx);
}

/**
 * Commerce's server functions, for another plugin, through its own context.
 *
 * @experimental
 */
export function commerceServices(ctx: PluginContext): CommerceServer {
  return fromNamespace(ctx.services.plugins[PLUGIN_NAME]);
}

// The plugins' namespace is typed `unknown` per service, so what came back is
// checked once here rather than cast at every call site.
function fromNamespace(
  services: Record<string, unknown> | undefined
): CommerceServer {
  const cart = services?.[CART_SERVICE];
  const catalogue = services?.[CATALOGUE_SERVICE];
  const checkout = services?.[CHECKOUT_SERVICE];
  if (
    !isCartService(cart) ||
    !isCatalogueService(catalogue) ||
    !isCheckoutService(checkout)
  ) {
    // Named rather than a generic missing-service message: the likely cause
    // is that commerce is not in the site's plugins.
    throw new Error(
      `"${PLUGIN_NAME}" is not installed, or is registered without its "${CART_SERVICE}" and "${CATALOGUE_SERVICE}" services. Add commerce() to defineConfig({ plugins: [...] }).`
    );
  }
  return { cart, catalogue, checkout };
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return methods.every(method => typeof record[method] === "function");
}

function isCartService(value: unknown): value is CartService {
  return hasMethods(value, ["get", "add", "setQuantity", "remove", "clear"]);
}

function isCatalogueService(value: unknown): value is CatalogueService {
  return hasMethods(value, ["find", "list"]);
}

function isCheckoutService(value: unknown): value is CheckoutService {
  return hasMethods(value, ["quote", "complete"]);
}
