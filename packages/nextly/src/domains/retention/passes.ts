/**
 * Assemble the retention passes an install actually needs.
 *
 * Every write path that offers a retention pass needs the same set, and the set
 * is decided the same way each time: a domain contributes a pass when its
 * retention is configured on. Building it here means a write path cannot
 * accidentally offer some domains' passes and not others, which would look
 * exactly like retention working while one table grew unbounded.
 *
 * @module domains/retention/passes
 * @since 1.0.0
 */

import type { Logger } from "../../shared/types";
import { pruneAuditDataSafely, type AuditPruneAdapter } from "../audit/prune";
import type { ResolvedAuditRetentionConfig } from "../audit/retention-config";
import { pruneWebhookDataSafely, type PruneDeps } from "../webhooks/prune";
import type { ResolvedWebhookRetentionConfig } from "../webhooks/retention-config";

import {
  AUDIT_RETENTION_GATE_KEY,
  WEBHOOK_RETENTION_GATE_KEY,
  type RetentionGateStore,
} from "./gate";
import { RetentionRunner, type RetentionPass } from "./runner";

export interface RetentionPassInput {
  adapter: AuditPruneAdapter & PruneDeps["adapter"];
  webhookPolicy?: ResolvedWebhookRetentionConfig | null;
  auditPolicy?: ResolvedAuditRetentionConfig;
  gate: RetentionGateStore;
  now?: () => Date;
  logger?: Logger;
}

/** The passes configured on for this install. */
export function buildRetentionPasses(
  input: RetentionPassInput
): RetentionPass[] {
  const passes: RetentionPass[] = [];

  if (input.webhookPolicy) {
    const policy = input.webhookPolicy;
    passes.push({
      key: WEBHOOK_RETENTION_GATE_KEY,
      intervalMs: policy.intervalMs,
      run: async maxBatches => {
        await pruneWebhookDataSafely(
          { adapter: input.adapter, now: input.now, logger: input.logger },
          maxBatches === undefined
            ? policy
            : { ...policy, maxBatchesPerRun: maxBatches }
        );
      },
    });
  }

  // A policy whose every window is `false` is an operator saying "keep it all",
  // so the pass is not registered at all rather than registered and made a
  // no-op: an unregistered pass never takes the gate, never reads, and never
  // appears in a log as having run.
  const audit = input.auditPolicy;
  if (
    audit &&
    (audit.activityMaxAgeMs !== false || audit.authMaxAgeMs !== false)
  ) {
    passes.push({
      key: AUDIT_RETENTION_GATE_KEY,
      intervalMs: audit.intervalMs,
      run: async maxBatches => {
        await pruneAuditDataSafely(
          { adapter: input.adapter, now: input.now, logger: input.logger },
          audit,
          maxBatches
        );
      },
    });
  }

  return passes;
}

/**
 * The runner for this install, or undefined when nothing is configured to
 * prune — so a caller holding an optional runner keeps meaning "no retention"
 * rather than "a runner with nothing to do".
 */
export function buildRetentionRunner(
  input: RetentionPassInput
): RetentionRunner | undefined {
  const passes = buildRetentionPasses(input);
  if (passes.length === 0) return undefined;
  return new RetentionRunner({
    passes,
    gate: input.gate,
    now: input.now,
    logger: input.logger,
  });
}
