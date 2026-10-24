import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { transactionScope } from "../../transaction-scope";
import {
  linkedTransaction,
  linkPluginTransaction,
} from "../plugin-transaction-link";

/**
 * A contained run on a plugin's transaction, without a database: which
 * savepoint statements reach the transaction, and what the transaction then
 * resolves or rejects with. The dialect suites show the same through a real
 * PostgreSQL transaction (principal-delivery-erasure.integration.test).
 */

/** A transaction that records the savepoint statements it is sent. */
function recordingTx(log: string[], savepoints = true): TransactionContext {
  const tx = {} as TransactionContext;
  if (savepoints) {
    tx.savepoint = async (name: string) => {
      log.push(`savepoint ${name}`);
    };
    tx.rollbackToSavepoint = async (name: string) => {
      log.push(`rollback to ${name}`);
    };
    tx.releaseSavepoint = async (name: string) => {
      log.push(`release ${name}`);
    };
  }
  return tx;
}

/** A plugin transaction surface linked to `tx`, and its scope. */
function linked(tx: TransactionContext) {
  const scope = transactionScope("ctx.db.transaction");
  const surface = {};
  // No commit follows here; the dialect suite runs the held effects.
  linkPluginTransaction(surface, tx, scope, () => undefined);
  return { scope, link: linkedTransaction(surface, "test write") };
}

/** Fails on a later tick, as a driver's statement does. */
function failingLater(error: Error): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), 0));
}

/** The savepoint name a log line names, so a test need not know the sequence. */
const named = (line: string): string => line.split(" ").at(-1) ?? "";

describe("LinkedTransaction.runContained", () => {
  it("rolls a failed write back to its savepoint and lets the transaction commit", async () => {
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    const outcome = await scope.run(async () => {
      // The writer carries on past its failure, as a fail-safe recorder does.
      await link
        .runContained(() => failingLater(new Error("insert failed")))
        .catch(() => undefined);
      return "committed";
    });

    expect(outcome).toBe("committed");
    expect(log.map(line => line.split(" ")[0])).toEqual([
      "savepoint",
      "rollback",
      "release",
    ]);
    // All three name the one savepoint.
    expect(new Set(log.map(named)).size).toBe(1);
  });

  it("releases the savepoint of a write that succeeded, rolling nothing back", async () => {
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    await scope.run(() => link.runContained(async () => "written"));

    expect(log.map(line => line.split(" ")[0])).toEqual([
      "savepoint",
      "release",
    ]);
  });

  it("fails the transaction when the rollback undid a statement the plugin started meanwhile", async () => {
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    const outcome = scope.run(async () => {
      await link
        .runContained(async () => {
          // The plugin's own write, started while the core write ran: the
          // rollback to the savepoint undoes it though it reported success.
          await scope.track(Promise.resolve("plugin row"));
          throw new Error("insert failed");
        })
        .catch(() => undefined);
      return "committed";
    });

    await expect(outcome).rejects.toMatchObject({
      logContext: { reason: "plugin-transaction-statement-undone" },
    });
  });

  it("keeps the transaction when the plugin's statement came before the savepoint", async () => {
    // The control for the one above: a statement started before the contained
    // write reached the connection ahead of its savepoint, and nothing rolls it
    // back, so the transaction still commits.
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    const outcome = await scope.run(async () => {
      await scope.track(Promise.resolve("plugin row"));
      await link
        .runContained(() => failingLater(new Error("insert failed")))
        .catch(() => undefined);
      return "committed";
    });

    expect(outcome).toBe("committed");
  });

  it("keeps the transaction when the plugin's statement starts once the rollback is sent", async () => {
    // A statement started after the rollback to the savepoint was sent is
    // queued behind it on the connection, so the rollback cannot undo it, and
    // failing the transaction would discard the plugin's write for nothing.
    const log: string[] = [];
    const tx = recordingTx(log);
    const { scope, link } = linked(tx);
    const rollback = tx.rollbackToSavepoint!;
    tx.rollbackToSavepoint = async (name: string) => {
      const sent = rollback(name);
      void scope.track(Promise.resolve("plugin row"));
      await sent;
    };

    const outcome = await scope.run(async () => {
      await link
        .runContained(() => failingLater(new Error("insert failed")))
        .catch(() => undefined);
      return "committed";
    });

    expect(outcome).toBe("committed");
  });

  it("keeps the transaction when only a plugin read ran during the failed write", async () => {
    // A rollback to the savepoint cannot discard a read, so a read the
    // plugin made meanwhile is no reason to fail its transaction.
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    const outcome = await scope.run(async () => {
      await link
        .runContained(async () => {
          await scope.track(Promise.resolve(["a row"]), "read");
          throw new Error("insert failed");
        })
        .catch(() => undefined);
      return "committed";
    });

    expect(outcome).toBe("committed");
  });

  it("opens the savepoint only once the plugin's statements already in flight have finished", async () => {
    // A statement started before the contained write may reach the
    // connection after its savepoint (a lazy query, or work of several
    // steps such as a deletion report), and a rollback to the savepoint
    // would then undo it unseen. So the savepoint waits for it.
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    await scope.run(async () => {
      void scope.track(
        new Promise(resolve =>
          setTimeout(() => {
            log.push("plugin write finished");
            resolve("row");
          }, 5)
        )
      );
      await link
        .runContained(() => failingLater(new Error("insert failed")))
        .catch(() => undefined);
    });

    expect(log[0]).toBe("plugin write finished");
    expect(log[1]?.startsWith("savepoint")).toBe(true);
  });

  it("waits likewise for a linked run of several steps started before it", async () => {
    // A deletion report runs on the plugin's transaction through `run`, as
    // one tracked unit making several awaited statements.
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    await scope.run(async () => {
      const report = link.run(async () => {
        await new Promise(resolve => setTimeout(resolve, 2));
        log.push("report step 1");
        await new Promise(resolve => setTimeout(resolve, 2));
        log.push("report step 2");
      });
      await link
        .runContained(() => failingLater(new Error("insert failed")))
        .catch(() => undefined);
      await report;
    });

    expect(log.slice(0, 3).map(line => line.split(" ")[0])).toEqual([
      "report",
      "report",
      "savepoint",
    ]);
  });

  it("runs contained writes one at a time, so one never rolls back another's", async () => {
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log));

    await scope.run(async () => {
      await Promise.all([
        link
          .runContained(() => failingLater(new Error("first failed")))
          .catch(() => undefined),
        link.runContained(async () => "second written"),
      ]);
    });

    // The second savepoint is taken only once the first is released.
    const verbs = log.map(line => line.split(" ")[0]);
    expect(verbs).toEqual([
      "savepoint",
      "rollback",
      "release",
      "savepoint",
      "release",
    ]);
    expect(named(log[0])).not.toBe(named(log[3]));
  });

  it("runs the write as it is where the transaction has no savepoints", async () => {
    const log: string[] = [];
    const { scope, link } = linked(recordingTx(log, false));

    const outcome = await scope.run(async () => {
      const failed = await link
        .runContained(() => failingLater(new Error("insert failed")))
        .then(
          () => "resolved",
          (error: Error) => error.message
        );
      return failed;
    });

    expect(outcome).toBe("insert failed");
    expect(log).toEqual([]);
  });
});
