/**
 * Webhook domain — drain orchestrator.
 *
 * One drain pass = fan out due events into delivery rows, then attempt the due
 * deliveries. Both phases are individually bounded (one batch per call), so the
 * orchestrator loops until a full round makes no progress or a round cap is hit.
 * This is the unit a scheduled trigger (a cron route, `after()`) invokes; the
 * trigger itself is a separate slice.
 *
 * @module domains/webhooks/run-drain
 */

import { deliverDueDeliveries, type DeliverDeps } from "./deliver";
import { fanOutDueEvents, type FanOutDeps } from "./fan-out";
import { pruneAuditDataSafely } from "../audit/prune";
import { pruneEmailDataSafely } from "../email/prune";
import {
  activeEmailRetention,
  type ResolvedEmailRetentionConfig,
} from "../email/retention-config";
import {
  activeAuditRetention,
  type ResolvedAuditRetentionConfig,
} from "../audit/retention-config";
import { pruneWebhookDataSafely, type PruneDeps } from "./prune";
import type { ResolvedWebhookRetentionConfig } from "./retention-config";
import {
  claimRetentionPass,
  releaseRetentionPass,
  type RetentionGateStore,
  AUDIT_RETENTION_DRAIN_GATE_KEY,
  CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY,
  EMAIL_RETENTION_DRAIN_GATE_KEY,
  NOTICES_RETENTION_DRAIN_GATE_KEY,
  ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY,
  WEBHOOK_RETENTION_GATE_KEY,
} from "../../domains/retention/gate";
import { pruneContentEventsSafely } from "../content-events/prune";
import { pruneNoticesSafely } from "../notices/prune";
import { warnQuietly } from "../../domains/retention/safe-log";
import {
  ONE_TIME_SECRETS_SWEEP_INTERVAL_MS,
  pruneOneTimeSecrets,
} from "../../plugins/security/one-time-secrets-prune";

/** Hard cap on rounds so a persistently-retrying backlog can't loop unbounded. */
const DEFAULT_MAX_ROUNDS = 100;

export interface RunDrainDeps {
  fanOut: FanOutDeps;
  deliver: DeliverDeps;
  /** Max fan-out/deliver rounds before returning. Defaults to 100. */
  maxRounds?: number;
  /**
   * Wall-clock budget for the whole drain. Once exceeded the loop stops starting
   * new rounds AND the delivery pass stops attempting new deliveries, so a
   * scheduler tick returns within roughly `maxDurationMs` plus one in-flight
   * request timeout even when receivers hang — instead of `batch × rounds ×
   * timeout`. The durable outbox + delivery lease let the next tick continue.
   * Unbounded when unset (the default; content-write-driven callers do not need
   * it). Measured with the delivery clock so tests stay deterministic.
   */
  maxDurationMs?: number;
  /**
   * Retention, when configured. The pass runs after delivery so it only ever
   * sees rows this drain has finished with, and it is gated so a frequently
   * invoked drain does not prune on every call.
   */
  retention?: {
    /**
     * Absent when webhook retention is off. The trails are pruned on their own
     * policy either way, so switching one off does not silently switch off the
     * other's only full-budget trigger.
     */
    policy?: ResolvedWebhookRetentionConfig;
    /** Absent when the audit trails are configured to keep everything. */
    auditPolicy?: ResolvedAuditRetentionConfig;
    /**
     * Absent when no delivery-log policy was carried.
     *
     * Present here for the reason the audit policy is, and more urgently. Every
     * other trigger for the delivery log is a WRITE — a send, or a content
     * mutation — so an install that has gone quiet offers no pass at all, and
     * the rows from its final sends stay indefinitely under a window that reads
     * as bounded. A scheduled drain is the one trigger that keeps running when
     * nothing else does.
     */
    emailPolicy?: ResolvedEmailRetentionConfig;
    /**
     * Sweep plugins' one-purpose secrets past their expiry. Here for the
     * delivery log's reason: an install that only mints secrets, or goes quiet
     * after minting them, may make no write that offers the sweep, and the rows
     * keep a subject and data in clear.
     */
    oneTimeSecrets?: boolean;
    prune: PruneDeps;
    gate: RetentionGateStore;
  };
}

