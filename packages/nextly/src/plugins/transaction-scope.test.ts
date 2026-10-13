import { describe, expect, it } from "vitest";

import { transactionScope } from "./transaction-scope";

/**
 * The scope on its own, without a database: what `run` resolves or rejects
 * with, and when the handle stops answering. The callers' own suites
 * (plugin-database, service-opts-wrapper) and the dialect integration suites
 * show the same rule through a real transaction.
 */

/** A statement that fails on a later tick, as a driver's does. */
function failingLater(error: Error): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), 0));
}

/** A statement that succeeds on a later tick, recording that it ran. */
function succeedingLater(log: string[], what: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(() => {
      log.push(what);
      resolve(what);
    }, 0)
  );
}

describe("transactionScope", () => {
  it("rejects with a failed statement the work did not await, though the work resolved", async () => {
    const scope = transactionScope("ctx.db.transaction");
    const violation = new Error("unique violation");
    let unawaited: Promise<unknown> | undefined;

    const outcome = scope
      .run(async () => {
        unawaited = scope.track(failingLater(violation));
        return "work done";
      })
      .catch((error: unknown) => error);

    expect(await outcome).toBe(violation);
    // The promise the work held still rejects: deriving it from the tracked
    // one keeps a failure nobody handled visible to whoever holds it.
    await expect(unawaited).rejects.toBe(violation);
  });

  it("leaves a failure nobody handled to Node's unhandled-rejection report", async () => {
    // The scope handles its own record of every statement, so handing that
    // record back would mark a rejection handled that the caller never
    // looked at. The test runner's own listener is set aside for the
    // duration, so the report reaches this one rather than failing the run.
    const runners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const reported: unknown[] = [];
    const listen = (reason: unknown): void => {
      reported.push(reason);
    };
    process.on("unhandledRejection", listen);
    try {
      const scope = transactionScope("ctx.db.transaction");
      const violation = new Error("unique violation");
      await scope
        .run(async () => {
          void scope.track(failingLater(violation));
        })
        .catch(() => undefined);
      // Node reports an unhandled rejection after the microtask queue drains.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(reported).toEqual([violation]);
    } finally {
      process.off("unhandledRejection", listen);
      for (const runner of runners) process.on("unhandledRejection", runner);
    }
  });

  it("rejects with the failure of the statement started first among those drained", async () => {
    // Started first, failing last: the order is the order the statements
    // were started, which on one connection is the order they ran.
    const scope = transactionScope("ctx.db.transaction");
    const first = new Error("first");
    const second = new Error("second");
    const late = new Promise<never>((_, reject) =>
      setTimeout(() => reject(first), 5)
    );

    const outcome = scope
      .run(async () => {
        scope.track(late).catch(() => undefined);
        scope.track(failingLater(second)).catch(() => undefined);
      })
      .catch((error: unknown) => error);

    expect(await outcome).toBe(first);
  });

  it("commits past a failure the work saw settle and caught", async () => {
    // The control for the drained-failure rule: a statement that failed
    // before the work settled is the work's to handle. Catching it and
    // carrying on — or a service refusal that never reached the database —
    // must not roll the rest back.
    const scope = transactionScope("ctx.db.transaction");
    const log: string[] = [];

    const result = await scope.run(async () => {
      await scope.track(failingLater(new Error("duplicate"))).catch(() => {
        log.push("caught");
      });
      await scope.track(succeedingLater(log, "next write"));
      return "work done";
    });

    expect(result).toBe("work done");
    expect(log).toEqual(["caught", "next write"]);
  });

  it("propagates the work's own error over a statement that failed while it drained", async () => {
    const scope = transactionScope("ctx.db.transaction");
    const workError = new Error("work failed");
    const statementError = new Error("statement failed");
    const log: string[] = [];

    const outcome = scope
      .run(async () => {
        scope.track(failingLater(statementError)).catch(() => undefined);
        void scope.track(succeedingLater(log, "drained"));
        throw workError;
      })
      .catch((error: unknown) => error);

    expect(await outcome).toBe(workError);
    // Drained before rejecting, so nothing the work started is still running
    // when the caller rolls back.
    expect(log).toEqual(["drained"]);
  });

  it("resolves with the work's result when every statement succeeded, after draining them", async () => {
    // The control: the rejection above comes from the failure, not from
    // tracking an un-awaited statement at all.
    const scope = transactionScope("ctx.db.transaction");
    const log: string[] = [];

    const result = await scope.run(async () => {
      void scope.track(succeedingLater(log, "unawaited"));
      return "work done";
    });

    expect(result).toBe("work done");
    expect(log).toEqual(["unawaited"]);
  });

  it("refuses once run has settled, naming the method the author called", async () => {
    const scope = transactionScope("ctx.services.collections.withTransaction");
    await scope.run(async () => {
      scope.assertOpen();
    });

    expect(() => scope.assertOpen()).toThrow(
      expect.objectContaining({
        logContext: { reason: "plugin-transaction-finished" },
        publicData: {
          errors: [
            {
              path: "tx",
              code: "INVALID",
              message:
                "This transaction has already finished: do this work inside the callback you passed to ctx.services.collections.withTransaction.",
            },
          ],
        },
      })
    );
  });
});
