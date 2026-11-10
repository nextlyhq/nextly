/**
 * Which code the transaction-escape check names as the opener of a
 * `ctx.db.transaction`.
 *
 * The check keys an escape from a transaction by the first frame of the stack
 * that opened it outside the adapters, skipping wrapper frames whose function
 * name matches /transaction/i. The plugin surface's own frames must all be
 * skipped, so the key names the plugin code that called it; a frame of the
 * surface that the check does not skip would key every caller's escapes alike.
 */
import { describe, expect, it } from "vitest";

import {
  OPENED_BY,
  takeTransactionEscapes,
} from "../../../__tests__/transaction-escapes";
import type { SchemaOwner } from "../../../domains/schema/extension/types";
import { createPluginDatabase } from "../plugin-database";

const OWNER: SchemaOwner = { kind: "plugin", id: "fx" };

/** The observer the adapters report escapes to, as the test setup installs it. */
const OBSERVER = Symbol.for("nextly.transactionEscapeObserver");

/**
 * Report an escape as an adapter does for a statement with no call site of
 * its own, from a transaction opened where `openedAt` was captured.
 */
function reportEscape(openedAt: string): void {
  const observe: unknown = Reflect.get(globalThis, OBSERVER);
  if (typeof observe !== "function") {
    throw new Error("The test setup installs the escape observer.");
  }
  Reflect.apply(observe, undefined, [
    {
      dialect: "postgresql",
      stack: "Error\n    at node:internal/process/task_queues:105:5",
      openedAt,
      statement: "SELECT 1",
    },
  ]);
}

describe("the opener the escape check names for ctx.db.transaction", () => {
  it("is the caller's frame, not the plugin surface's", async () => {
    const db = {};
    const surface = createPluginDatabase({
      dialect: "postgresql",
      owner: OWNER,
      dependsOn: new Set(),
      owners: () => new Map(),
      tables: () => ({}),
      tableList: () => [],
      db: () => db,
      relationalDb: () => db,
      // An adapter captures the opening stack synchronously, inside the call
      // the surface makes to open the transaction, and from a frame the check
      // skips: this method's, a wrapper by its name.
      transaction(fn) {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 64;
        const openedAt = new Error().stack ?? "";
        Error.stackTraceLimit = limit;
        reportEscape(openedAt);
        return fn({ db, relationalDb: db, afterCommit: () => undefined });
      },
    });

    await surface.transaction(async () => undefined);

    const keys = takeTransactionEscapes().map(escape => escape.key);
    expect(keys).toEqual([
      `packages/nextly/src/plugins/database/__tests__/transaction-opener.test.ts#<anonymous>${OPENED_BY} · select`,
    ]);
  });
});