export interface RunDrainResult {
  rounds: number;
  eventsProcessed: number;
  deliveriesCreated: number;
  attempted: number;
  delivered: number;
  retried: number;
  failed: number;
  /**
   * Attempts whose outcome was dropped because the lease had been handed off
   * (a redelivery re-arm or a reclaimed expired lease) — never counted as a
   * committed delivered/retried/failed.
   */
  abandoned: number;
  /** Rows retention removed on this call; zero when the gate held it off. */
  pruned: {
    events: number;
    deliveries: number;
    /** Rows removed from the activity and auth trails on this call. */
    activity: number;
    auth: number;
    /** Rows removed from the email delivery log on this call. */
    emailDeliveries: number;
    /** Plugins' one-purpose secrets removed on this call. */
    oneTimeSecrets: number;
    /** Notices past the activity log's window removed on this call. */
    notices: number;
    /**
     * Content events of subjects deleted more than the activity log's window
     * ago, removed on this call.
     */
    contentEvents: number;
  };
}

/**
 * Run the drain to quiescence. Each round fans out one batch of events and
 * attempts one batch of deliveries; the loop stops when a round both fans out no
 * event and attempts no delivery (nothing left that is due right now), or when
 * `maxRounds` is reached. Deliveries scheduled for a future retry are intentionally
 * left for a later drain — this returns once nothing is immediately actionable.
 */
/**
 * An equal share of whatever time is left, as an absolute moment.
 *
 * Used to bound a pass so the ones after it are still reachable. A fixed
 * reserve would be a constant to tune per deployment; a share of the remainder
 * adapts to how much the call has already spent, and leaves the later passes a
 * meaningful slice whatever that was.
 *
 * `ways` counts this pass PLUS the passes that will actually follow, and the
 * distinction matters: reserving for a pass that will not run leaves the
 * unclaimable share unused until the next interval, so a ledger needing more
 * than its share per interval would grow while time sat idle. Callers pass the
 * number of turns they have already CLAIMED, not the number they might want.
 */
function shareOfRemaining(
  deadline: Date | undefined,
  now: () => Date,
  ways: number
): Date | undefined {
  if (!deadline || ways <= 1) return deadline;
  const remaining = deadline.getTime() - now().getTime();
  return remaining <= 0
    ? deadline
    : new Date(now().getTime() + remaining / ways);
}

