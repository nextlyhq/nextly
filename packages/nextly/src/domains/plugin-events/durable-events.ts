/**
 * Recording a plugin's durable events: a row in `nextly_plugin_events`,
 * written with the work that emitted it, for a dispatcher to deliver to every
 * durable subscriber until each succeeds.
 *
 * Only an event the plugin declared `durable: true` is recorded, and only a
 * JSON object of at most 64 KiB, both refused before anything is written.
 * The row commits or rolls back with the plugin's own transaction when it
 * passes one (`{ tx }`); otherwise it is written as `runDurableWrite` decides,
 * the one place the rule for a call inside an open transaction lives.
 *
 * @module domains/plugin-events/durable-events
 * @experimental
 */
import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginTransaction } from "../../plugins/database/plugin-database";
import { linkedTransaction } from "../../plugins/database/plugin-transaction-link";
import { PLUGIN_EVENTS_TABLE } from "../../schemas/plugin-events";

/** The largest payload recorded, in bytes of its JSON. */
export const MAX_DURABLE_PAYLOAD_BYTES = 64 * 1024;

/** What recording needs from the database adapter. */
export type DurableEventsAdapter = Pick<
  DrizzleAdapter,
  "transaction" | "afterCommit"
>;

/** What a plugin's recorder is built from. */
export interface DurableEventRecorderOptions {
  /** The plugin's name: every event it records is its own. */
  owner: string;
  /** The events the plugin declared durable (`durableEventNames`). */
  durable: ReadonlySet<string>;
  /** The adapter, resolved per call: the recorder can be built before it connects. */
  adapter: () => DurableEventsAdapter;
  /** The clock; injectable for tests. */
  now?: () => Date;
  /**
   * The prompt dispatch a committed event offers, or null where there is
   * none; without it, events wait for the scheduled sweep.
   */
  kick?: () => { offer(): void } | null;
}

/** Where a durable event is written. */
export interface RecordDurableOptions {
  /**
   * The handle `ctx.db.transaction` passes its callback: the event commits
   * or rolls back with the plugin's writes.
   */
  tx?: PluginTransaction;
}

/** A plugin's durable events, recorded. */
export interface DurableEventRecorder {
  record(
    name: string,
    payload: Record<string, unknown>,
    options?: RecordDurableOptions
  ): Promise<{ id: string }>;
}

/** The names among a plugin's declared events that are durable. */
export function durableEventNames(
  events: ReadonlyArray<{ name: string; durable?: boolean }> | undefined
): ReadonlySet<string> {
  return new Set(
    (events ?? []).filter(event => event.durable === true).map(e => e.name)
  );
}

/**
 * Run a durable event's write. On the plugin's transaction when it passed
 * one; else on the adapter, which joins the transaction the calling flow has
 * open (as a savepoint where the dialect has one) and opens one of its own
 * when there is none. The one place this rule is decided, so the public emit
 * answers it as one function does.
 */
async function runDurableWrite<R>(
  adapter: DurableEventsAdapter,
  tx: PluginTransaction | undefined,
  work: (adapterTx: TransactionContext) => Promise<R>,
  committed: () => void
): Promise<R> {
  if (tx !== undefined) {
    const link = linkedTransaction(tx, "events.recordDurable");
    const result = await link.run(work);
    // Held until the plugin's transaction commits, and dropped if it rolls
    // back: there is nothing to deliver for a discarded event.
    link.afterCommit(committed);
    return result;
  }
  const result = await adapter.transaction(work);
  // Held until the transaction the calling flow holds commits, if it holds
  // one; run now when the write committed in a transaction of its own.
  await adapter.afterCommit(committed);
  return result;
}

/** `payload` as the JSON a row stores, or a refusal naming what is wrong. */
function payloadJson(name: string, payload: unknown): string {
  const refuse = (problem: string): never => {
    throw NextlyError.invalidInput({
      message: `The durable event "${name}" was refused: its payload ${problem}.`,
      logContext: { event: name },
    });
  };
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return refuse("must be a JSON object");
  }
  let json: unknown;
  try {
    json = JSON.stringify(payload);
  } catch {
    // A cycle, or a value JSON cannot hold, such as a bigint.
    return refuse("cannot be written as JSON");
  }
  // What is stored is what JSON.stringify gives, which a `toJSON` decides:
  // judged as stored, so an object that serializes to a string, an array or
  // nothing at all is refused like one that is not an object.
  if (typeof json !== "string" || !json.startsWith("{")) {
    return refuse("must be written as a JSON object");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_DURABLE_PAYLOAD_BYTES) {
    return refuse(`is larger than ${MAX_DURABLE_PAYLOAD_BYTES} bytes as JSON`);
  }
  return json;
}

/** Build the recorder of one plugin's durable events. */
export function createDurableEventRecorder(
  options: DurableEventRecorderOptions
): DurableEventRecorder {
  const now = options.now ?? (() => new Date());
  return {
    async record(name, payload, recordOptions) {
      // Every check before any write: a refused event leaves nothing behind.
      // The plugin's own durable declarations already lie in its namespace
      // and outside core's, as resolution checked them.
      if (!options.durable.has(name)) {
        throw NextlyError.invalidInput({
          message: `The event "${name}" is not one this plugin declares durable, so it cannot be recorded.`,
          logContext: { owner: options.owner, event: name },
        });
      }
      const json = payloadJson(name, payload);
      const id = randomUUID();
      await runDurableWrite(
        options.adapter(),
        recordOptions?.tx,
        tx =>
          tx.insert(PLUGIN_EVENTS_TABLE, {
            id,
            owner: options.owner,
            name,
            payload: json,
            createdAt: now(),
            fannedOutAt: null,
            finishedAt: null,
          }),
        // Offers the prompt dispatch; never throws, so a committed write
        // never fails on its account.
        () => options.kick?.()?.offer()
      );
      return { id };
    },
  };
}
