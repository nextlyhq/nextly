import { respondAction } from "@nextlyhq/plugin-sdk";

import { accountsError, type AccountsErrorCode } from "../errors";

/** The code each flow's refusal is answered with. */
const REFUSALS: Record<string, AccountsErrorCode> = {
  "invalid-name": "ACCOUNTS_INVALID_INPUT",
  "invalid-address": "ACCOUNTS_INVALID_INPUT",
  "too-short": "ACCOUNTS_INVALID_INPUT",
  "too-long": "ACCOUNTS_INVALID_INPUT",
  common: "ACCOUNTS_INVALID_INPUT",
  breached: "ACCOUNTS_INVALID_INPUT",
  "same-address": "ACCOUNTS_SAME_ADDRESS",
  "wrong-credentials": "ACCOUNTS_WRONG_CREDENTIALS",
  wait: "ACCOUNTS_WAIT",
  "too-many-requests": "ACCOUNTS_TOO_MANY_REQUESTS",
  "try-again": "ACCOUNTS_TRY_AGAIN",
  deactivated: "ACCOUNTS_DEACTIVATED",
  unverified: "ACCOUNTS_UNVERIFIED",
  invalid: "ACCOUNTS_LINK_REFUSED",
  expired: "ACCOUNTS_LINK_REFUSED",
  spent: "ACCOUNTS_LINK_REFUSED",
  "wrong-code": "ACCOUNTS_WRONG_CODE",
  "too-many-tries": "ACCOUNTS_TOO_MANY_TRIES",
  "sign-in-needed": "ACCOUNTS_SIGN_IN_NEEDED",
  taken: "ACCOUNTS_ADDRESS_TAKEN",
};

/** A flow's refusal, as every flow shapes it. */
interface Refusal {
  status: "refused";
  reason: string;
  retryAfterMs?: number;
  triesLeft?: number;
}

/**
 * Throws a flow's refusal as its stable code, with what a caller may branch
 * on: the reason, a wait in whole seconds, or the tries left.
 */
export function refuse(refusal: Refusal): never {
  const code = REFUSALS[refusal.reason] ?? "ACCOUNTS_INVALID_INPUT";
  const data: Record<string, unknown> = { reason: refusal.reason };
  if (refusal.retryAfterMs !== undefined)
    data.retryAfterSeconds = Math.ceil(refusal.retryAfterMs / 1000);
  if (refusal.triesLeft !== undefined) data.triesLeft = refusal.triesLeft;

  throw accountsError(code, { reason: refusal.reason }, data);
}

/** A flow's answer, or its refusal thrown. */
export function unlessRefused<T extends { status: string }>(
  result: T
): Exclude<T, { status: "refused" }> {
  if (result.status === "refused") refuse(result as T & Refusal);
  return result as Exclude<T, { status: "refused" }>;
}

/**
 * The endpoints' answer: the canonical action body, never cached (it can
 * carry account data), and the cookies it sets or clears.
 */
export function answer(
  message: string,
  result: Record<string, unknown>,
  cookies: readonly string[] = []
): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);

  return respondAction(message, result, { headers });
}

/** A request's JSON body as an object, or an empty one for anything else. */
export async function bodyOf(
  request: Request
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A string field of a body, or the empty string, which every flow refuses where it needs one. */
export function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}
