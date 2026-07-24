/**
 * Webhook domain — endpoint management.
 *
 * The delivery engine, fan-out, signing and retention were all built before
 * anything could create an endpoint for them to act on: the only rows that ever
 * reached `nextly_webhooks` were test fixtures. This is the surface that makes
 * the rest of the domain reachable.
 *
 * Two behaviours here are security-relevant rather than cosmetic.
 *
 * A URL is resolved and checked before it is stored, not only before it is
 * called. Delivery already refuses private, loopback and cloud-metadata
 * addresses through `safeFetch`, and that check is the one that cannot be
 * fooled by a hostname re-pointed after registration — but it fires long after
 * the person who typed the URL has gone. Checking at registration turns a
 * silent, repeated delivery failure into an immediate, correctable error.
 *
 * Secrets are stored encrypted and can be read back by a caller the route
 * authorises. That follows the webhook-first providers rather than the
 * write-only model: a secret that can never be re-read forces a full rotation
 * every time an operator loses their copy, and rotation is the more dangerous
 * operation. The column is list-shaped for the same reason — Standard Webhooks
 * rotation signs with every active secret at once.
 *
 * @module domains/webhooks/services/webhook-endpoint-service
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import {
  nextlyWebhooks as webhooksMysql,
  nextlyWebhookDeliveries as deliveriesMysql,
} from "../../../schemas/webhooks/mysql";
import {
  nextlyWebhooks as webhooksPg,
  nextlyWebhookDeliveries as deliveriesPg,
} from "../../../schemas/webhooks/postgres";
import {
  nextlyWebhooks as webhooksSqlite,
  nextlyWebhookDeliveries as deliveriesSqlite,
} from "../../../schemas/webhooks/sqlite";
import { BaseService } from "../../../shared/base-service";
import {
  ExternalUrlError,
  validateExternalUrl,
} from "../../../utils/validate-external-url";
import type { DeliverTransport } from "../deliver";
import type { WebhookEndpointRegistry } from "../endpoint-registry";
import { decryptWebhookSecret, generateWebhookSecret } from "../secret";
import {
  liveSecretEntries,
  newSecretEntry,
  normalizeSecretEntries,
  WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS,
  WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS,
  type StoredSecretEntry,
} from "../secret-entries";
import { runEndpointProbe, type WebhookTestResult } from "../test-endpoint";
import { REDACTED_HEADER_VALUE } from "../types";
import type { WebhookEventSubscription } from "../types";

/**
 * A signing secret described without revealing it: the display prefix and its
 * lifecycle. `isPrimary` marks the secret new deliveries are prefixed by;
 * `expiresAt` is when an overlapping (rotated-away) secret stops signing, or
 * null for the primary. Safe to return on an ordinary read — it carries no key
 * material, only what the admin needs to show a rotation's state.
 */
export interface WebhookSecretInfo {
  prefix: string;
  isPrimary: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

/**
 * An endpoint as any caller after creation sees it.
 *
 * Carries `secretPrefix` and the `secrets` lifecycle summary but never a secret
 * or its ciphertext: reading a secret is a separate, separately-authorisable
 * act, so it must not ride along on an ordinary list or fetch.
 */
export interface WebhookEndpointSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes: WebhookEventSubscription[];
  headers: Record<string, string> | null;
  /** Prefix of the current primary signing secret. */
  secretPrefix: string;
  /** Every active signing secret's non-sensitive lifecycle, primary first. */
  secrets: WebhookSecretInfo[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What creating an endpoint returns: the endpoint, plus its secret once. */
export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpointSummary;
  secret: string;
}

export interface CreateWebhookEndpointInput {
  name: string;
  url: string;
  eventTypes: WebhookEventSubscription[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
}

export interface UpdateWebhookEndpointInput {
  name?: string;
  url?: string;
  eventTypes?: WebhookEventSubscription[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
}

export interface RotateWebhookSecretInput {
  /**
   * How long the secret being rotated away stays valid, in seconds. 0 retires
   * it immediately; the default (when omitted) is the standard overlap window.
   */
  overlapSeconds?: number;
}

type WebhooksTable =
  | typeof webhooksPg
  | typeof webhooksMysql
  | typeof webhooksSqlite;

type DeliveriesTable =
  | typeof deliveriesPg
  | typeof deliveriesMysql
  | typeof deliveriesSqlite;

/** A stored row, before it is narrowed to what a caller may see. */
interface WebhookRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes: unknown;
  headers: unknown;
  secretHash: unknown;
  secretPrefix: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The subset of the Drizzle fluent API a write needs, so a `BaseService`
 * transaction handle (typed `unknown`) can be narrowed without pulling in a
 * dialect-specific driver type. Matches the `DrizzleTransactionLike` shape used
 * elsewhere for the same reason.
 */
interface DrizzleWriteExecutor {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** Replace every stored header value with the redaction placeholder. */
function redactHeaderValues(stored: unknown): Record<string, string> | null {
  if (!stored || typeof stored !== "object") return null;
  const redacted: Record<string, string> = {};
  for (const name of Object.keys(stored)) {
    redacted[name] = REDACTED_HEADER_VALUE;
  }
  return redacted;
}

export class WebhookEndpointService extends BaseService {
  private readonly table: WebhooksTable;
  /** Needed so disabling an endpoint can end the deliveries still queued for it. */
  private readonly deliveries: DeliveriesTable;

