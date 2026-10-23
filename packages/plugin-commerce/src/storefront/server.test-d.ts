/**
 * The typed server functions' signatures, as a storefront's server code
 * calls them.
 *
 * A type test, because what it pins is only observable to the compiler: that
 * the functions take a cart token or `null` and never a cart id, that a cart
 * result says what to do with the cookie in one of exactly three ways, and
 * that the catalogue's answers are the view types, not the source's own. The
 * assertions are assignments the checker evaluates, so a signature that
 * drifts fails `pnpm check-types` here rather than passing quietly.
 *
 * @module storefront/server.test-d
 */
import type { CartCookieAction, CartResult } from "../cart/cart-service";
import type { CartView } from "../cart/view";

import type { CatalogueItemView, CataloguePageView } from "./catalogue-service";
import type {
  commerceServer,
  commerceServices,
  CommerceServer,
} from "./server";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const serverAnswers: Equal<
  Awaited<ReturnType<typeof commerceServer>>,
  CommerceServer
> = true;
const servicesAnswer: Equal<
  ReturnType<typeof commerceServices>,
  CommerceServer
> = true;

type Cart = CommerceServer["cart"];

// A cart is found by its token alone: no function takes a cart id.
const addTakes: Equal<
  Parameters<Cart["add"]>[0],
  {
    readonly token: string | null;
    readonly reference: string;
    readonly quantity: number;
  }
> = true;
const getTakes: Equal<
  Parameters<Cart["get"]>[0],
  { readonly token: string | null }
> = true;
const clearTakes: Equal<
  Parameters<Cart["clear"]>[0],
  { readonly token: string | null }
> = true;

const addAnswers: Equal<Awaited<ReturnType<Cart["add"]>>, CartResult> = true;
const resultHolds: Equal<
  CartResult,
  { readonly cart: CartView; readonly cookie: CartCookieAction }
> = true;
const cookieActions: Equal<
  CartCookieAction["action"],
  "keep" | "set" | "clear"
> = true;

type Catalogue = CommerceServer["catalogue"];
const findAnswers: Equal<
  Awaited<ReturnType<Catalogue["find"]>>,
  readonly CatalogueItemView[]
> = true;
const listAnswers: Equal<
  Awaited<ReturnType<Catalogue["list"]>>,
  CataloguePageView
> = true;

export const assertions: true[] = [
  serverAnswers,
  servicesAnswer,
  addTakes,
  getTakes,
  clearTakes,
  addAnswers,
  resultHolds,
  cookieActions,
  findAnswers,
  listAnswers,
];
