import { AsyncLocalStorage } from "node:async_hooks";

import type { PluginDatabase, PluginTransaction } from "@nextlyhq/plugin-sdk";

import type { TxOption } from "../core/ports";

/**
 * A call the plugin made that core's real helper would refuse: a bound
 * crossed, a write outside the transaction it belongs to, a count inside
 * one. Thrown so a test fails at the call rather than passing on a fake that
 * let it through.
 */
export class FakeCoreMisuse extends Error {
  override readonly name = "FakeCoreMisuse";
}

/**
 * The round trip to the store that every core helper makes before it
 * answers. Each fake call yields here first, so concurrent callers in a test
 * interleave as they would against core.
 */
export function roundTrip(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** The clock every fake helper reads, moved only by the test. */
export class FakeClock {
  #now: number;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.#now = start.getTime();
  }

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

interface OpenTransaction {
  tx: PluginTransaction | undefined;
  readonly onCommit: Array<() => void>;
  readonly onRollback: Array<() => void>;
}

/**
 * What the fakes know of the flow's transactions, learned by watching the
 * database's `transaction` (`watch`). With it they keep core's promises: a
 * write given `{ tx }` lands when that transaction commits and never on its
 * rollback; a write without one is refused while a transaction is open; and
 * a code's spend or a limiter count is refused inside one.
 */
export class FakeTransactions {
  readonly #open = new AsyncLocalStorage<OpenTransaction>();

  /** The database, with its `transaction` watched; every other member is the database's own. */
  watch<D extends Pick<PluginDatabase, "transaction">>(db: D): D {
    const open = this.#open;
    const transaction = async <R>(
      fn: (tx: PluginTransaction) => Promise<R>
    ): Promise<R> => {
      if (open.getStore() !== undefined) {
        throw new FakeCoreMisuse(
          "ctx.db.transaction was called inside another transaction"
        );
      }
      const scope: OpenTransaction = {
        tx: undefined,
        onCommit: [],
        onRollback: [],
      };
      let result: R;
      try {
        result = await db.transaction(tx => {
          scope.tx = tx;
          return open.run(scope, () => fn(tx));
        });
      } catch (error) {
        for (const undo of scope.onRollback) undo();
        throw error;
      }
      for (const apply of scope.onCommit) apply();

      return result;
    };

    return new Proxy(db, {
      get(target, property) {
        if (property === "transaction") return transaction;
        const value: unknown = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /** Refuses a call core makes outside any transaction. */
  assertNone(call: string): void {
    if (this.#open.getStore() !== undefined) {
      throw new FakeCoreMisuse(
        `${call} was called while the flow had a transaction open`
      );
    }
  }

  /**
   * Applies a write as core would: now, without `tx` and with no transaction
   * open; at the commit of the transaction `tx` names, running `undo` on its
   * rollback instead.
   */
  write(
    call: string,
    options: TxOption | undefined,
    apply: () => void,
    undo?: () => void
  ): void {
    const open = this.#open.getStore();
    if (options?.tx === undefined) {
      if (open !== undefined) {
        throw new FakeCoreMisuse(
          `${call} was called without { tx } while the flow had a transaction open`
        );
      }
      apply();
      return;
    }
    if (open === undefined || open.tx !== options.tx) {
      throw new FakeCoreMisuse(
        `${call} was given a tx that is not the flow's open transaction`
      );
    }
    open.onCommit.push(apply);
    if (undo !== undefined) open.onRollback.push(undo);
  }
}
