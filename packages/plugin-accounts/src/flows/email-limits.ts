import { LIMIT_RULES } from "../core/limit-rules";
import type { LimitEntry } from "../core/ports";

import type { FlowDeps } from "./deps";

/** A request that sends an email, as the limits answer it. */
export type EmailRequestVerdict =
  | { status: "admitted" }
  | { status: "refused"; reason: "too-many-requests"; retryAfterMs: number }
  /** The limit store did not answer: nothing is sent rather than sent uncounted. */
  | { status: "refused"; reason: "try-again" };

/**
 * Reserves a request that sends an email against its address's limit for
 * its kind and the client's limit for all kinds together, before any of
 * its work runs. The address is the normalised one, whether or not it has
 * an account. A client whose network address cannot be read is held to the
 * address's limit alone, never to one count every such visitor shares.
 */
export async function reserveEmailRequest(
  deps: Pick<FlowDeps, "core">,
  input: {
    rule: typeof LIMIT_RULES.signUpAddress | typeof LIMIT_RULES.resendAddress;
    addressKey: string;
    client: string | null;
  }
): Promise<EmailRequestVerdict> {
  const entries: LimitEntry[] = [{ rule: input.rule, key: input.addressKey }];
  if (input.client !== null)
    entries.push({ rule: LIMIT_RULES.emailClient, key: input.client });

  const reservation = await deps.core.limits.reserve(entries);
  if (reservation.status === "admitted") return { status: "admitted" };
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };

  return {
    status: "refused",
    reason: "too-many-requests",
    retryAfterMs: reservation.retryAfterMs,
  };
}
