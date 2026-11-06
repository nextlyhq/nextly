/**
 * Webhook domain — a plugin recording an event of a type it declares.
 *
 * `ctx.webhooks.record` reaches the outbox here, through the same recorder
 * core's write paths use, so a plugin's event passes the same gate (an
 * endpoint present, or the audit seam on) and is fanned out and delivered by
 * the same drain. What is the plugin's own is decided before anything is
 * written: the type must be one the published list holds as this plugin's,
 * so an undeclared type, another plugin's or one of core's is refused by
 * name.
 *
 * The event is about the plugin, not a collection: its resource is
 * `{ kind: "plugin", plugin, id? }`, with the plugin's admin slug. It has no
 * `collection`, so a collection-scoped endpoint never receives it.
 *
 * @module domains/webhooks/plugin-record
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { linkedTransaction } from "../../plugins/database/plugin-transaction-link";
import { pluginAdminSlug } from "../../plugins/plugin-slug";
import type { TxOption } from "../../plugins/security/one-time-secrets";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";

import { webhookEventTypes } from "./event-type-registry";
import {
  recordMutationEvent,
  type RecordMutationEventArgs,
} from "./record-mutation-event";
import type { PluginEventType } from "./types";

/** @experimental One event a plugin records: `ctx.webhooks.record(event)`. */
export interface PluginWebhookEvent extends TxOption {
  /** A type this plugin declares in `contributes.webhookEvents`. */
  type: string;
  /** The plugin's own id for what the event is about, e.g. an order's. */
  id?: string;
  /** What subscribers receive as the event's `data`. */
  data: Record<string, unknown>;
  /** The prior state, for a change; its changed fields are worked out from it. */
  previous?: Record<string, unknown> | null;
}

/** @experimental Recording this plugin's own webhook events. */
export interface PluginWebhooksApi {
  /**
   * Record one event of a type this plugin declares, for delivery to the
   * endpoints subscribed to it or to `*`.
   *
   * With `tx`, the handle `ctx.db.transaction` passes its callback, the event
   * commits with the plugin's writes and is never delivered if they roll
   * back. Without one it is recorded on its own, and a call made while the
   * calling flow has a transaction open is refused. A type the plugin does
   * not declare is refused by name before anything is written. Like core's
   * events, nothing is recorded while no endpoint exists and the audit trail
   * is off.
   */
  record(event: PluginWebhookEvent): Promise<void>;
}

/** The adapter, as far as recording needs it. */
type RecordingAdapter = Pick<
  DrizzleAdapter,
  "transaction" | "transactionOpenInFlow"
>;

/** The shape of a recorded event, checked at the plugin boundary. */
const pluginWebhookEventSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
  previous: z.record(z.string(), z.unknown()).nullable().optional(),
  tx: z.unknown().optional(),
});

/** What every refusal is logged under. */
const OPERATION = "webhooks.record";

/**
 * Whether `type` is one the published list holds as `pluginName`'s own. Read
 * from the list every subscription is judged against, so a type a plugin may
 * record and a type an endpoint may subscribe to are one question.
 */
function isOwnEventType(
  pluginName: string,
  type: string
): type is PluginEventType {
  return webhookEventTypes().some(
    entry => entry.owner === pluginName && entry.type === type
  );
}

/** Refuse an event that is malformed or not of one of the plugin's own types. */
function checkedEvent(
  pluginName: string,
  event: unknown
): z.infer<typeof pluginWebhookEventSchema> & { type: PluginEventType } {
  const parsed = pluginWebhookEventSchema.safeParse(event);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join(".") || "event",
        code: "INVALID_WEBHOOK_EVENT",
        message: issue.message,
      })),
      logContext: { operation: OPERATION, plugin: pluginName },
    });
  }
  const { type } = parsed.data;
  if (!isOwnEventType(pluginName, type)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "type",
          code: "UNDECLARED_WEBHOOK_EVENT_TYPE",
          message: `"${type}" is not a webhook event type plugin "${pluginName}" declares in contributes.webhookEvents.`,
        },
      ],
      logContext: { operation: OPERATION, plugin: pluginName, type },
    });
  }
  return { ...parsed.data, type };
}

/** The recorder's arguments for one checked event. */
function recordArgs(
  pluginName: string,
  event: ReturnType<typeof checkedEvent>
): RecordMutationEventArgs {
  return {
    type: event.type,
    resource: {
      kind: "plugin",
      plugin: pluginAdminSlug(pluginName),
      ...(event.id === undefined ? {} : { id: event.id }),
    },
    data: event.data,
    previous: event.previous ?? null,
    // The plugin chose what `data` carries: there is no field config whose
    // secret fields would have to be stripped from it.
    fields: [],
  };
}

/**
 * The webhooks API for one plugin, by its name. The adapter is resolved per
 * call: the context can be built before the database connects.
 */
export function createPluginWebhooks(
  pluginName: string,
  adapter: () => RecordingAdapter
): PluginWebhooksApi {
  return {
    async record(event) {
      // Every check runs before anything is written, the open-transaction
      // refusal included: a write on the pool from inside an open transaction
      // can wait on that transaction's own connection.
      const checked = checkedEvent(pluginName, event);
      const args = recordArgs(pluginName, checked);
      if (checked.tx !== undefined) {
        await linkedTransaction(checked.tx, OPERATION).run(adapterTx =>
          recordMutationEvent(adapterTx, args)
        );
        return;
      }
      const transactions = adapter();
      assertNoOpenTransaction(transactions, OPERATION);
      await runAdapterTransaction<boolean, TransactionContext>(
        run => transactions.transaction(ctx => run(ctx)),
        ctx => recordMutationEvent(ctx, args)
      );
    },
  };
}