  constructor(
    adapter: ConstructorParameters<typeof BaseService>[0],
    logger: ConstructorParameters<typeof BaseService>[1],
    /**
     * Dropped on every mutation so a change takes effect without a restart.
     * Optional because the registry is constructed per drain today; once it
     * becomes a shared instance this is what keeps it honest. Without it a
     * disabled endpoint would keep receiving deliveries from a cached list,
     * silently and for as long as the process lives.
     */
    private readonly registry?: Pick<WebhookEndpointRegistry, "invalidate">
  ) {
    super(adapter, logger);
    switch (this.adapter.getCapabilities().dialect) {
      case "postgresql":
        this.table = webhooksPg;
        this.deliveries = deliveriesPg;
        break;
      case "mysql":
        this.table = webhooksMysql;
        this.deliveries = deliveriesMysql;
        break;
      default:
        this.table = webhooksSqlite;
        this.deliveries = deliveriesSqlite;
        break;
    }
  }

  /**
   * Run a database call, turning a driver error into the canonical envelope.
   *
   * Every statement here can fail for reasons the caller should see as a typed
   * error rather than a driver exception: `created_by` referencing a user that
   * has since been removed, a constraint violation, a lost connection. Without
   * this the raw driver `Error` escapes `packages/nextly`, where nothing above
   * knows how to render it.
   */
  private async query<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof NextlyError) throw err;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /**
   * Reject a URL delivery could never safely call.
   *
   * Reuses the same validator the transport uses, so registration and delivery
   * cannot disagree about what is acceptable. The failure is translated to a
   * field-level validation error: this is a correctable mistake in submitted
   * input, not an internal fault, and it should read that way to whoever typed
   * it.
   */
  private async assertDeliverableUrl(url: string): Promise<void> {
    // Credentials in the URL defeat every other protection here: the stored URL
    // is returned to anyone who may read the endpoint, so `user:pass@host`
    // would hand out the receiver's credential even though static header values
    // are redacted. Rejected rather than stripped, because silently removing
    // them would leave the operator with an endpoint that fails to authenticate
    // and no indication why.
    // A URL too malformed to parse is left to the validator below, which
    // reports it as an unreachable target rather than as credentials.
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (parsed && (parsed.username || parsed.password)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "url",
            code: "url_credentials",
            message:
              "Remove the username and password from the URL. Use a static header for receiver authentication instead.",
          },
        ],
        logContext: { reason: "webhook-url-userinfo" },
      });
    }

