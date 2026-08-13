/**
 * The email delivery log is swept, and swept completely.
 *
 * The table records who was written to, keyed by an HMAC of their address, and
 * it grows on every send. Two things therefore matter more than the mechanics:
 * that a row past its window actually goes, and that no row can sit outside
 * every branch of the sweep and survive indefinitely while the pass reports
 * success.
 *
 * That second property is the one a test has to force, because its failure mode
 * is silent: a class the prune does not scope for matches nothing, deletes
 * nothing, and looks exactly like a class with nothing to prune.
 */

import { describe, expect, it, vi } from "vitest";

import { EMAIL_RETENTION_CLASS } from "../delivery-record";
import {
  EMAIL_PRUNE_BATCH_SIZE,
  pruneEmailData,
  pruneEmailDataSafely,
  type EmailPruneAdapter,
} from "../prune";
import {
  EMAIL_RETENTION_CLASSES,
  resolveEmailRetentionConfig,
} from "../retention-config";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** An adapter double that records what it was asked, and hands back ids. */
function adapterWith(idsPerCall: string[][]): {
  adapter: EmailPruneAdapter;
  selects: Array<{ table: string; options?: unknown }>;
  deletes: Array<{ table: string; where: unknown }>;
} {
  const selects: Array<{ table: string; options?: unknown }> = [];
  const deletes: Array<{ table: string; where: unknown }> = [];
  let call = 0;
  const adapter: EmailPruneAdapter = {
    select: async (table, options) => {
      selects.push({ table, options });
      const ids = idsPerCall[call] ?? [];
      call += 1;
      return ids.map(id => ({ id })) as never;
    },
    delete: async (table, where) => {
      deletes.push({ table, where });
      const last = deletes.length - 1;
      const condition = (where.and[0] as { value: string[] }).value;
      void last;
      return condition.length;
    },
  };
  return { adapter, selects, deletes };
}

describe("sweeping the email delivery log", () => {
  it("deletes rows past the window and reports how many", async () => {
    const { adapter, deletes } = adapterWith([["a", "b", "c"]]);
    const result = await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig()
    );

    expect(result.deliveries).toBe(3);
    expect(deletes).toHaveLength(1);
  });

  it("asks only for rows older than the configured window", async () => {
    const { adapter, selects } = adapterWith([[]]);
    await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig({ maxAgeMs: 30 * DAY_MS })
    );

    const where = (
      selects[0]?.options as { where: { and: Array<Record<string, unknown>> } }
    ).where.and;
    const cutoff = where.find(c => c.column === "createdAt");
    expect(cutoff?.op).toBe("<");
    expect(cutoff?.value).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
  });

  it("keeps everything when the window is false", async () => {
    const { adapter, selects, deletes } = adapterWith([["a"]]);
    const result = await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig({ maxAgeMs: false })
    );

    // Not "deleted nothing" — never ASKED. An operator keeping the log
    // indefinitely should cost no query at all.
    expect(result.deliveries).toBe(0);
    expect(selects).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("scopes every delete to a class the policy governs", async () => {
    const { adapter, selects } = adapterWith([[]]);
    await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig()
    );

    const scoped = selects.map(s => {
      const where = (
        s.options as { where: { and: Array<Record<string, unknown>> } }
      ).where.and;
      return where.find(c => c.column === "retentionClass")?.value;
    });
    expect(scoped).toEqual([...EMAIL_RETENTION_CLASSES]);
  });

  it("sweeps every class a delivery row can be written with", () => {
    // The completeness guard, and the reason the class list exists. The prune
    // scopes its DELETE by class, so a class the writer can stamp but the list
    // omits matches no branch: those rows are never selected, never deleted,
    // and the pass returns success having left them. Nothing else in the suite
    // can observe that, because "no rows matched" is also what a swept class
    // looks like.
    expect(EMAIL_RETENTION_CLASSES).toContain(EMAIL_RETENTION_CLASS);
  });

  it("stops at the batch budget rather than running unbounded", async () => {
    const full = Array.from(
      { length: EMAIL_PRUNE_BATCH_SIZE },
      (_, i) => `id-${i}`
    );
    const { adapter, deletes } = adapterWith([full, full, full, full]);

    await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig(),
      2
    );

    // A full batch means more may remain, so the loop only stops because the
    // budget ran out — which is the property being pinned.
    expect(deletes).toHaveLength(2);
  });

  it("stops early when a short batch says nothing older remains", async () => {
    const { adapter, deletes } = adapterWith([["a"], ["b"]]);
    await pruneEmailData(
      { adapter, now: () => NOW },
      resolveEmailRetentionConfig(),
      5
    );

    expect(deletes).toHaveLength(1);
  });

  it("never lets housekeeping fail a send", async () => {
    const warn = vi.fn();
    const adapter: EmailPruneAdapter = {
      select: async () => {
        throw new Error("connection lost");
      },
      delete: async () => 0,
    };

    const result = await pruneEmailDataSafely(
      { adapter, now: () => NOW, logger: { warn } as never },
      resolveEmailRetentionConfig()
    );

    expect(result.deliveries).toBe(0);
    // Logged rather than swallowed: a pass that stops silently leaves the table
    // growing while the setting reads as enforced.
    expect(warn).toHaveBeenCalled();
  });
});
