import type { PasswordCheck } from "../core/ports";

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