export async function runDrain(deps: RunDrainDeps): Promise<RunDrainResult> {
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  // The delivery clock, reused for the budget so the deadline and the delivery
  // pass compare against the same time source (real in production, pinned in
  // tests).
  const now = deps.deliver.now ?? (() => new Date());
  const deadline =
    deps.maxDurationMs !== undefined
      ? new Date(now().getTime() + deps.maxDurationMs)
      : undefined;
  const result: RunDrainResult = {
    rounds: 0,
    eventsProcessed: 0,
    deliveriesCreated: 0,
    attempted: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
    abandoned: 0,
    pruned: {
      events: 0,
      deliveries: 0,
      activity: 0,
      auth: 0,
      emailDeliveries: 0,
      oneTimeSecrets: 0,
      notices: 0,
      contentEvents: 0,
    },
  };

  for (let round = 0; round < maxRounds; round += 1) {
    const fan = await fanOutDueEvents(deps.fanOut);
    const del = await deliverDueDeliveries(
      deadline ? { ...deps.deliver, deadline } : deps.deliver
    );

    result.rounds += 1;
    result.eventsProcessed += fan.eventsProcessed;
    result.deliveriesCreated += fan.deliveriesCreated;
    result.attempted += del.attempted;
    result.delivered += del.delivered;
    result.retried += del.retried;
    result.failed += del.failed;
    result.abandoned += del.abandoned;

    // Nothing was fanned out and nothing was attempted this round → the queue is
    // drained of everything currently due; stop.
    if (fan.eventsProcessed === 0 && del.attempted === 0) break;
    // Budget spent → stop before starting a new round; the next tick continues.
    if (deadline && now() >= deadline) break;
  }

  // After the queue is quiet, not between rounds: pruning mid-drain would race
  // the deliveries this very call is still working through. Failure is
  // swallowed — a drain that delivered successfully must not report failure
  // because housekeeping could not run.
  const retention = deps.retention;
  if (retention) {
    // Turns claimed here but not yet spent. The email turn is taken BEFORE the
    // earlier sweeps run, so that the webhook sweep can size its share — which
    // means an earlier sweep throwing skips the branch that would use or return
    // it. The "safe" wrappers absorb a prune failure but still report it
    // through the installation's logger, and a logger that throws from inside
    // that report escapes them; the marker would then hold the full email sweep
    // off for a whole interval, every interval, while the drain rejected.
    //
    // Tracked rather than reasoned about, because which sweeps can throw is a
    // property of code this function does not own.
    const heldTurns = new Set<string>();
    try {
      // Read fresh at each claim rather than once for both. Claiming a gate with
      // nothing left to spend takes the turn and does no work, and the marker
      // then holds the next attempt off for a full interval — so a drain that
      // repeatedly spends its budget would consume every retention turn and
      // prune nothing. A single reading taken before the first pass is stale by
      // the second, which is precisely the case worth catching: the first pass
      // is what spends the remaining time.
      const deadlineSpent = (): boolean =>
        deadline !== undefined && now() >= deadline;

      // Read live for the same reason the request-path pass does: this dependency
      // is a singleton built at boot, so a captured policy would outlive every
      // reload that changed it.
      const auditPolicy = activeAuditRetention(deps.retention?.auditPolicy);
      const auditPrunes =
        auditPolicy !== undefined &&
        (auditPolicy.activityMaxAgeMs !== false ||
          auditPolicy.authMaxAgeMs !== false);

      // The audit turn is claimed BEFORE the webhook sweep runs, so the sweep's
      // budget can be decided from whether a second pass will actually follow.
      // Halving for a pass that is not due leaves the other half unusable until
      // the next interval — the gate is claimed by then — so a ledger needing
      // more than half a budget would grow while time sat idle. Claiming is two
      // statements; running is where the time goes, and that still happens below
      // in the original order.
      const auditTurn =
        auditPrunes && !deadlineSpent()
          ? await claimRetentionPass(
              retention.gate,
              AUDIT_RETENTION_DRAIN_GATE_KEY,
              auditPolicy!.intervalMs
            )
          : false;

      // Claimed here too, and for the same reason: the webhook sweep below has to
      // know how many passes will actually follow before it decides how much of
      // the remaining time it may spend.
      //
      // On its OWN marker, not the one write paths use. Every write offers this
      // pass capped at a couple of batches, so sharing a marker would let a send
      // take the turn moments before this call and leave the full budget
      // unreachable — the log then grows while both triggers report success.
      const emailPolicy = activeEmailRetention(retention.emailPolicy);
      const emailPrunes =
        emailPolicy !== undefined && emailPolicy.maxAgeMs !== false;
      const emailTurn =
        emailPrunes && !deadlineSpent()
          ? await claimRetentionPass(
              retention.gate,
              EMAIL_RETENTION_DRAIN_GATE_KEY,
              emailPolicy!.intervalMs
            )
          : false;
      if (emailTurn) heldTurns.add(EMAIL_RETENTION_DRAIN_GATE_KEY);

      // Claimed with the others, before any sweep runs, so the shares below
      // count it: run last with nothing reserved, a sustained backlog in the
      // other passes would leave it no time on every drain.
      const secretsTurn =
        retention.oneTimeSecrets === true && !deadlineSpent()
          ? await claimRetentionPass(
              retention.gate,
              ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY,
              ONE_TIME_SECRETS_SWEEP_INTERVAL_MS
            )
          : false;
      if (secretsTurn) heldTurns.add(ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY);

      // Notices keep the activity log's window, so they ride its policy, on a
      // drain marker of their own.
      const noticesMaxAgeMs =
        auditPolicy !== undefined && auditPolicy.activityMaxAgeMs !== false
          ? auditPolicy.activityMaxAgeMs
          : undefined;
      const noticesTurn =
        noticesMaxAgeMs !== undefined && !deadlineSpent()
          ? await claimRetentionPass(
              retention.gate,
              NOTICES_RETENTION_DRAIN_GATE_KEY,
              auditPolicy!.intervalMs
            )
          : false;
      if (noticesTurn) heldTurns.add(NOTICES_RETENTION_DRAIN_GATE_KEY);

      // A deleted subject's content events keep the activity log's window
      // too, on a drain marker of their own: the drain is the one trigger
      // that keeps running after a site stops writing.
      const contentEventsTurn =
        noticesMaxAgeMs !== undefined && !deadlineSpent()
          ? await claimRetentionPass(
              retention.gate,
              CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY,
              auditPolicy!.intervalMs
            )
          : false;
      if (contentEventsTurn) {
        heldTurns.add(CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY);
      }

      // How many passes still have to fit in the time that remains, counted from
      // the turns already CLAIMED rather than from the policies configured — a
      // reserve set aside for a pass that will not run leaves that share unusable
      // until the next interval.
      //
      // Recomputed before EACH pass rather than once: a single value applied only
      // to the first sweep left the second taking the entire remainder, so the
      // third released its turn without pruning on every invocation.
      const passesLeftAfter = (done: {
        webhook?: boolean;
        audit?: boolean;
        email?: boolean;
        notices?: boolean;
      }): number =>
        (done.webhook ? 0 : 1) +
        (auditTurn && !done.audit ? 1 : 0) +
        (emailTurn && !done.email ? 1 : 0) +
        (noticesTurn && !done.notices ? 1 : 0) +
        (contentEventsTurn ? 1 : 0) +
        (secretsTurn ? 1 : 0);

      const webhookPolicy = retention.policy;
      if (webhookPolicy && !deadlineSpent()) {
        const due = await claimRetentionPass(
          retention.gate,
          WEBHOOK_RETENTION_GATE_KEY,
          webhookPolicy.intervalMs
        );
        // Re-checked after the claim, not only before it: the claim is two
        // statements against the database and can itself spend what remained.
        // Giving the turn back matters as much as not using it — the marker
        // would otherwise hold the next attempt off for a full interval on a
        // pass that did nothing.
        if (due && deadlineSpent()) {
          await releaseRetentionPass(
            retention.gate,
            WEBHOOK_RETENTION_GATE_KEY
          );
        } else if (due) {
          // Bounded by HALF the time that remains, not by the shared deadline.
          // Both sweeps ran to the same absolute moment and this one goes first,
          // so a sustained webhook backlog consumed the whole allowance and the
          // audit trails — whose only full-budget trigger this call is — were
          // skipped every time. Splitting what is left needs no tuned reserve:
          // each pass gets a share that shrinks with the work already done.
          const pruned = await pruneWebhookDataSafely(
            {
              ...retention.prune,
              // Halved only when a second pass will actually follow. Reserving
              // for a sweep that will not run leaves the unclaimable half unused
              // until the next interval, so a ledger needing more than half a
              // budget per interval would grow while time sat idle.
              deadline: shareOfRemaining(deadline, now, passesLeftAfter({})),
            },
            webhookPolicy
          );
          result.pruned.events = pruned.events.webhook + pruned.events.audit;
          result.pruned.deliveries = pruned.deliveries;
        }
      }

      // The audit trails are offered here too, and at their FULL budget. Every
      // other trigger is a user's write, which passes a small override so a save
      // is not held up by a backlog sweep — so without this the configured
      // budget is never reachable and a busy site accumulates faster than the
      // capped passes can retire. Nothing waits on the drain, which is what makes
      // it the right place to spend it. Gated on its own key, so a webhook pass
      // taken this round does not consume the audit trails' turn.
      // Skipped once the delivery deadline is spent. The wall-clock bound is a
      // promise this function makes to a serverless cron route, and a full-budget
      // pass is up to forty statements — enough to carry the invocation past the
      // platform's limit and have it killed, losing the drain's own work with it.
      // The gate is not claimed in that case either, so the pass is deferred to
      // the next invocation rather than consumed by one that could not run it.
      if (auditTurn) {
        const auditDue = true;
        // Re-checked after the claim, not only before it: the claim is two
        // statements against the database and can itself spend what remained. A
        // pass that prunes nothing has still written the marker, which holds the
        // next attempt off for a full interval — so what matters is whether time
        // is left NOW, after paying for the turn.
        if (auditDue && deadlineSpent()) {
          await releaseRetentionPass(
            retention.gate,
            AUDIT_RETENTION_DRAIN_GATE_KEY
          );
        } else if (auditDue) {
          const trails = await pruneAuditDataSafely(
            {
              ...retention.prune,
              // A share, not the remainder. Taking everything left here starved
              // the pass after it — a sustained audit backlog meant the delivery
              // log was never swept on a drain, which is the same starvation the
              // webhook sweep above is bounded to avoid.
              deadline: shareOfRemaining(
                deadline,
                now,
                passesLeftAfter({ webhook: true })
              ),
            },
            auditPolicy!
          );
          result.pruned.activity = trails.activity;
          result.pruned.auth = trails.auth;
        }
      }

      // The delivery log, at its full batch budget for the same reason the audit
      // trails get theirs here: every other trigger is a write, which passes a
      // small cap so a send or a save is not held up. Without this pass an
      // install that has stopped writing never reaches the configured budget at
      // all -- and, worse, never offers a pass again, so the rows from its final
      // sends stay forever under a window that reads as bounded.
      //
      // Bounded by BATCHES rather than by the deadline, because the email prune
      // takes no deadline: it is a fixed number of small, indexed deletes. The
      // wall-clock promise is kept by not starting once the budget is spent, and
      // by handing the turn back so the next invocation runs it rather than a
      // marker holding it off for a full interval.
      if (emailTurn) {
        if (deadlineSpent()) {
          await releaseRetentionPass(
            retention.gate,
            EMAIL_RETENTION_DRAIN_GATE_KEY
          );
          heldTurns.delete(EMAIL_RETENTION_DRAIN_GATE_KEY);
        } else {
          const swept = await pruneEmailDataSafely(
            {
              adapter: retention.prune.adapter,
              logger: retention.prune.logger,
              // The drain's clock and deadline, so this pass stops between
              // batches when the wall-clock budget runs out. Without them a
              // backlog spends its whole batch allowance past the deadline and
              // carries the invocation over the platform's limit -- losing the
              // drain's delivery work, which is the one thing that was waited on.
              now,
              // A share when the secrets sweep follows, the remainder when not.
              deadline: shareOfRemaining(
                deadline,
                now,
                passesLeftAfter({ webhook: true, audit: true })
              ),
            },
            emailPolicy!
          );
          result.pruned.emailDeliveries = swept.deliveries;
          // Kept only if a batch was actually attempted. The outer deadline
          // check above can pass and the budget still expire before the
          // pruner's own between-batch check, in which case it returns having
          // queried nothing — and marking the turn spent there holds the next
          // full-budget attempt off for a whole interval on a pass that did no
          // work. `deliveries === 0` cannot distinguish the two, because that
          // is also what a healthy sweep of an empty table returns.
          if (swept.started) heldTurns.delete(EMAIL_RETENTION_DRAIN_GATE_KEY);
        }
      }

      // Notices, by batches like the delivery log, and only with time left.
      if (noticesTurn && noticesMaxAgeMs !== undefined) {
        result.pruned.notices = await drainActivityWindowPass(
          retention,
          heldTurns,
          deadlineSpent,
          NOTICES_RETENTION_DRAIN_GATE_KEY,
          // A share when later sweeps follow, the remainder when not, checked
          // between batches so a backlog cannot carry the drain past its
          // wall-clock promise.
          passDeadline =>
            pruneNoticesSafely(
              {
                db: retention.prune.adapter,
                now,
                logger: retention.prune.logger,
                deadline: passDeadline,
              },
              noticesMaxAgeMs,
              auditPolicy!.maxBatchesPerRun
            ),
          shareOfRemaining(
            deadline,
            now,
            passesLeftAfter({ webhook: true, audit: true, email: true })
          )
        );
      }

      // Deleted subjects' content events, on the same window.
      if (contentEventsTurn && noticesMaxAgeMs !== undefined) {
        result.pruned.contentEvents = await drainActivityWindowPass(
          retention,
          heldTurns,
          deadlineSpent,
          CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY,
          passDeadline =>
            pruneContentEventsSafely(
              {
                db: retention.prune.adapter,
                now,
                logger: retention.prune.logger,
                deadline: passDeadline,
              },
              noticesMaxAgeMs,
              auditPolicy!.maxBatchesPerRun
            ),
          shareOfRemaining(
            deadline,
            now,
            passesLeftAfter({
              webhook: true,
              audit: true,
              email: true,
              notices: true,
            })
          )
        );
      }

      // Plugins' one-purpose secrets, last and with what remains. The sweep
      // stops between batches at the deadline, and the turn is kept only if a
      // batch was attempted, for the reason the delivery log's is.
      if (secretsTurn && !deadlineSpent()) {
        const swept = await pruneOneTimeSecrets(
          retention.prune.adapter,
          now(),
          {
            deadline: deadline?.getTime(),
            clock: () => now().getTime(),
          }
        ).catch((error: unknown) => {
          // Quietly: an app-supplied logger that throws here would reject a
          // drain whose deliveries already succeeded.
          warnQuietly(
            retention.prune.logger,
            "One-purpose secrets retention pass failed",
            { error: error instanceof Error ? error.message : "unknown error" }
          );
          return { removed: 0, started: true };
        });
        result.pruned.oneTimeSecrets = swept.removed;
        if (swept.started) {
          heldTurns.delete(ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY);
        }
      }
    } finally {
      // Anything still held was claimed and never spent. Giving it back costs
      // one statement; keeping it costs an entire interval of retention.
      for (const key of heldTurns) {
        await releaseRetentionPass(retention.gate, key);
      }
    }
  }

  return result;
}

/**
 * A drain pass on the activity log's window (notices, deleted subjects'
 * content events): run when time is left, the turn handed back when it is
 * not, so the next invocation runs it rather than a marker holding it off for
 * a whole interval. Bounded by batches; the pruners never throw.
 */
async function drainActivityWindowPass(
  retention: NonNullable<RunDrainDeps["retention"]>,
  heldTurns: Set<string>,
  deadlineSpent: () => boolean,
  key: string,
  prune: (
    deadline: Date | undefined
  ) => Promise<{ removed: number; started: boolean }>,
  deadline: Date | undefined
): Promise<number> {
  if (deadlineSpent()) {
    await releaseRetentionPass(retention.gate, key);
    heldTurns.delete(key);
    return 0;
  }
  const swept = await prune(deadline);
  // Kept only if a batch was attempted: a pass whose share was already spent
  // did no work, and keeping the turn would hold the sweep off a whole
  // interval. Handed back in `finally` with the other unspent turns.
  if (swept.started) heldTurns.delete(key);
  return swept.removed;
}
