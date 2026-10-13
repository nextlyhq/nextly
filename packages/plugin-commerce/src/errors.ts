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
  | "COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT";

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
};

// A provider's broken answer is the server's fault, not the caller's, so it
// maps to 502 like any other bad upstream reply. Bad input maps to 400. An
// operation the provider cannot do, a key reused for another request and an
// operation the payment's state forbids are conflicts with existing state: 409.
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
};
