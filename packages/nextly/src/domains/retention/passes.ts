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

import {
  ONE_TIME_SECRETS_SWEEP_INTERVAL_MS,
  pruneOneTimeSecrets,
  type OneTimeSecretsPruneAdapter,
} from "../../plugins/security/one-time-secrets-prune";
import type { Logger } from "../../shared/types";
import { pruneAuditDataSafely, type AuditPruneAdapter } from "../audit/prune";
import {
  activeAuditRetention,
  type ResolvedAuditRetentionConfig,
} from "../audit/retention-config";
import {
  pruneContentEventsSafely,
  type ContentEventsPruneDb,
} from "../content-events/prune";
import { pruneEmailDataSafely, type EmailPruneAdapter } from "../email/prune";
import {
  activeEmailRetention,
  resolveEmailRetentionConfig,
  type ResolvedEmailRetentionConfig,
} from "../email/retention-config";
import type { EmailConfig } from "../email/types";
import type { NoticesPruneDb } from "../notices/notices-service";
import { pruneNoticesSafely } from "../notices/prune";
import { pruneWebhookDataSafely, type PruneDeps } from "../webhooks/prune";
import type { ResolvedWebhookRetentionConfig } from "../webhooks/retention-config";

import {
  AUDIT_RETENTION_GATE_KEY,
  CONTENT_EVENTS_RETENTION_GATE_KEY,
  EMAIL_RETENTION_GATE_KEY,
  NOTICES_RETENTION_GATE_KEY,
  ONE_TIME_SECRETS_RETENTION_GATE_KEY,
  WEBHOOK_RETENTION_GATE_KEY,
  type RetentionGateStore,
} from "./gate";
import { RetentionRunner, type RetentionPass } from "./runner";
import { warnQuietly } from "./safe-log";

export interface RetentionPassInput {
  adapter: AuditPruneAdapter &
    PruneDeps["adapter"] &
    EmailPruneAdapter &
    OneTimeSecretsPruneAdapter &
    NoticesPruneDb &
    ContentEventsPruneDb;
  webhookPolicy?: ResolvedWebhookRetentionConfig | null;
  auditPolicy?: ResolvedAuditRetentionConfig;
  /**
   * Resolved delivery-log retention. Absent on every path that does not send
   * mail, which is why the pass is not simply always present: a container built
   * without the email services has no table to sweep.
   */
  emailPolicy?: ResolvedEmailRetentionConfig;
  /** Sweep plugins' one-purpose secrets past their expiry. */
  oneTimeSecrets?: boolean;
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
      intervalMs: () => policy.intervalMs,
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

  // Registered whenever a policy exists at all. Whether it has anything to
  // prune is a question for each RUN rather than for construction: a runner
  // built at boot outlives every hot reload, so a policy captured here would
  // keep pruning on windows the developer has already changed — including to
  // `false`, where the stale ones go on deleting what they have just asked to
  // keep. An entirely-`false` policy makes the pass a no-op at run time, which
  // costs one gate claim per interval and nothing else.
  const audit = activeAuditRetention(input.auditPolicy);
  if (audit) {
    passes.push({
      key: AUDIT_RETENTION_GATE_KEY,
      // Re-read per offer, like the windows below. It decides how often a pass
      // is offered, and a value captured at boot survives every hot reload —
      // so a developer shortening the interval would wait the old one out.
      intervalMs: () =>
        activeAuditRetention(input.auditPolicy)?.intervalMs ?? audit.intervalMs,
      run: async maxBatches => {
        const policy = activeAuditRetention(input.auditPolicy);
        if (
          !policy ||
          (policy.activityMaxAgeMs === false && policy.authMaxAgeMs === false)
        ) {
          return;
        }
        await pruneAuditDataSafely(
          { adapter: input.adapter, now: input.now, logger: input.logger },
          policy,
          maxBatches
        );
      },
    });
  }

  // Notices are kept as long as the activity log keeps its records, so they
  // ride the same policy, read per run for the same reason. A window of
  // `false` keeps them forever, as it keeps the activity log.
  if (audit) {
    passes.push({
      key: NOTICES_RETENTION_GATE_KEY,
      intervalMs: () =>
        activeAuditRetention(input.auditPolicy)?.intervalMs ?? audit.intervalMs,
      run: async maxBatches => {
        const policy = activeAuditRetention(input.auditPolicy);
        if (!policy || policy.activityMaxAgeMs === false) return;
        await pruneNoticesSafely(
          { db: input.adapter, now: input.now, logger: input.logger },
          policy.activityMaxAgeMs,
          maxBatches ?? policy.maxBatchesPerRun
        );
      },
    });
  }

