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
import type { WebhookEndpointRegistry } from "../endpoint-registry";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  webhookSecretPrefix,
} from "../secret";
import { REDACTED_HEADER_VALUE } from "../types";
import type { WebhookEventSubscription } from "../types";

/**
 * An endpoint as any caller after creation sees it.
 *
 * Carries `secretPrefix` but never the secret or its ciphertext: reading the
 * secret is a separate, separately-authorisable act, so it must not ride along
 * on an ordinary list or fetch.
 */
export interface WebhookEndpointSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes: WebhookEventSubscription[];
  headers: Record<string, string> | null;
  secretPrefix: string;
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

  /** Narrow a stored row to what a caller may see. */
  private toSummary(row: WebhookRow): WebhookEndpointSummary {
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
      secretPrefix: row.secretPrefix,
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
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      enabled: input.enabled ?? true,
      eventTypes: input.eventTypes,
      filter: null,
      headers: input.headers ?? null,
      // List-shaped from the first write, so adding a second active secret
      // during a rotation is an append rather than a migration.
      secretHash: [encryptWebhookSecret(secret)],
      secretPrefix: webhookSecretPrefix(secret),
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

    const stored = Array.isArray(row.secretHash) ? row.secretHash : [];
    return stored.map(value => decryptWebhookSecret(String(value)));
  }

  private notFound(id: string): NextlyError {
    return NextlyError.notFound({
      logContext: { entity: "webhook-endpoint", id },
    });
  }
}
