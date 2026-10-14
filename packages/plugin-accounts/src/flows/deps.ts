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
  /** Password checks, timed, and waits as long as one takes. */
  readonly pacer: PasswordPacer;
  readonly logger: {
    warn(message: string, context?: Record<string, unknown>): void;
  };
  readonly now: () => Date;
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
