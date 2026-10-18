/**
 * The scheduled drain sweeps a deleted subject's content events past the
 * activity log's window.
 *
 * Write paths offer the content-events pass capped, and an install that stops
 * writing offers it never; the drain is the trigger that keeps running, so it
 * sweeps them on a marker of its own, and leaves them alone when the activity
 * log keeps everything.
 */
import { describe, expect, it } from "vitest";

import { resolveAuditRetentionConfig } from "../../audit/retention-config";
import { CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY } from "../../retention/gate";
import { runDrain } from "../run-drain";

/** A database with no events and no deliveries due, so only retention runs. */
function idleDb(): never {
  return {
    select: async () => [],
    update: async () => [],
    insert: async () => [],
    delete: async () => 0,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(undefined),
  } as never;
}

/**
 * An adapter whose record holds one subject deleted long ago: an event its
 * deletion stamped, and the deletion, until they are removed.
 */
function oneDeletedSubject() {
  let left = true;
  const deleted: string[] = [];
  return {
    deleted,
    adapter: {
      select: async (table: string, query?: { limit?: number }) => {
        if (table !== "nextly_content_events" || !left) return [];
        // The oldest deletion asks for one row; its life's batch, for the
        // events the deletion stamped other than itself.
        return query?.limit === 1 ? [{ id: "e2" }] : [{ id: "e1" }];
      },
      delete: async (table: string) => {
        deleted.push(table);
        if (table === "nextly_content_events") left = false;
        return 0;
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(undefined),
    },
  };
}

function drain(activityMaxAgeMs: number | false) {
  const claimed: string[] = [];
  const store = oneDeletedSubject();
  const run = runDrain({
    fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
    deliver: { db: idleDb(), now: () => new Date(0) } as never,
    retention: {
      auditPolicy: resolveAuditRetentionConfig({ activityMaxAgeMs }),
      prune: { adapter: store.adapter } as never,
      gate: {
        claim: async (key: string) => {
          claimed.push(key);
          return true;
        },
        release: async () => undefined,
      },
    },
  });
  return { run, claimed, store };
}

describe("the scheduled drain and content events", () => {
  it("sweeps a deleted subject's events on its own marker, parts first", async () => {
    const { run, claimed, store } = drain(1000);
    const result = await run;
    expect(claimed).toContain(CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY);
    expect(store.deleted).toEqual([
      "nextly_content_event_parts",
      "nextly_content_events",
    ]);
    expect(result.pruned.contentEvents).toBe(2);
  });

  it("leaves content events alone when the activity log keeps everything", async () => {
    const { run, claimed, store } = drain(false);
    const result = await run;
    expect(claimed).not.toContain(CONTENT_EVENTS_RETENTION_DRAIN_GATE_KEY);
    expect(store.deleted).toEqual([]);
    expect(result.pruned.contentEvents).toBe(0);
  });
});
