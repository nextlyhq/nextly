/**
 * A saved config change must reach the runner that is already running.
 *
 * Runners capture their policy when they are BUILT, and one built at boot
 * outlives every hot reload. So without a published override, editing a
 * retention window in development changes nothing until restart — including
 * editing it to `false`, where the stale window goes on deleting rows the
 * developer has just asked to keep. That is the worst direction for this to
 * fail in, and it fails silently: the config file says one thing and the
 * process does another, with nothing reporting the disagreement.
 *
 * Each domain has its own override, and each needs wiring in three places:
 * published on reload, cleared on teardown, cleared again on container reset.
 * Wiring them one domain at a time is what put the email policy in the tree
 * with a setter nothing ever called — the value resolved, defaulted, and
 * governed nothing. These cases pin the list, not any single domain.
 */

import { describe, expect, it, afterEach } from "vitest";

import { activeAuditRetention } from "../../audit/retention-config";
import {
  activeEmailRetention,
  resolveEmailRetentionConfig,
} from "../../email/retention-config";
import { publishRetentionPolicies } from "../published-policies";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("publishing reloaded retention policies", () => {
  afterEach(() => {
    // Process-global by nature, so a case that left one set would decide the
    // next one's answer.
    publishRetentionPolicies(undefined);
  });

  it("publishes every policy in the list, not just the first", () => {
    // The property that matters. Publishing only the audit policy is exactly
    // what happened, and the email runner then kept its boot-time window while
    // the config read as changed.
    const emailRetention = resolveEmailRetentionConfig({
      maxAgeMs: 7 * DAY_MS,
    });

    publishRetentionPolicies({
      auditRetention: { maxAgeMs: 3 * DAY_MS } as never,
      emailRetention,
    });

    expect(activeEmailRetention(undefined)).toBe(emailRetention);
    expect(activeAuditRetention(undefined)).toEqual({ maxAgeMs: 3 * DAY_MS });
  });

  it("prefers the published policy over the one a runner was built with", () => {
    // The whole point of the override: the built value is the argument, and it
    // must lose. A reader that returned the built policy would look correct in
    // every test that never published one.
    const built = resolveEmailRetentionConfig({ maxAgeMs: 90 * DAY_MS });
    const saved = resolveEmailRetentionConfig({ maxAgeMs: false });

    publishRetentionPolicies({ emailRetention: saved });

    expect(activeEmailRetention(built)).toBe(saved);
    // `false` is the case that motivated this: an operator turning retention
    // off must not keep deleting on the previous window.
    expect(activeEmailRetention(built)?.maxAgeMs).toBe(false);
  });

  it("restores the built-in policy when cleared", () => {
    // Teardown, and container reset, both call this with `undefined`. A value
    // left behind would be preferred over the built-in policy of whatever
    // configuration initialises next — so a short window from a previous app
    // could go on deleting rows in one that configured retention off.
    const built = resolveEmailRetentionConfig({ maxAgeMs: 90 * DAY_MS });
    publishRetentionPolicies({
      emailRetention: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
    });

    publishRetentionPolicies(undefined);

    expect(activeEmailRetention(built)).toBe(built);
    expect(activeAuditRetention(undefined)).toBeUndefined();
  });

  it("clears a policy when a reloaded config no longer declares one", () => {
    // Not the same as clearing everything: a config that dropped the block
    // must stop overriding, rather than keeping the last value it published.
    publishRetentionPolicies({
      emailRetention: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
    });

    publishRetentionPolicies({ auditRetention: { maxAgeMs: 5 } as never });

    expect(activeEmailRetention(undefined)).toBeUndefined();
  });
});
