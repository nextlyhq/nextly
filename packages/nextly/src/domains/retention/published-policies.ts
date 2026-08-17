/**
 * The retention policies a hot reload can replace, in one list.
 *
 * A runner captures its policy when it is BUILT, and a runner built at boot
 * outlives every reload — so a window saved in development would keep pruning
 * on the previous value until restart. That includes a change to `false`, where
 * the stale window goes on deleting rows the developer has just asked to keep.
 * Each domain therefore exposes a process-global override, and passes read
 * through it rather than through the value they captured.
 *
 * Every such override needs wiring in three places: published on reload,
 * cleared on teardown, and cleared again when the container is reset. Wiring
 * them one domain at a time is the shape that has already gone wrong twice in
 * this package — a config block added to one list and forgotten in another
 * resolves, defaults, and then governs nothing, with no error to say so.
 *
 * So the list lives here and the three call sites ask for all of it. A domain
 * that gains a reloadable policy is added once, and cannot be published without
 * also being cleared.
 *
 * @module domains/retention/published-policies
 */

import type { ResolvedAuditRetentionConfig } from "../audit/retention-config";
import { setAuditRetention } from "../audit/retention-config";
import type { ResolvedEmailRetentionConfig } from "../email/retention-config";
import { setEmailRetention } from "../email/retention-config";

/** The reloadable slice of a configuration. */
export interface ReloadableRetentionPolicies {
  auditRetention?: ResolvedAuditRetentionConfig;
  emailRetention?: ResolvedEmailRetentionConfig;
}

/**
 * Publish every reloadable retention policy from a freshly loaded config.
 *
 * Called at COMMIT rather than when the file is read: a reload that is later
 * refused still parsed a valid config, and publishing early would leave a
 * policy the process explicitly rejected in force, deleting on a window nothing
 * accepted.
 *
 * `undefined` restores each domain's built-in policy, which is what teardown
 * wants — a value left behind would be preferred over the built-in policy of
 * whatever configuration initialises next, so a short window from a previous
 * app could go on deleting rows in one that configured retention off.
 */
export function publishRetentionPolicies(
  config: ReloadableRetentionPolicies | undefined
): void {
  setAuditRetention(config?.auditRetention);
  setEmailRetention(config?.emailRetention);
}