    try {
      await validateExternalUrl(url);
    } catch (err) {
      if (err instanceof ExternalUrlError) {
        throw NextlyError.validation({
          errors: [
            {
              path: "url",
              code: "unreachable_url",
              message:
                "This URL cannot be delivered to. It must be https, publicly resolvable, " +
                "and must not point at a private, loopback or cloud-metadata address.",
            },
          ],
          logContext: { reason: "webhook-url-rejected", url },
        });
      }
      throw err;
    }
  }

  /**
   * The row's signing secrets that are still live at `now`, primary first,
   * tolerating both the current entry form and the legacy bare-string form.
   * Shared by the summary (metadata only) and the reveal/test paths (which
   * decrypt), so expired overlap secrets are never surfaced or signed with.
   */
  private liveSecretEntries(
    row: { secretHash: unknown; secretPrefix: string; createdAt: Date },
    now: Date = new Date()
  ): StoredSecretEntry[] {
    const entries = normalizeSecretEntries(row.secretHash, {
      prefix: row.secretPrefix,
      createdAt: row.createdAt.toISOString(),
    });
    return liveSecretEntries(entries, now);
  }

  /** Narrow a stored row to what a caller may see. */
  private toSummary(row: WebhookRow): WebhookEndpointSummary {
    const secrets = this.liveSecretEntries(row);
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      enabled: row.enabled,
      eventTypes: (Array.isArray(row.eventTypes)
        ? row.eventTypes
        : []) as WebhookEventSubscription[],
      // Names are kept so an operator can see which headers are configured;
      // values are not, because delivery sends them verbatim and they are
      // routinely a credential for the receiver.
      headers: redactHeaderValues(row.headers),
      // Derived from the live primary rather than the stored column so the two
      // never drift; falls back to the column for a row with no live secret.
      secretPrefix: secrets[0]?.prefix ?? row.secretPrefix,
      secrets: secrets.map(entry => ({
        prefix: entry.prefix,
        isPrimary: entry.expiresAt === null,
        createdAt: new Date(entry.createdAt),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
      })),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Register an endpoint and return its signing secret once.
   *
   * The secret is generated here rather than accepted from the caller so it is
   * always the length and shape the signing path and a receiver's Standard
   * Webhooks library expect, and so it is never shared between endpoints.
   */
  async createEndpoint(
    input: CreateWebhookEndpointInput,
    createdBy: string | null
  ): Promise<CreatedWebhookEndpoint> {
    await this.assertDeliverableUrl(input.url);

    const secret = generateWebhookSecret();
    const now = new Date();
    // A single primary entry (never-expiring). List-shaped from the first write,
    // so a rotation appends an overlapping secret rather than migrating a shape.
    const entry = newSecretEntry(secret, now);
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      enabled: input.enabled ?? true,
      eventTypes: input.eventTypes,
      filter: null,
      headers: input.headers ?? null,
      secretHash: [entry],
      secretPrefix: entry.prefix,
      fieldAllowlist: null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await this.query(() => this.db.insert(this.table).values(row));
    this.registry?.invalidate();

    return { endpoint: this.toSummary(row), secret };
  }

  /** Every registered endpoint, newest first. */
  async listEndpoints(): Promise<WebhookEndpointSummary[]> {
    const rows = await this.query(
      async () =>
        (await this.db
          .select()
          .from(this.table)
          // Retired endpoints are kept for their delivery history but are not
          // part of the live set, so they never appear in a list.
          .where(isNull(this.table.deletedAt))
          .orderBy(desc(this.table.createdAt))) as WebhookRow[]
    );
    return rows.map(row => this.toSummary(row));
  }

  /**
   * One endpoint, or null when there is no live endpoint with this id.
   *
   * A retired (soft-deleted) endpoint reads as null, the same as one that never
   * existed: it is kept only for its delivery history and is not part of the
   * manageable set. Callers cannot, and should not, tell the two apart. Every
   * read here filters `deleted_at IS NULL` for that reason, and `updateEndpoint`
   * relies on it to refuse edits to a retired row.
   */
  async getEndpoint(id: string): Promise<WebhookEndpointSummary | null> {
    const rows = await this.query(
      async () =>
        (await this.db
          .select()
          .from(this.table)
          .where(and(eq(this.table.id, id), isNull(this.table.deletedAt)))
          .limit(1)) as WebhookRow[]
    );
    return rows[0] ? this.toSummary(rows[0]) : null;
  }

  /**
   * Change an endpoint. Only the named fields move.
   *
   * A URL is re-validated on the way in, because an update is exactly how an
   * endpoint that passed at registration would be re-pointed somewhere it
   * should not reach.
   */
  async updateEndpoint(
    id: string,
    patch: UpdateWebhookEndpointInput
  ): Promise<WebhookEndpointSummary> {
    const existing = await this.getEndpoint(id);
    if (!existing) throw this.notFound(id);

    if (patch.url !== undefined) await this.assertDeliverableUrl(patch.url);

    const changes: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.url !== undefined) changes.url = patch.url;
    if (patch.eventTypes !== undefined) changes.eventTypes = patch.eventTypes;
    if (patch.enabled !== undefined) changes.enabled = patch.enabled;
    if (patch.headers !== undefined) changes.headers = patch.headers;

    await this.query(() =>
      this.db.update(this.table).set(changes).where(eq(this.table.id, id))
    );
    // Invalidated for every field, not only `enabled`: the cached list carries
    // url, event types and headers too, and a stale copy would keep delivering
    // to the old target.
    this.registry?.invalidate();

    // Done here rather than in `setEnabled` so that disabling through a plain
    // field update cannot skip it. Not wrapped in a transaction with the update
    // above: disabling leaves the endpoint visible, so a failed cancellation is
    // simply retried by disabling again — unlike delete, which hides the row.
    if (patch.enabled === false) {
      await this.query(() =>
        this.cancelQueuedDeliveries(this.db, id, "webhook disabled")
      );
    }

    const updated = await this.getEndpoint(id);
    if (!updated) throw this.notFound(id);
    return updated;
  }

  /**
   * End the deliveries still outstanding for an endpoint that was just disabled
   * or retired.
   *
   * Delivery refuses a disabled endpoint when it attempts one, which covers a
   * drain running during the window. It does not cover the window itself: with
   * no drain between disabling and re-enabling, those rows are still due and
   * would go out in a burst afterwards, which is the opposite of what disabling
   * promised.
   *
   * They are ended rather than held for the same reason delivery ends them.
   * Sending events an operator switched off, hours late, is worse than not
   * sending them, and replaying is a separate deliberate act.
   *
   * The `executor` is either the shared connection or a transaction, so a delete
   * can end the deliveries in the same transaction that retires the endpoint.
   * The `reason` is recorded on each row so the retained history says why they
   * stopped — "disabled" or "deleted" — rather than always "disabled".
   */
  private cancelQueuedDeliveries(
    executor: DrizzleWriteExecutor,
    webhookId: string,
    reason: string
  ): Promise<unknown> {
    return executor
      .update(this.deliveries)
      .set({
        status: "failed",
        nextAttemptAt: null,
        lockedBy: null,
        lockedUntil: null,
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(this.deliveries.webhookId, webhookId),
          inArray(this.deliveries.status, ["pending", "retrying"])
        )
      );
  }

  /**
   * Stop delivering without discarding the endpoint.
   *
   * Kept distinct from deletion because they are different intentions and only
   * one is reversible. An endpoint id tends to end up in someone's
   * infrastructure, so removing the row is the operation that cannot be undone.
   */
  async setEnabled(
    id: string,
    enabled: boolean
  ): Promise<WebhookEndpointSummary> {
    return this.updateEndpoint(id, { enabled });
  }

  /**
   * Retire an endpoint while keeping its delivery history.
   *
   * The row is soft-deleted rather than removed: it disappears from every read
   * and stops receiving deliveries, but stays in the table so the delivery
   * ledger keeps a real endpoint on the other end of its foreign key. "What did
   * we send to that integration, and did it arrive?" is answerable after the
   * endpoint is gone, which is exactly when it tends to be asked.
   *
   * Disabling remains the way to pause an endpoint you intend to bring back;
   * this is for one you are finished with but whose record still matters. A row
   * once retired is not resurrected — a later registration is a new endpoint.
   */
  async deleteEndpoint(id: string): Promise<void> {
    const existing = await this.getEndpoint(id);
    if (!existing) throw this.notFound(id);

    const now = new Date();
    // Retiring the endpoint and ending its deliveries happen in one transaction.
    // The tombstone hides the row from every read, so a delete that stamped the
    // tombstone but then failed to cancel would leave deliveries queued with no
    // way to retry — a second delete returns not-found. One transaction makes it
    // all-or-nothing: a failure rolls the tombstone back and the endpoint stays
    // visible and retryable.
    //
    // The signing secrets and static headers are cleared. A retired endpoint
    // never delivers again, so the receiver credentials they hold serve no
    // purpose and should not linger; attribution (name, url, event types) is
    // what the delivery history needs and is what is kept.
    await this.query(() =>
      this.withTransaction(async tx => {
        const txDb = tx as DrizzleWriteExecutor;
        await txDb
          .update(this.table)
          .set({
            deletedAt: now,
            enabled: false,
            updatedAt: now,
            secretHash: [],
            headers: null,
          })
          .where(eq(this.table.id, id));
        await this.cancelQueuedDeliveries(txDb, id, "webhook deleted");
      })
    );
    this.registry?.invalidate();
  }

  /**
   * Recover the active signing secrets.
   *
   * Separate from every other read so the route can require a stronger
   * permission for it: the secret is what proves a request came from this
   * install, and it should not arrive incidentally in a list response.
   *
   * Returns every active secret because rotation keeps more than one alive at
   * a time, and a caller reconciling their configuration needs to see them all.
   *
   * A retired endpoint is not found here, like every other read: its secrets are
   * also cleared on delete, so there would be nothing to return in any case.
   */
  async revealSecrets(id: string): Promise<string[]> {
    const rows = await this.query(
      async () =>
        (await this.db
          .select()
          .from(this.table)
          .where(and(eq(this.table.id, id), isNull(this.table.deletedAt)))
          .limit(1)) as WebhookRow[]
    );

    const row = rows[0];
    if (!row) throw this.notFound(id);

    // Only live secrets are revealed: an expired overlap secret no longer signs
    // anything, so returning it would just be a stale key to reconcile against.
    return this.liveSecretEntries(row).map(entry =>
      decryptWebhookSecret(entry.ciphertext)
    );
  }

  /**
   * Validate a requested overlap window, defaulting when omitted. Enforced in
   * the service (not only the route) so a Direct-API caller cannot store an
   * out-of-range window that would keep an old key alive indefinitely.
   */
  private resolveOverlapSeconds(value: number | undefined): number {
    if (value === undefined) return WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS;
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS
    ) {
      throw NextlyError.validation({
        errors: [
          {
            path: "overlapSeconds",
            code: "out_of_range",
            message: `Overlap must be a whole number of seconds between 0 and ${WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS}.`,
          },
        ],
        logContext: { reason: "webhook-overlap-out-of-range", value },
      });
    }
    return value;
  }

  /**
   * Read the endpoint's secrets under a `FOR UPDATE` row lock, let `mutate`
   * compute the next entry list, and write it back in the same transaction.
   *
   * The lock serializes concurrent secret writes: a second rotation blocks until
   * the first commits, then reads the updated row, so it can never overwrite the
   * first's freshly-issued primary from a stale snapshot. The retired-row check
   * runs inside the lock as well, so a rotation or expiry cannot write a secret
   * back onto an endpoint a concurrent `deleteEndpoint` just soft-deleted and
   * cleared. `secret_prefix` follows the new primary (the first entry). A missing
   * or retired row throws not-found.
   */
  private async withLockedSecrets<T>(
    id: string,
    mutate: (
      row: { secretHash: unknown; secretPrefix: string; createdAt: Date },
      now: Date
    ) => { entries: StoredSecretEntry[]; result: T }
  ): Promise<T> {
    const outcome = await this.query(() =>
      this.adapter.transaction(async tx => {
        const rows = await tx.select<{
          secretHash: unknown;
          secretPrefix: string;
          createdAt: Date;
          deletedAt: Date | null;
        }>("nextly_webhooks", {
          where: { and: [{ column: "id", op: "=", value: id }] },
          limit: 1,
          forUpdate: true,
        });
        const row = rows[0];
        if (!row || row.deletedAt != null) return null;

        const now = new Date();
        const { entries, result } = mutate(row, now);
        await tx.update(
          "nextly_webhooks",
          {
            secret_hash: entries,
            secret_prefix: entries[0]?.prefix ?? row.secretPrefix,
            updated_at: now,
          },
          { and: [{ column: "id", op: "=", value: id }] }
        );
        return { result };
      })
    );
    if (outcome === null) throw this.notFound(id);
    return outcome.result;
  }

  /**
   * Rotate the signing secret, keeping the previous one valid for an overlap
   * window so a receiver can switch over without dropping a delivery.
   *
   * A fresh secret becomes the primary that new deliveries are prefixed by. The
   * previous primary is stamped `expiresAt = now + overlapSeconds` and stays
   * live (and signed with, via the Standard Webhooks multi-signature header)
   * until then; `overlapSeconds = 0` retires it at once. At most one overlapping
   * secret is kept — rotating again while one is still overlapping retires the
   * older one — so a delivery never carries more than two signatures, and
   * already-expired entries are pruned. The read-modify-write runs under a row
   * lock, so concurrent rotations serialize rather than lose a secret. The new
   * secret is returned once.
   */
  async rotateSecret(
    id: string,
    input: RotateWebhookSecretInput = {}
  ): Promise<CreatedWebhookEndpoint> {
    const overlapSeconds = this.resolveOverlapSeconds(input.overlapSeconds);

    const secret = await this.withLockedSecrets(id, (row, now) => {
      const fresh = generateWebhookSecret();
      const primary = newSecretEntry(fresh, now);

      // Only the outgoing primary earns an overlap window. Any other live entry
      // is already an overlap from an earlier rotation; a new rotation
      // supersedes it, so it is dropped rather than accumulated — bounding the
      // signature header at two.
      const previousPrimary = this.liveSecretEntries(row, now).find(
        entry => entry.expiresAt === null
      );
      const entries: StoredSecretEntry[] = [primary];
      if (previousPrimary && overlapSeconds > 0) {
        entries.push({
          ...previousPrimary,
          expiresAt: new Date(
            now.getTime() + overlapSeconds * 1000
          ).toISOString(),
        });
      }
      return { entries, result: fresh };
    });

    // The delivery path reads secrets from its own row, but the cached registry
    // still lists this endpoint; invalidate so nothing serves a stale copy.
    this.registry?.invalidate();

    const updated = await this.getEndpoint(id);
    if (!updated) throw this.notFound(id);
    return { endpoint: updated, secret };
  }

  /**
   * Retire every overlapping secret immediately, leaving only the primary. The
   * deliberate way to cut a rotation's overlap short once the receiver has
   * switched. Runs under the same row lock, so it cannot race a rotation or a
   * delete. A no-op (beyond a timestamp touch) when there is nothing to expire.
   */
  async expireOldSecrets(id: string): Promise<WebhookEndpointSummary> {
    await this.withLockedSecrets(id, (row, now) => {
      const primaryOnly = this.liveSecretEntries(row, now).filter(
        entry => entry.expiresAt === null
      );
      return { entries: primaryOnly, result: undefined };
    });
    this.registry?.invalidate();

    const updated = await this.getEndpoint(id);
    if (!updated) throw this.notFound(id);
    return updated;
  }

  /**
   * Send a signed synthetic `webhook.ping` to the endpoint and report whether it
   * was reachable and accepted. A pure connectivity probe: it reads the endpoint
   * RAW (real headers + secrets, unlike the read-redacted summary) and posts
   * out-of-band, writing nothing to the outbox or the delivery queue. Works on a
   * disabled endpoint too, so an operator can verify a receiver before enabling
   * it. `transport` is injectable so tests drive outcomes without real network.
   */
  async testEndpoint(
    id: string,
    options?: {
      transport?: DeliverTransport;
      pingId?: string;
      now?: () => Date;
    }
  ): Promise<WebhookTestResult> {
    const rows = await this.query(
      async () =>
        (await this.db
          .select()
          .from(this.table)
          .where(and(eq(this.table.id, id), isNull(this.table.deletedAt)))
          .limit(1)) as WebhookRow[]
    );
    const row = rows[0];
    if (!row) throw this.notFound(id);

    const secrets = this.liveSecretEntries(row).map(entry =>
      decryptWebhookSecret(entry.ciphertext)
    );
    if (secrets.length === 0) {
      // A delivery must be signed; without a secret there is nothing to sign.
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This endpoint has no active signing secret to sign a test event.",
        logContext: { entity: "webhook-endpoint", id },
      });
    }

    const headers =
      row.headers && typeof row.headers === "object"
        ? (row.headers as Record<string, string>)
        : null;

    return runEndpointProbe({
      webhookId: id,
      url: row.url,
      headers,
      secrets,
      pingId: options?.pingId ?? crypto.randomUUID(),
      transport: options?.transport,
      now: options?.now,
    });
  }

  /**
   * Re-arm a past delivery for another attempt. Scoped by `(webhookId,
   * deliveryId)` so a delivery can only be re-sent through the endpoint that
   * owns it.
   *
   * The unique `(webhook_id, event_id)` index forbids a second delivery row for
   * the same event, so this UPDATES the existing row back to a due state rather
   * than inserting: `pending`, `next_attempt_at = now`, lock cleared, and the
   * attempt budget reset — while the capped `attempts[]` history is left intact
   * so the prior failures stay visible. The delivery id (the Standard-Webhooks
   * `webhook-id`) is reused, so a receiver that already processed it dedupes.
   * The caller triggers the drain; the row is now claimable.
   *
   * Guards, resolved in this order: 404 if the delivery is unknown or belongs to
   * another endpoint (a mistyped or never-created `webhookId` yields no scoped
   * row and so is a not-found, never mistaken for a deleted endpoint); 409 if the
   * delivery is still in flight (a drain worker holds an unexpired lease); 409 if
   * the endpoint has been deleted or is disabled (delivering to it would fail).
   *
   * All of it runs in one transaction under a `FOR UPDATE` lock on the delivery
   * row (a no-op on SQLite, whose transactions already serialize writers). The
   * lock is the write's own lock, so a drain worker that would claim the delivery
   * blocks until this commits, and a worker already holding an unexpired lease is
   * seen and refused rather than revoked. Reading the row before writing is also
   * how the outcome is known, so success is reported only when the row was armed.
   *
   * The endpoint's state is read inside the same transaction rather than through
   * `getEndpoint` beforehand: `getEndpoint` cannot tell a soft-deleted endpoint
   * from one that never existed (both read back as null), which would report a
   * bogus id as a deleted-endpoint conflict instead of a not-found. Because a
   * delivery row outlives its endpoint's soft-delete (the tombstone only cancels
   * queued rows), confirming the delivery first and then inspecting the endpoint
   * row's `deleted_at`/`enabled` distinguishes the three cases cleanly.
   */
  async redeliverDelivery(
    webhookId: string,
    deliveryId: string
  ): Promise<void> {
    const outcome = await this.query(() =>
      this.adapter.transaction(async tx => {
        const rows = await tx.select<{ lockedUntil: Date | null }>(
          "nextly_webhook_deliveries",
          {
            where: {
              and: [
                { column: "id", op: "=", value: deliveryId },
                { column: "webhookId", op: "=", value: webhookId },
              ],
            },
            limit: 1,
            forUpdate: true,
          }
        );
        const delivery = rows[0];
        if (!delivery) return "not-found" as const;

        const leaseHeld =
          delivery.lockedUntil != null &&
          delivery.lockedUntil.getTime() > Date.now();
        if (leaseHeld) return "in-flight" as const;

        // The delivery exists, so its endpoint row does too (a hard delete
        // cascades the delivery away). A tombstone (`deleted_at`) or a cleared
        // `enabled` flag means the re-attempt would fail permanently.
        const endpoints = await tx.select<{
          enabled: boolean | number;
          deletedAt: Date | null;
        }>("nextly_webhooks", {
          where: { and: [{ column: "id", op: "=", value: webhookId }] },
          limit: 1,
        });
        const endpoint = endpoints[0];
        if (!endpoint || endpoint.deletedAt != null) {
          return "endpoint-deleted" as const;
        }
        // Truthiness, not a strict compare: SQLite stores the flag as 0/1.
        if (!endpoint.enabled) return "endpoint-disabled" as const;

        const now = new Date();
        await tx.update(
          "nextly_webhook_deliveries",
          {
            status: "pending",
            next_attempt_at: now,
            attempt_count: 0,
            locked_by: null,
            locked_until: null,
            updated_at: now,
          },
          {
            and: [
              { column: "id", op: "=", value: deliveryId },
              { column: "webhookId", op: "=", value: webhookId },
            ],
          }
        );
        return "rearmed" as const;
      })
    );

    if (outcome === "not-found") {
      throw NextlyError.notFound({
        logContext: { entity: "webhook-delivery", webhookId, deliveryId },
      });
    }
    if (outcome === "in-flight") {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This delivery is currently being sent; try again once it settles.",
        logContext: { entity: "webhook-delivery", webhookId, deliveryId },
      });
    }
    if (outcome === "endpoint-deleted") {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This endpoint has been deleted; its deliveries cannot be re-sent.",
        logContext: { entity: "webhook-endpoint", id: webhookId },
      });
    }
    if (outcome === "endpoint-disabled") {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This endpoint is disabled; enable it before re-sending deliveries.",
        logContext: { entity: "webhook-endpoint", id: webhookId },
      });
    }
  }

  private notFound(id: string): NextlyError {
    return NextlyError.notFound({
      logContext: { entity: "webhook-endpoint", id },
    });
  }
}
