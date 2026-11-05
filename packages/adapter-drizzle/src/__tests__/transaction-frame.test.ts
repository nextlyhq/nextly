/**
 * The base adapter's transaction frames: how an outermost transaction and the
 * parts joined to it open and close, which held effects survive a rollback,
 * and when held effects are handed back.
 *
 * The adapter here runs no SQL. Its steps record the statements a dialect
 * would run, so each test can say which statements ran and in what order.
 */

import { AsyncResource } from "node:async_hooks";

import { describe, expect, it } from "vitest";

import { DrizzleAdapter } from "../adapter";
import type { TransactionFrame } from "../transaction-frame";
import type {
  DatabaseCapabilities,
  SupportedDialect,
  TransactionContext,
  TransactionOptions,
} from "../types";

/** The work in these tests never queries, so it is handed an empty context. */
const CONTEXT = {} as TransactionContext;

/** An adapter whose transactions go through the base's frames and record their statements. */
class FrameAdapter extends DrizzleAdapter {
  readonly dialect: SupportedDialect = "sqlite";
  readonly statements: string[] = [];

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async executeQuery<T = unknown>(): Promise<T[]> {
    return [];
  }

  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const frame = this.beginTransactionCall();
    if (frame) {
      return this.runJoined(
        frame,
        depth => frame.join.adapter(depth),
        work,
        options
      );
    }
    const settled = await this.settleOutermost(
      {
        ...this.steps("BEGIN", "COMMIT", "ROLLBACK"),
        join: {
          adapter: depth =>
            this.flatJoin
              ? { ...this.steps("", "", ""), dooms: () => true }
              : this.steps(
                  `SAVEPOINT ${depth}`,
                  `RELEASE ${depth}`,
                  `ROLLBACK TO ${depth}`
                ),
        },
      },
      work,
      options
    );
    await this.runHeldEffects(settled.effects);
    if (settled.committed) return settled.result;
    throw settled.error;
  }

  /** Join flat, as MySQL does: no savepoint, and a part's failure dooms the transaction. */
  flatJoin = false;

  /** Make COMMIT, or ROLLBACK, fail. */
  failCommit = false;
  failRollback = false;

  /** What the adapter logged as a held effect's failure. */
  readonly logged: Error[] = [];

  protected override logHeldEffectFailure(failure: Error): void {
    this.logged.push(failure);
  }

  /** An outermost transaction through `runOutermost`, the contract a dialect may call. */
  outermost<T>(work: () => Promise<T>) {
    return this.runOutermost(
      { ...this.steps("BEGIN", "COMMIT", "ROLLBACK") },
      work
    );
  }

  /** A transaction through the base's attempt loop, as the dialects run theirs. */
  throughBase<T>(work: () => Promise<T>, options?: TransactionOptions) {
    return this.openOrJoin(work, options, {
      run: () =>
        this.settleOutermost(
          {
            ...this.steps("BEGIN", "COMMIT", "ROLLBACK"),
            join: { adapter: () => this.steps("", "", "") },
          },
          work,
          options
        ),
      retryable: () => false,
      describe: () => ({ label: "an error", detail: {} }),
      logger: undefined,
    });
  }

  /** The frame a call made here would join. */
  frame(): TransactionFrame | undefined {
    return this.joinableFrame();
  }

  /** Hold `effect` as a dialect's `afterCommit` does. */
  hold(effect: () => unknown): Promise<void> {
    return this.holdEffect(effect);
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "sqlite",
      supportsJsonb: false,
      supportsJson: true,
      supportsArrays: false,
      supportsGeneratedColumns: true,
      supportsFts: false,
      supportsIlike: false,
      supportsReturning: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      maxParamsPerQuery: 999,
      maxIdentifierLength: 64,
    };
  }

  getDrizzle<T = unknown>(): T {
    throw new Error("These tests run no Drizzle queries.");
  }

  /** Steps that record their statements; a flat join's send none. */
  private steps(begin: string, commit: string, rollback: string) {
    const record = (statement: string) => {
      if (statement !== "") this.statements.push(statement);
    };
    return {
      context: CONTEXT,
      begin: () => record(begin),
      commit: () => {
        if (commit === "COMMIT" && this.failCommit) {
          throw new Error("COMMIT failed, its outcome unknown");
        }
        record(commit);
      },
      rollback: () => {
        if (rollback === "ROLLBACK" && this.failRollback) {
          throw new Error("ROLLBACK failed");
        }
        record(rollback);
      },
    };
  }
}

