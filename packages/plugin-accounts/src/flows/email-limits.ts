import { LIMIT_RULES } from "../core/limit-rules";
import type { LimitEntry } from "../core/ports";

import type { FlowDeps } from "./deps";

/**
 * A request that sends an email, as the limits answer it. Admitted, it
 * says whether the address's own limit had room: with known-browser tokens
 * that limit refuses nothing, and decides only whether an address that is
 * none of the tokens' accounts is emailed.
 */
export type EmailRequestVerdict =
  | { status: "admitted"; addressHadRoom: boolean }
  | { status: "refused"; reason: "too-many-requests"; retryAfterMs: number }
  /** The limit store did not answer: nothing is sent rather than sent uncounted. */
  | { status: "refused"; reason: "try-again" };

/** The type of {@link EMAIL_REQUESTS}, its rules named by reference. */
type EmailRequests = {
  readonly signUp: {
    readonly address: typeof LIMIT_RULES.signUpAddress;
    readonly token: null;
  };
  readonly resend: {
    readonly address: typeof LIMIT_RULES.resendAddress;
    readonly token: typeof LIMIT_RULES.resendToken;
  };
  readonly reset: {
    readonly address: typeof LIMIT_RULES.resetAddress;
    readonly token: typeof LIMIT_RULES.resetToken;
  };
};

/** Each kind of request that sends an email: its address's rule, and its tokens' where it takes them. */
export const EMAIL_REQUESTS: EmailRequests = {
  signUp: { address: LIMIT_RULES.signUpAddress, token: null },
  resend: {
    address: LIMIT_RULES.resendAddress,
    token: LIMIT_RULES.resendToken,
  },
  reset: { address: LIMIT_RULES.resetAddress, token: LIMIT_RULES.resetToken },
};

/**
 * Reserves a request that sends an email, before any of its work runs,
 * against the client's limit for every kind together and its address's
 * limit for its kind. The address is the normalised one, whether or not it
 * has an account. A request carrying known-browser tokens is also counted
 * against every token, held to the same numbers, and refused once any is
 * at its limit; its address is counted once admitted and while it has room,
 * but never refuses it, so the answer depends on the tokens and the client
 * alone, whatever address it names. A client whose network address cannot
 * be read is held to the other limits, never to one count every such
 * visitor shares.
 */
export async function reserveEmailRequest(
  deps: Pick<FlowDeps, "core">,
  input: {
    kind: (typeof EMAIL_REQUESTS)[keyof typeof EMAIL_REQUESTS];
    addressKey: string;
    client: string | null;
    /** The hashes of the valid known-browser tokens the request carries. */
    tokenHashes?: readonly string[];
  }
): Promise<EmailRequestVerdict> {
  const tokenRule = input.kind.token;
  const tokens = tokenRule === null ? [] : (input.tokenHashes ?? []);
  const entries: LimitEntry[] = [
    {
      rule: input.kind.address,
      key: input.addressKey,
      enforce: tokens.length === 0,
    },
  ];
  if (tokenRule !== null) {
    for (const key of tokens) entries.push({ rule: tokenRule, key });
  }
  if (input.client !== null)
    entries.push({ rule: LIMIT_RULES.emailClient, key: input.client });

  const reservation = await deps.core.limits.reserve(entries);
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };
  if (reservation.status === "refused") {
    return {
      status: "refused",
      reason: "too-many-requests",
      retryAfterMs: reservation.retryAfterMs,
    };
  }

  return {
    status: "admitted",
    addressHadRoom: reservation.reservation.entries[0]?.hadRoom === true,
  };
}
