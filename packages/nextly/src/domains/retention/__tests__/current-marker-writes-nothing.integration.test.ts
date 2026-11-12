/**
 * A write offered retention passes whose markers are current sends no
 * statement that fails, on every dialect: the claim reads the marker and
 * stops, where it used to delete nothing and then insert a marker the primary
 * key refused, a failed statement in the database's log for every pass a
 * process offers.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  recordStatements,
  type RecordedStatement,
} from "../../../__tests__/helpers/record-statements";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import * as gate from "../gate";

/** Every retention pass's marker key the gate module declares. */
const MARKER_KEYS = Object.entries(gate)
  .filter(
    (entry): entry is [string, string] =>
      entry[0].endsWith("_GATE_KEY") && typeof entry[1] === "string"
  )
  .map(([, key]) => key);

/** Whether `call` writes the `nextly_meta` table. */
const writesMeta = (call: RecordedStatement) =>
  /^\s*(insert|update|delete|replace)\b/i.test(call.text) &&
  /\bnextly_meta\b/i.test(call.text);

/** Whether `call` reads the `nextly_meta` table. */
const readsMeta = (call: RecordedStatement) =>
  /^\s*select\b/i.test(call.text) &&
  /\bfrom\s+["`]?nextly_meta["`]?/i.test(call.text);

describeEachDialect("a retention claim on a current marker", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: "notes", fields: [text({ name: "body" })] }),
      ],
    });
  });

  afterEach(async () => {
    await current.destroy();
  });

  it("is answered by a read, with no delete and no insert", async () => {
    const store = new gate.MetaRetentionGate(current.adapter);
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    await expect(
      store.claim(gate.WEBHOOK_RETENTION_GATE_KEY, hourAgo, now)
    ).resolves.toBe(true);

    const recorder = await recordStatements(current.adapter, dialect);
    try {
      await expect(
        store.claim(gate.WEBHOOK_RETENTION_GATE_KEY, hourAgo, now)
      ).resolves.toBe(false);
    } finally {
      recorder.uninstall();
    }
    expect(recorder.calls.filter(writesMeta)).toEqual([]);
    expect(recorder.calls.filter(readsMeta)).toHaveLength(1);
  });

  it("a write that offers every pass while its marker is current writes no marker", async () => {
    // Every pass's marker stamped now, as another process's passes leave them.
    const store = new gate.MetaRetentionGate(current.adapter);
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    for (const key of MARKER_KEYS) await store.claim(key, hourAgo, now);

    const handler = current.getService(
      "collectionsHandler"
    ) as CollectionsHandler;
    const recorder = await recordStatements(current.adapter, dialect);
    try {
      const created = await handler.createEntry(
        { collectionName: "notes", overrideAccess: true },
        { body: "hello" }
      );
      expect(created).toMatchObject({ success: true });
    } finally {
      recorder.uninstall();
    }
    // The write offered the passes, so the gate was asked: without a
    // statement on the table the assertion below would hold for a write that
    // offered none.
    expect(
      recorder.calls.filter(call => /\bnextly_meta\b/i.test(call.text)).length
    ).toBeGreaterThan(0);
    expect(recorder.calls.filter(writesMeta)).toEqual([]);
  });
});