  // A deleted subject's content events are kept for the activity log's window
  // from its deletion, so they ride the same policy, read per run as notices
  // are. A window of `false` keeps them forever. A subject that still exists
  // keeps its events whatever the window.
  if (audit) {
    passes.push({
      key: CONTENT_EVENTS_RETENTION_GATE_KEY,
      intervalMs: () =>
        activeAuditRetention(input.auditPolicy)?.intervalMs ?? audit.intervalMs,
      run: async maxBatches => {
        const policy = activeAuditRetention(input.auditPolicy);
        if (!policy || policy.activityMaxAgeMs === false) return;
        await pruneContentEventsSafely(
          { db: input.adapter, now: input.now, logger: input.logger },
          policy.activityMaxAgeMs,
          maxBatches ?? policy.maxBatchesPerRun
        );
      },
    });
  }

  // Read through `activeEmailRetention` for the reason the audit pass is: a
  // runner built at boot outlives every hot reload, so a policy captured here
  // would keep pruning on a window the developer has already changed —
  // including to `false`, where a stale window goes on deleting rows they have
  // just asked to keep.
  const email = activeEmailRetention(input.emailPolicy);
  if (email) {
    passes.push({
      key: EMAIL_RETENTION_GATE_KEY,
      intervalMs: () =>
        activeEmailRetention(input.emailPolicy)?.intervalMs ?? email.intervalMs,
      run: async maxBatches => {
        const policy = activeEmailRetention(input.emailPolicy);
        if (!policy || policy.maxAgeMs === false) return;
        await pruneEmailDataSafely(
          { adapter: input.adapter, now: input.now, logger: input.logger },
          policy,
          maxBatches
        );
      },
    });
  }

  // On for every configuration that reached the call site: a one-purpose
  // secret past its expiry answers nothing, so there is no policy to set, only
  // the fixed day of grace the helper documents. A failure is logged and never
  // reaches the write that offered the pass.
  if (input.oneTimeSecrets)
    passes.push({
      key: ONE_TIME_SECRETS_RETENTION_GATE_KEY,
      intervalMs: () => ONE_TIME_SECRETS_SWEEP_INTERVAL_MS,
      run: async maxBatches => {
        try {
          await pruneOneTimeSecrets(
            input.adapter,
            (input.now ?? (() => new Date()))(),
            { maxBatches }
          );
        } catch (error) {
          // Quietly, for the reason the runner reports its own failures so:
          // a logger throwing here would reach the write that offered the pass.
          warnQuietly(
            input.logger,
            "One-purpose secrets retention pass failed",
            {
              error: error instanceof Error ? error.message : "unknown error",
            }
          );
        }
      },
    });

  return passes;
}

/**
 * Every domain's resolved policy, taken from one service configuration.
 *
 * Each site that builds a runner used to name the policies it wanted, so a
 * domain gaining retention had to be added to all of them — and a site left out
 * silently offers that domain no pass at all. The delivery log shipped in
 * exactly that state: reachable only from the send path, which meant an install
 * that stopped sending never aged out its last recipients.
 *
 * Spreading this instead makes the list one thing. A caller that has the
 * configuration gets every domain, including ones added later.
 */
export function retentionPoliciesFrom(
  config:
    | {
        webhookRetention?: ResolvedWebhookRetentionConfig | null;
        auditRetention?: ResolvedAuditRetentionConfig;
        emailRetention?: ResolvedEmailRetentionConfig;
        email?: { retention?: EmailConfig["retention"] };
      }
    | undefined
): Pick<
  RetentionPassInput,
  "webhookPolicy" | "auditPolicy" | "emailPolicy" | "oneTimeSecrets"
> {
  // `undefined` is "no configuration reached this call site", which is not the
  // same as "a configuration that asked for nothing" and must not gain passes.
  if (!config) return {};

  return {
    webhookPolicy: config.webhookRetention,
    // Every install has the table, and its sweep has nothing to configure.
    oneTimeSecrets: true,
    auditPolicy: config.auditRetention,
    // Flattened `emailRetention` when initialization produced one, and
    // otherwise resolved from the NESTED block by the same call the sanitizer
    // makes. `registerServices()` is public, and a caller using it directly
    // supplies `email: { retention }` rather than the flattened field — which
    // only `sanitizeConfig` + `buildServiceConfig` produce. Reading just the
    // flat field left those installs with no pass at all while their
    // configuration plainly asked for one.
    emailPolicy:
      config.emailRetention ??
      resolveEmailRetentionConfig(config.email?.retention),
  };
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
