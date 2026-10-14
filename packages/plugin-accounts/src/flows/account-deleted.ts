import type { FlowDeps } from "./deps";

/**
 * Tells other plugins an account is gone, so they remove or anonymise what
 * they hold for it. Every path that deletes an account calls it, once the
 * deletion has committed: the holder's own deletion, staff's, the "this
 * wasn't me" link and the sweep of accounts nobody verified. An account a
 * site lets sign in unverified may hold data elsewhere by the time the
 * link or the sweep removes it.
 */
export function accountDeleted(
  deps: Pick<FlowDeps, "events">,
  accountId: string
): void {
  deps.events.emit("nextlyhq-plugin-accounts.account.deleted", { accountId });
}
