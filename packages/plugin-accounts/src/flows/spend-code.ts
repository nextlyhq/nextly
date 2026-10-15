import { LIMIT_RULES } from "../core/limit-rules";
import type { SecretData } from "../core/ports";

import type { FlowDeps } from "./deps";

/** Why a typed code was refused. */
export type CodeRefusal =
  | { status: "refused"; reason: "invalid" | "expired" | "spent" | "try-again" }
  | { status: "refused"; reason: "wrong-code"; triesLeft: number }
  | { status: "refused"; reason: "too-many-tries"; retryAfterMs: number };

/**
 * Spends a typed code. The try is first reserved against the address's
 * tries in 24 hours (`addressKey`, normalised), across every code sent to
 * it; the code is then spent on its own, outside any transaction, so no
 * rollback gives a wrong try back; a right code gives its try back,
 * whatever the flow does next.
 */
export async function spendCode(
  deps: Pick<FlowDeps, "core">,
  input: { addressKey: string; purpose: string; subject: string; code: string }
): Promise<{ status: "spent"; data: SecretData | null } | CodeRefusal> {
  const { core } = deps;
  const reservation = await core.limits.reserve([
    { rule: LIMIT_RULES.codeTries, key: input.addressKey },
  ]);
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };
  if (reservation.status === "refused") {
    return {
      status: "refused",
      reason: "too-many-tries",
      retryAfterMs: reservation.retryAfterMs,
    };
  }

  const spent = await core.secrets.consumeCode({
    purpose: input.purpose,
    subject: input.subject,
    code: input.code,
  });
  if (!spent.ok) {
    return spent.reason === "wrong"
      ? { status: "refused", reason: "wrong-code", triesLeft: spent.triesLeft }
      : {
          status: "refused",
          reason: spent.reason === "none" ? "invalid" : spent.reason,
        };
  }
  await core.limits.release(reservation.reservation);

  return { status: "spent", data: spent.data };
}
