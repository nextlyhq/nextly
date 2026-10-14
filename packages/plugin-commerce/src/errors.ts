import { NextlyError } from "@nextlyhq/plugin-sdk";

/**
 * The codes commerce raises, each in the plugin's own namespace so a caller can
 * branch on them without matching core's codes.
 *
 * @experimental
 */
export type CommerceErrorCode =
  /** A currency code that is not an ISO 4217 currency a store can sell in. */
  | "COMMERCE_UNKNOWN_CURRENCY"
  /** An amount that is not a whole number of minor units, or not a safe integer. */
  | "COMMERCE_INVALID_AMOUNT"
  /** Two amounts in different currencies combined in one operation. */
  | "COMMERCE_CURRENCY_MISMATCH"
  /** Weights for an allocation that are negative, fractional or all zero. */
  | "COMMERCE_INVALID_ALLOCATION"
  /** An operation identifier that cannot be sent to a provider as its key. */
  | "COMMERCE_INVALID_OPERATION_ID"
  /** A provider asked for an operation its capabilities do not offer. */
  | "COMMERCE_UNSUPPORTED_OPERATION"
  /** A provider whose declaration and methods disagree, or that answered outside the contract. */
  | "COMMERCE_PROVIDER_CONTRACT"
  /** An operation key reused for a different request. */
  | "COMMERCE_OPERATION_KEY_REUSED"
  /** A webhook whose signature, timestamp or body does not verify. */
  | "COMMERCE_WEBHOOK_INVALID"
  /** An operation the payment's current state does not allow, such as capturing a paid payment. */
  | "COMMERCE_PAYMENT_STATE"
  /** A payment larger than the provider accepts in one charge. */
  | "COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT"
  /** A reference the catalogue source does not know. */
  | "COMMERCE_ITEM_NOT_FOUND"
  /** An item with no listed price, which is asked about for a quote rather than bought from a cart. */
  | "COMMERCE_PRICE_ON_REQUEST"
  /** A quantity more than the item allows on one line. */
  | "COMMERCE_QUANTITY_NOT_ALLOWED"
  /** A cart already holding as many lines as a cart may. */
  | "COMMERCE_CART_FULL"
  /** A cart that kept changing under a request until it gave up. */
  | "COMMERCE_CART_BUSY"
  /** A catalogue source that failed to answer. */
  | "COMMERCE_CATALOGUE_UNAVAILABLE"
  /** A catalogue source that cannot be browsed, only looked up by reference. */
  | "COMMERCE_CATALOGUE_NOT_LISTABLE"
  /** A stored catalogue entry whose values the catalogue cannot carry, such as a fractional price. */
  | "COMMERCE_CATALOGUE_ENTRY_INVALID";

/**
 * Raise a commerce error.
 *
 * The public message is generic and fixed per code, so nothing a caller passed
 * (an amount, a provider's raw answer) is echoed back to a client; the detail
 * goes to `logContext`, which only operators see.
 */
export function commerceError(
  code: CommerceErrorCode,
  logContext?: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code,
    publicMessage: PUBLIC_MESSAGES[code],
    statusCode: STATUS_CODES[code],
    logContext,
  });
}

const PUBLIC_MESSAGES: Record<CommerceErrorCode, string> = {
  COMMERCE_UNKNOWN_CURRENCY: "The currency is not supported.",
  COMMERCE_INVALID_AMOUNT: "The amount is not valid.",
  COMMERCE_CURRENCY_MISMATCH: "The amounts are in different currencies.",
  COMMERCE_INVALID_ALLOCATION: "The amount cannot be divided as requested.",
  COMMERCE_INVALID_OPERATION_ID: "The operation identifier is not valid.",
  COMMERCE_UNSUPPORTED_OPERATION:
    "The payment provider does not support this operation.",
  COMMERCE_PROVIDER_CONTRACT:
    "The provider answered in a way commerce cannot use.",
  COMMERCE_OPERATION_KEY_REUSED:
    "The operation key was already used for a different request.",
  COMMERCE_WEBHOOK_INVALID: "The webhook could not be verified.",
  COMMERCE_PAYMENT_STATE: "The payment cannot do that in its current state.",
  COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT:
    "The amount is more than the payment provider accepts in one payment.",
  COMMERCE_ITEM_NOT_FOUND: "The item is not in the catalogue.",
  COMMERCE_PRICE_ON_REQUEST:
    "The item's price is given on request; ask for a quote instead.",
  COMMERCE_QUANTITY_NOT_ALLOWED:
    "That quantity of the item cannot be added to one line.",
  COMMERCE_CART_FULL: "The cart cannot hold any more lines.",
  COMMERCE_CART_BUSY: "The cart changed while it was being updated; try again.",
  COMMERCE_CATALOGUE_UNAVAILABLE:
    "The catalogue could not be reached; try again.",
  COMMERCE_CATALOGUE_NOT_LISTABLE: "The catalogue cannot be browsed.",
  COMMERCE_CATALOGUE_ENTRY_INVALID:
    "A product is stored in a way commerce cannot use.",
};

// A provider's broken answer is the server's fault, not the caller's, so it
// maps to 502 like any other bad upstream reply. Bad input maps to 400. An
// operation the provider cannot do, a key reused for another request and an
// operation the payment's state forbids are conflicts with existing state: 409.
// So are an on-request item, a full cart and a cart that kept changing: the
// request was well formed, and the state it met refused it. An unknown item is
// 404, as for any resource that does not exist. A catalogue source that failed
// to answer is an outage of something the request depends on: 503. Browsing a
// catalogue that only looks items up is a well-formed request its source
// cannot serve: 409, like an operation a payment provider does not offer. A
// product stored in a shape the catalogue cannot carry is the store's own data
// at fault, not the caller's and not an upstream's: 500.
const STATUS_CODES: Record<CommerceErrorCode, number> = {
  COMMERCE_UNKNOWN_CURRENCY: 400,
  COMMERCE_INVALID_AMOUNT: 400,
  COMMERCE_CURRENCY_MISMATCH: 400,
  COMMERCE_INVALID_ALLOCATION: 400,
  COMMERCE_INVALID_OPERATION_ID: 400,
  COMMERCE_UNSUPPORTED_OPERATION: 409,
  COMMERCE_PROVIDER_CONTRACT: 502,
  COMMERCE_OPERATION_KEY_REUSED: 409,
  COMMERCE_WEBHOOK_INVALID: 400,
  COMMERCE_PAYMENT_STATE: 409,
  COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT: 400,
  COMMERCE_ITEM_NOT_FOUND: 404,
  COMMERCE_PRICE_ON_REQUEST: 409,
  COMMERCE_QUANTITY_NOT_ALLOWED: 400,
  COMMERCE_CART_FULL: 409,
  COMMERCE_CART_BUSY: 409,
  COMMERCE_CATALOGUE_UNAVAILABLE: 503,
  COMMERCE_CATALOGUE_NOT_LISTABLE: 409,
  COMMERCE_CATALOGUE_ENTRY_INVALID: 500,
};
