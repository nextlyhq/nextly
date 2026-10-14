import type { PluginContext, PluginDatabase } from "@nextlyhq/plugin-sdk";

import type { AccountsCore } from "../core/ports";
import type { AccountsSettings } from "../settings";
import type { SessionLimits } from "../storage/sessions";

import type { AccountsMail } from "./mail";
import type { PasswordPacer } from "./pacer";

/** What every flow is given: the plugin's database, core's helpers, the site's settings, mail and a clock. */
export interface FlowDeps {
  readonly db: PluginDatabase;
  readonly dialect: PluginContext["dialect"];
  readonly core: AccountsCore;
  readonly settings: AccountsSettings;
  readonly mail: AccountsMail;
  /** What the flows tell other plugins, best-effort, after their work commits. */
  readonly events: AccountsEvents;
  /** Password checks, timed, and waits as long as one takes. */
  readonly pacer: PasswordPacer;
  readonly logger: {
    warn(message: string, context?: Record<string, unknown>): void;
  };
  readonly now: () => Date;
}

/**
 * The events the flows emit, with what each carries. Core requires a
 * plugin's events to begin with its own name.
 */
export interface AccountsEventPayloads {
  /** An account is gone: other plugins remove or anonymise what they hold for it. */
  "nextlyhq-plugin-accounts.account.deleted": { accountId: string };
  /** Staff deactivated an account: it signs in nowhere until reactivated. */
  "nextlyhq-plugin-accounts.account.deactivated": { accountId: string };
  /** Staff reactivated a deactivated account. */
  "nextlyhq-plugin-accounts.account.reactivated": { accountId: string };
}

/** The events the plugin declares, one per name it emits. */
export const ACCOUNTS_EVENTS = [
  "nextlyhq-plugin-accounts.account.deleted",
  "nextlyhq-plugin-accounts.account.deactivated",
  "nextlyhq-plugin-accounts.account.reactivated",
] as const satisfies ReadonlyArray<keyof AccountsEventPayloads>;

export interface AccountsEvents {
  emit<K extends keyof AccountsEventPayloads>(
    name: K,
    payload: AccountsEventPayloads[K]
  ): void;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** How long a session lasts, from the site's settings. */
export function sessionLimits(
  settings: Pick<AccountsSettings, "session">
): SessionLimits {
  return {
    idleMs: settings.session.idleHours * HOUR,
    absoluteMs: settings.session.absoluteDays * DAY,
    perAccount: settings.session.perAccount,
  };
}
