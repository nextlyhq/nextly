import { LIMIT_RULES } from "../core/limit-rules";
import type { PasswordCheck } from "../core/ports";
import type { AccountChange } from "../storage/accounts";

import type { FlowDeps } from "./deps";

/** Why a new password was refused, said to the visitor. */
export type NewPasswordRefusal = Extract<
  PasswordCheck,
  { ok: false }
>["reason"];

/**
 * A new password against the site's own rules, its length and the common
 * passwords, which nothing outside the process is asked about. Run before a
 * request is counted, so a mistyped password costs the visitor none of the
 * address's requests. Null when it passes.
 */
export async function localPasswordRefusal(
  deps: Pick<FlowDeps, "core" | "settings">,
  password: string
): Promise<NewPasswordRefusal | null> {
  const check = await deps.core.passwords.check(password, {
    minLength: deps.settings.passwordMinLength,
    breached: false,
  });

  return check.ok ? null : check.reason;
}

/**
 * Where the site checks breached passwords, a new password that passed the
 * local rules against its source; run only once the request is counted, so
 * no one can make the site ask the source without limit. A password the
 * source could not be asked about is accepted under the other rules, and
 * that is logged. Null when it passes.
 */
export async function breachedPasswordRefusal(
  deps: Pick<FlowDeps, "core" | "settings" | "logger">,
  password: string
): Promise<NewPasswordRefusal | null> {
  if (!deps.settings.breachedPasswordCheck) return null;
  const check = await deps.core.passwords.check(password, {
    minLength: deps.settings.passwordMinLength,
    breached: true,
  });
  if (!check.ok) return check.reason;
  if (check.breachedCheck === "unavailable") {
    deps.logger.warn(
      "[accounts] a new password went unchecked: the breached-password source did not answer"
    );
  }

  return null;
}

/** Why an account's new password was refused: a rule it broke, or its lookup not counted. */
export type AccountPasswordRefusal =
  | { status: "refused"; reason: NewPasswordRefusal }
  | { status: "refused"; reason: "too-many-requests"; retryAfterMs: number }
  | { status: "refused"; reason: "try-again" };

/**
 * An existing account's new password, in a reset or a change, against the
 * site's rules: the local ones first, then, where the site checks breached
 * passwords, the source, once the lookup is counted against the account.
 * Neither a reset link nor a signed-in session is spent by a refused
 * password, so without the count one of them could make the site ask the
 * source without limit. Null when it passes.
 */
export async function accountPasswordRefusal(
  deps: Pick<FlowDeps, "core" | "settings" | "logger">,
  accountId: string,
  password: string
): Promise<AccountPasswordRefusal | null> {
  const local = await localPasswordRefusal(deps, password);
  if (local !== null) return { status: "refused", reason: local };
  if (deps.settings.breachedPasswordCheck) {
    const counted = await deps.core.limits.reserve([
      { rule: LIMIT_RULES.newPasswordAccount, key: accountId },
    ]);
    if (counted.status === "unavailable")
      return { status: "refused", reason: "try-again" };
    if (counted.status === "refused")
      return {
        status: "refused",
        reason: "too-many-requests",
        retryAfterMs: counted.retryAfterMs,
      };
  }
  const breached = await breachedPasswordRefusal(deps, password);

  return breached === null ? null : { status: "refused", reason: breached };
}

/**
 * What a new password writes to its account, in a change and a reset
 * alike: the hash, when it changed, and the failures in a row and the
 * reset-required state started again, since the password they were about
 * is gone.
 */
export function passwordReplaced(
  passwordHash: string,
  now: Date
): AccountChange {
  return {
    passwordHash,
    passwordChangedAt: now,
    failuresInARow: 0,
    resetRequiredAt: null,
  };
}
