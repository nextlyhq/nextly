/**
 * Whether the calling async flow has a transaction open, on every dialect.
 *
 * The answer belongs to the flow, never to the connection: on SQLite every
 * request shares one connection, so a connection-wide answer would refuse a
 * request whose only fault is that another request has a transaction open.
 * It must also see the transactions core's services open, which run through
 * Drizzle's own handle on PostgreSQL and MySQL rather than through the
 * adapter, and it must last until the transaction has finished, for work the
 * transaction left running as much as for its own.
 */
import { afterAll, beforeAll, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { BaseService } from "../../base-service";
import { consoleLogger } from "../../types";
import { assertNoOpenTransaction } from "../open-transaction";

/** A core service, for the transaction its `withTransaction` opens. */
class ServiceTransaction extends BaseService {
  run<T>(work: () => Promise<T>): Promise<T> {
    return this.withTransaction(() => work());
  }
}

/** A promise and the function that settles it, to hold a flow at one point. */
function gate(): { wait: Promise<void>; open: () => void } {
  let settle: () => void = () => undefined;
  const wait = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { wait, open: () => settle() };
}

/** What `run` threw, or undefined when it returned. */
function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describeEachDialect(
  "whether the calling flow has a transaction open",
  dialect => {
    let current: TestNextly;

    beforeAll(async () => {
      current = await createTestNextly({ dialect });
    });

    afterAll(async () => {
      await current.destroy();
    });

    it("is false outside a transaction, and true inside the adapter's until it has finished", async () => {
      const { adapter } = current;
      expect(adapter.transactionOpenInFlow()).toBe(false);

      const inside = await adapter.transaction(() =>
        Promise.resolve(adapter.transactionOpenInFlow())
      );

      expect(inside).toBe(true);
      expect(adapter.transactionOpenInFlow()).toBe(false);
    });

    it("is true inside a transaction a core service opens", async () => {
      const service = new ServiceTransaction(current.adapter, consoleLogger);

      const inside = await service.run(() =>
        Promise.resolve(current.adapter.transactionOpenInFlow())
      );

      expect(inside).toBe(true);
      expect(current.adapter.transactionOpenInFlow()).toBe(false);
    });

    it("holds for work the transaction left running until the transaction has finished", async () => {
      const { adapter } = current;
      const held = gate();
      let leftRunning: Promise<[boolean, boolean]> | undefined;

      await adapter.transaction(() => {
        leftRunning = (async () => {
          const during = adapter.transactionOpenInFlow();
          await held.wait;
          return [during, adapter.transactionOpenInFlow()];
        })();
        return Promise.resolve();
      });
      held.open();

      // True while the transaction was open, false once it had finished.
      expect(await leftRunning).toEqual([true, false]);
    });

    it("stays true in an outer transaction after one nested in it has finished", async () => {
      const { adapter } = current;

      const seen = await adapter.transaction(async () => {
        const inner = await adapter.transaction(() =>
          Promise.resolve(adapter.transactionOpenInFlow())
        );
        return [inner, adapter.transactionOpenInFlow()];
      });

      expect(seen).toEqual([true, true]);
      expect(adapter.transactionOpenInFlow()).toBe(false);
    });

    it("is false for a flow while another flow holds a transaction open, and the flow's own then runs on its own", async () => {
      const { adapter } = current;
      const opened = gate();
      const held = gate();
      const order: string[] = [];

      const other = adapter.transaction(async () => {
        order.push("the other opened");
        opened.open();
        await held.wait;
        order.push("the other finishing");
      });
      await opened.wait;

      // Another request's transaction is open, and this flow is in none.
      expect(adapter.transactionOpenInFlow()).toBe(false);
      expect(
        thrownBy(() => assertNoOpenTransaction(adapter, "a count"))
      ).toBeUndefined();

      const own = adapter.transaction(() => {
        order.push("this flow's own ran");
        return Promise.resolve(adapter.transactionOpenInFlow());
      });
      held.open();

      expect(await own).toBe(true);
      await other;
      if (dialect === "sqlite") {
        // One connection: the flow's own transaction waited for the open one
        // rather than joining it, so the other's rollback could not undo it.
        expect(order).toEqual([
          "the other opened",
          "the other finishing",
          "this flow's own ran",
        ]);
      }
    });

    it("refuses inside a transaction with an internal error naming the operation, and lets it through outside", async () => {
      const { adapter } = current;
      expect(
        thrownBy(() => assertNoOpenTransaction(adapter, "a count"))
      ).toBeUndefined();

      const refusal = await adapter.transaction(() =>
        Promise.resolve(
          thrownBy(() => assertNoOpenTransaction(adapter, "a count"))
        )
      );

      expect(NextlyError.isCode(refusal, "INTERNAL_ERROR")).toBe(true);
      expect(NextlyError.is(refusal) ? refusal.logContext : undefined).toEqual({
        operation: "a count",
      });
    });
  }
);