describe("transaction frames", () => {
  it("opens a frame per transaction and per joined part, and closes each as it settles", async () => {
    const adapter = new FrameAdapter();
    expect(adapter.frame()).toBeUndefined();
    let outer: TransactionFrame | undefined;
    let inner: TransactionFrame | undefined;
    let openInPart: TransactionFrame[] = [];
    let openAfterPart: TransactionFrame[] = [];
    let openInFlow = false;

    await adapter.transaction(async () => {
      outer = adapter.frame();
      openInFlow = adapter.transactionOpenInFlow();
      await adapter.transaction(async () => {
        inner = adapter.frame();
        openInPart = [...(inner?.open ?? [])];
      });
      openAfterPart = [...(outer?.open ?? [])];
    });

    expect(openInFlow).toBe(true);
    expect(outer).toMatchObject({ depth: 0, finished: true, active: false });
    expect(outer?.parent).toBeUndefined();
    expect(inner).toMatchObject({ depth: 1, active: false, rolledBack: false });
    expect(inner?.parent).toBe(outer);
    expect(openInPart).toHaveLength(2);
    expect(openInPart[0]).toBe(outer);
    expect(openInPart[1]).toBe(inner);
    expect(openAfterPart).toHaveLength(1);
    expect(openAfterPart[0]).toBe(outer);
    expect(outer?.open).toHaveLength(0);
    expect(adapter.statements).toEqual([
      "BEGIN",
      "SAVEPOINT 1",
      "RELEASE 1",
      "COMMIT",
    ]);
    expect(adapter.transactionOpenInFlow()).toBe(false);
    expect(adapter.frame()).toBeUndefined();
  });

  it("drops the effects a rolled-back part held and keeps the others", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];

    await adapter.transaction(async () => {
      await adapter.hold(() => ran.push("before the part"));
      await adapter
        .transaction(async () => {
          await adapter.hold(() => ran.push("in the rolled-back part"));
          throw new Error("undo this part");
        })
        .catch(() => undefined);
      await adapter.hold(() => ran.push("after the part"));
    });

    expect(ran).toEqual(["before the part", "after the part"]);
    expect(adapter.statements).toEqual([
      "BEGIN",
      "SAVEPOINT 1",
      "ROLLBACK TO 1",
      "COMMIT",
    ]);
  });

  it("drops the effects of a part that released inside one that rolled back", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];

    await adapter.transaction(async () => {
      await adapter
        .transaction(async () => {
          await adapter.transaction(async () => {
            await adapter.hold(() => ran.push("in the released part"));
          });
          throw new Error("undo the part around it");
        })
        .catch(() => undefined);
    });

    expect(ran).toEqual([]);
    expect(adapter.statements).toEqual([
      "BEGIN",
      "SAVEPOINT 1",
      "SAVEPOINT 2",
      "RELEASE 2",
      "ROLLBACK TO 1",
      "COMMIT",
    ]);
  });

  it("hands a part's held effects back only once the outermost transaction commits", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];
    let ranBeforeCommit: string[] = [];
    let openWhenRun: boolean | undefined;

    await adapter.transaction(async () => {
      await adapter.transaction(async () => {
        await adapter.hold(() => {
          ran.push("from the part");
          openWhenRun = adapter.transactionOpenInFlow();
        });
      });
      ranBeforeCommit = [...ran];
    });

    expect(ranBeforeCommit).toEqual([]);
    expect(ran).toEqual(["from the part"]);
    expect(openWhenRun).toBe(false);
  });

  it("drops an effect announced from a rolled-back transaction's context until that context writes again", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];
    let announce: (label: string) => Promise<void> = async () => undefined;
    let write: () => Promise<void> = async () => undefined;

    await adapter
      .transaction(async () => {
        announce = AsyncResource.bind((label: string) =>
          adapter.hold(() => ran.push(label))
        );
        write = AsyncResource.bind(() => adapter.transaction(async () => {}));
        throw new Error("roll the transaction back");
      })
      .catch(() => undefined);

    await announce("describes the undone write");
    await write();
    await announce("describes the later write");

    expect(ran).toEqual(["describes the later write"]);
  });

  it("runs the parts joined to one frame one at a time, in call order", async () => {
    const adapter = new FrameAdapter();
    let releaseFirst: () => void = () => undefined;
    let beforeRelease: string[] = [];

    await adapter.transaction(async () => {
      const gate = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });
      const first = adapter.transaction(async () => {
        adapter.statements.push("first part works");
        await gate;
      });
      const second = adapter.transaction(async () => {
        adapter.statements.push("second part works");
      });
      await new Promise(resolve => setImmediate(resolve));
      beforeRelease = [...adapter.statements];
      releaseFirst();
      await Promise.all([first, second]);
    });

    expect(beforeRelease).toEqual(["BEGIN", "SAVEPOINT 1", "first part works"]);
    expect(adapter.statements).toEqual([
      "BEGIN",
      "SAVEPOINT 1",
      "first part works",
      "RELEASE 1",
      "SAVEPOINT 1",
      "second part works",
      "RELEASE 1",
      "COMMIT",
    ]);
  });

  it("fails the whole transaction when a flat part fails, though the outer caught it", async () => {
    const adapter = new FrameAdapter();
    adapter.flatJoin = true;
    const refusal = new Error("the part refuses");
    let later: unknown;

    const outcome = await adapter
      .transaction(async () => {
        await adapter
          .transaction(async () => {
            throw refusal;
          })
          .catch(() => undefined);
        later = await adapter
          .transaction(async () => "ran")
          .catch((error: unknown) => error);
      })
      .then(
        () => "committed",
        (error: unknown) => error
      );

    expect(outcome).toBe(refusal);
    expect(later).toBe(refusal);
    expect(adapter.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("runs rollback effects once the outermost transaction rolls back, and drops them when it commits", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];

    await adapter.transaction(async () => {
      await adapter.afterRollback(() =>
        ran.push("from a committed transaction")
      );
      await adapter
        .transaction(async () => {
          await adapter.afterRollback(() =>
            ran.push("from a rolled-back part")
          );
          throw new Error("undo the part");
        })
        .catch(() => undefined);
    });
    let ranBeforeRollback: string[] = [];
    await adapter
      .transaction(async () => {
        await adapter.transaction(async () => {
          await adapter.afterRollback(() => ran.push("from a part"));
        });
        await adapter.afterRollback(() => ran.push("from the outer"));
        ranBeforeRollback = [...ran];
        throw new Error("undo everything");
      })
      .catch(() => undefined);

    expect(ranBeforeRollback).toEqual([]);
    expect(ran).toEqual(["from a part", "from the outer"]);
  });

  it("keeps runOutermost's contract: resolves with the result and held effects, rejects with the work's error", async () => {
    const adapter = new FrameAdapter();
    const refusal = new Error("the work refuses");

    const committed = await adapter.outermost(async () => {
      await adapter.hold(() => undefined);
      return "done";
    });
    const rejected = await adapter
      .outermost(async () => {
        throw refusal;
      })
      .catch((error: unknown) => error);

    expect(committed.result).toBe("done");
    expect(committed.effects).toHaveLength(1);
    expect(rejected).toBe(refusal);
  });

  it("drops rollback effects, and says so, when the ROLLBACK cannot be confirmed", async () => {
    const adapter = new FrameAdapter();
    adapter.failCommit = true;
    adapter.failRollback = true;
    const ran: string[] = [];

    await adapter
      .transaction(async () => {
        await adapter.afterRollback(() => ran.push("compensation"));
      })
      .catch(() => undefined);

    expect(ran).toEqual([]);
    expect(adapter.logged.map(failure => failure.message)).toEqual([
      expect.stringContaining("outcome is unknown"),
    ]);
  });

  it("still runs an attempt's rollback effects when retryWhen throws, then rethrows", async () => {
    const adapter = new FrameAdapter();
    const ran: string[] = [];
    const question = new Error("retryWhen could not decide");

    const outcome = await adapter
      .throughBase(
        async () => {
          await adapter.afterRollback(() => ran.push("compensation"));
          throw new Error("the attempt fails");
        },
        {
          retryCount: 1,
          retryWhen: () => {
            throw question;
          },
        }
      )
      .catch((error: unknown) => error);

    expect(outcome).toBe(question);
    expect(ran).toEqual(["compensation"]);
  });
});
