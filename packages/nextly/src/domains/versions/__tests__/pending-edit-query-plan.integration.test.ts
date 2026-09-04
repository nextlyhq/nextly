/**
 * The PLAN the pending-edit read produces — measured, not assumed.
 *
 * 🔴 An index that exists and an index the planner chooses are two different
 * claims, and only the second one is the fix. Before
 * `nextly_versions_pending_edits_idx`, every index on this table led with
 * `scope_kind` — a column this query never constrains — so SQLite answered both
 * dashboard cards with `SCAN nextly_versions`. Proving the count's walk had seen
 * every pending edit therefore meant reading every version ever captured: the
 * 2,000-row budget bounded the rows the walk RECEIVED and nothing whatever about
 * the work the database did to produce them.
 *
 * SQLite only, and deliberately so. `EXPLAIN QUERY PLAN` is the one plan format
 * of the three that is stable enough to assert on, and the property under test —
 * that the predicates are an index seek rather than a table scan — is a
 * consequence of the index's column order, which
 * `schemas/versions/__tests__/pending-edits-index.test.ts` pins for all three
 * dialects.
 *
 * The SQL is CAPTURED from the repository rather than written out here. A
 * hand-written query would be a second derivation of the same intent, and it
 * could go on being served by an index after the real one had drifted away from
 * it — proving something about a statement the product never sends.
 */
import { sql as rawSql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";

/** Drizzle db proxy that records the SQL of every select it is asked to run. */
function captureSelectSql(adapter: unknown, sink: string[]): void {
  const host = adapter as { getDrizzle: (...args: unknown[]) => unknown };
  const original = host.getDrizzle.bind(host);
  host.getDrizzle = (...args: unknown[]) => {
    const db = original(...args) as object;
    const wrapBuilder = (builder: object): object =>
      new Proxy(builder, {
        get(target, prop, receiver) {
          if (prop === "then") {
            const toSql = (target as { toSQL?: () => { sql: string } }).toSQL;
            if (typeof toSql === "function") sink.push(toSql.call(target).sql);
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...callArgs: unknown[]) => {
            const out = (value as (...a: unknown[]) => unknown).apply(
              target,
              callArgs
            );
            return out && typeof out === "object" && "toSQL" in out
              ? wrapBuilder(out as object)
              : out;
          };
        },
      });
    return new Proxy(db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...a: unknown[]) => unknown).bind(target);
        if (prop !== "select") return bound;
        return (...callArgs: unknown[]) =>
          wrapBuilder(bound(...callArgs) as object);
      },
    });
  };
}

/** `sql` with its placeholders filled, so it can be explained as written. */
function bind(sql: string, values: readonly string[]): string {
  let next = 0;
  return sql.replace(/\?/g, () => values[next++] ?? "NULL");
}

async function plan(adapter: unknown, statement: string): Promise<string> {
  const rows = await (
    adapter as { queryStatement: (s: unknown) => Promise<{ detail: string }[]> }
  ).queryStatement(rawSql.raw(`EXPLAIN QUERY PLAN ${statement}`));
  return rows.map(row => row.detail).join(" | ");
}

describe("pending-edit read plan (sqlite)", () => {
  it("seeks the pending-edits index instead of scanning the table", async () => {
    const handle = await createTestNextly();
    try {
      if (handle.adapter.getCapabilities().dialect !== "sqlite") return;
      const repo = new VersionsRepository(handle.adapter);

      // History has to OUTNUMBER the working drafts for the difference to mean
      // anything: the defect is that proving exhaustion walks the durable rows
      // too, and a table holding only drafts cannot show it.
      for (let i = 0; i < 200; i++) {
        const ref: VersionRef = {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: `entry-${i % 40}`,
        };
        await repo.insertVersion({
          ref,
          versionNo: Math.floor(i / 40) + 1,
          status: "published",
          isAutosave: false,
          snapshot: { title: `v${i}` },
        });
      }
      for (let i = 0; i < 3; i++) {
        await repo.upsertWorkingDraft({
          ref: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: `entry-${i}`,
          },
          locale: null,
          snapshot: { title: `draft-${i}` },
        });
      }

      const captured: string[] = [];
      captureSelectSql(handle.adapter, captured);

      for (const order of ["identity", "recency"] as const) {
        const rows = await repo.findPendingEditRows({
          slugs: ["posts"],
          limit: 100,
          order,
        });
        // The control: the query this plan describes is the one that answers.
        // A plan asserted over a statement returning nothing would be green for
        // a read that had stopped working.
        expect(rows).toHaveLength(3);
      }

      expect(captured).toHaveLength(2);
      for (const statement of captured) {
        const detail = await plan(
          handle.adapter,
          bind(statement, ["0", "'draft'", "'posts'", "100"])
        );
        expect(detail).toContain("nextly_versions_pending_edits_idx");
        // The claim is the absence of a scan, stated on its own: an index can
        // be NAMED in a plan that still walks the table through it, which is
        // exactly what the primary-key autoindex did for the identity order.
        expect(detail).not.toContain("SCAN");
      }
    } finally {
      await handle.destroy();
    }
  });
});
