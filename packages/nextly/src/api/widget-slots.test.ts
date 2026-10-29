/**
 * A declared card's own data, answered by the batch's one runner: under its own budget, with
 * its owner's view of the scope, settled as its slot, and empty only when its test holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBatchScope } from "../domains/widgets/batch-scope";
import {
  resolveExecutableSource,
  type ExecutableSource,
} from "../domains/widgets/executable-source";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetQuery } from "../domains/widgets/query";
import type { ResolverOptions } from "../domains/widgets/resolved-sources";
import type { WidgetResult } from "../domains/widgets/result";
import type { WidgetSource } from "../domains/widgets/sources";
import * as loggerModule from "../observability/logger";

import {
  answerReadyQueries,
  SLOT_TIMEOUT_MS,
  type ReadyCardData,
  type ReadyQuery,
} from "./widget-slots";

const caller = { user: { id: "u1" } } as never;
const count = (total: number): WidgetResult => ({ op: "count", total });

function card(
  index: number,
  answer: ReadyCardData["answer"],
  owner = "plugin @acme/shop"
): ReadyCardData {
  return { kind: "data", index, widgetId: `acme/card-${index}`, owner, answer };
}

// The runner's own behaviour, apart from what answers a query: a declared card's data never
// reaches the query executor, so it is stood in for, and the database stays out of these tests.
vi.mock("../domains/widgets/execute", () => ({
  executeWidgetQuery: vi.fn(),
}));
// What answers a source when the batch runs, stood in for the same way: the
// runner looks it up live, and these tests say what it finds.
vi.mock("../domains/widgets/executable-source", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../domains/widgets/executable-source")
  >()),
  resolveExecutableSource: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("a declared card's own data in the batch", () => {
  it("is answered at its place, and marked empty only when its test holds", async () => {
    const slots = await answerReadyQueries(
      [
        card(0, async () => ({ result: count(3), empty: false })),
        card(1, async () => ({ result: count(0), empty: true })),
      ],
      caller,
      createBatchScope()
    );
    expect(slots.get(0)).toEqual({ ok: true, result: count(3) });
    expect(slots.get(1)).toEqual({ ok: true, result: count(0), empty: true });
  });

  it("shares work with the other cards of its owner, through its owner's view only", async () => {
    const scan = vi.fn(async () => 5);
    const viaScope: ReadyCardData["answer"] = async ({ scope }) => ({
      result: count(await scope.getOrCompute("orders", scan)),
      empty: false,
    });
    const batch = createBatchScope();
    const slots = await answerReadyQueries(
      [
        card(0, viaScope),
        card(1, viaScope),
        card(2, viaScope, "plugin @acme/blog"),
      ],
      caller,
      batch
    );
    // One scan for the two cards of one owner, one more for the other owner.
    expect(scan).toHaveBeenCalledTimes(2);
    expect([...slots.values()].every(slot => slot.ok)).toBe(true);
    // And none of it reached a source's view under the same key.
    const sourceSide = vi.fn(async () => "a source's own");
    await batch
      .forSource("plugin @acme/shop")
      .getOrCompute("orders", sourceSide);
    expect(sourceSide).toHaveBeenCalledTimes(1);
  });

  it("hands every card the batch's one instant, each its own copy", async () => {
    // Only the clock is faked: the budget's own timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.UTC(2026, 9, 22, 23, 59, 59);
    vi.setSystemTime(start);
    const seen: number[] = [];
    const clock: ReadyCardData["answer"] = async ({ now }) => {
      seen.push(now.getTime());
      // The batch running past midnight before the next card is asked, and a
      // function moving its own copy: neither reaches another card.
      vi.setSystemTime(start + 60_000);
      now.setUTCFullYear(1999);
      return { result: count(1), empty: false };
    };
    await answerReadyQueries(
      [card(0, clock), card(1, clock)],
      caller,
      createBatchScope()
    );
    expect(seen).toEqual([start, start]);
  });

  it("fails its own slot alone when it throws, naming nothing internal to the reader", async () => {
    const slots = await answerReadyQueries(
      [
        card(0, async () => {
          throw new Error("the database said no");
        }),
        card(1, async () => ({ result: count(1), empty: false })),
      ],
      caller,
      createBatchScope()
    );
    const failed = slots.get(0);
    expect(failed?.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("the database said no");
    expect(slots.get(1)).toEqual({ ok: true, result: count(1) });
  });

  it("shows its card's error at the deadline, though its function never settles, and stops it", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const never: ReadyCardData["answer"] = ({ signal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => {});
    };
    const answering = answerReadyQueries(
      [
        card(0, never),
        card(1, async () => ({ result: count(2), empty: false })),
      ],
      caller,
      createBatchScope()
    );
    await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);
    const slots = await answering;
    expect(slots.get(0)).toMatchObject({
      ok: false,
      error: "This widget took too long to answer",
    });
    expect(aborted).toBe(true);
    expect(slots.get(1)).toEqual({ ok: true, result: count(2) });
  });

  it("names the widget and its owner in the log of a card that ran out of time", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const logger = vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
      error,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
    try {
      const answering = answerReadyQueries(
        [card(0, () => new Promise(() => {}), "plugin @acme/blog")],
        caller,
        createBatchScope()
      );
      await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);
      await answering;
      // The operator is told which plugin's widget is hanging, not only which widget.
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toMatchObject({
        logContext: {
          reason: "widget-slot-timeout",
          widget: "acme/card-0",
          owner: "plugin @acme/blog",
        },
      });
    } finally {
      logger.mockRestore();
    }
  });

  it("settles a card its answer decided before any data was read, beside one that was", async () => {
    // A card whose widget needs a setting is answered without running its data function; the
    // runner settles it exactly as answered, and its neighbour is drawn.
    const needs = {
      ok: false,
      error: "No Collection chosen yet",
      code: "needs-setting",
      setting: "Collection",
    } as const;
    const slots = await answerReadyQueries(
      [
        card(0, async () => ({ settled: needs })),
        card(1, async () => ({ result: count(4), empty: false })),
      ],
      caller,
      createBatchScope()
    );
    expect(slots.get(0)).toEqual(needs);
    expect(slots.get(1)).toEqual({ ok: true, result: count(4) });
  });

  it("never delivers an answer that arrives after its deadline, anywhere", async () => {
    vi.useFakeTimers();
    let late: (value: {
      result: WidgetResult;
      empty: boolean;
    }) => void = () => {};
    const settled = vi.fn();
    const answering = answerReadyQueries(
      [card(0, () => new Promise(resolve => (late = resolve)))],
      caller,
      createBatchScope(),
      { onSettled: settled }
    );
    await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);
    const slots = await answering;
    // The card has its error; then its abandoned read answers after all.
    late({ result: count(9), empty: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(slots.get(0)).toMatchObject({ ok: false });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(settled.mock.calls)).not.toContain('"total":9');
  });

  it("settles nothing once the batch is given up, since nobody is waiting for it", async () => {
    const giveUp = new AbortController();
    const settled = vi.fn();
    const answering = answerReadyQueries(
      [
        card(
          0,
          ({ signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () =>
                reject(new Error("given up"))
              );
            })
        ),
      ],
      caller,
      createBatchScope(),
      { signal: giveUp.signal, onSettled: settled }
    );
    giveUp.abort();
    const slots = await answering;
    expect(slots.size).toBe(0);
    expect(settled).not.toHaveBeenCalled();
  });
});

describe("a source's queries in the batch", () => {
  const source = { id: "plugin:acme/orders" } as WidgetSource;
  const query = { source: source.id, op: "count" } as WidgetQuery;
  const ready = (index: number, executable: ExecutableSource): ReadyQuery => ({
    index,
    query,
    executable,
  });

  /** Fakes only the clock, starting the batch at a minute to midnight. */
  function batchStartingAtMidnight(): number {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.UTC(2026, 9, 22, 23, 59, 59);
    vi.setSystemTime(start);
    return start;
  }

  it("hands a query answered on its own the batch's one instant, its own copy", async () => {
    const start = batchStartingAtMidnight();
    const seen: Date[] = [];
    vi.mocked(executeWidgetQuery).mockImplementation(
      async (_query, _caller, opts?: ResolverOptions) => {
        seen.push(opts?.now as Date);
        vi.setSystemTime(start + 60_000);
        return count(1);
      }
    );
    const collection: ExecutableSource = { kind: "collection", source };
    await answerReadyQueries(
      [ready(0, collection), ready(1, collection)],
      caller,
      createBatchScope()
    );
    // 🔴 Each query measures its window from the batch's instant, not from
    // whenever it happened to run, and from a Date no other query shares.
    expect(seen.map(now => now?.getTime())).toEqual([start, start]);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("hands a many-query resolver the batch's one instant", async () => {
    const start = batchStartingAtMidnight();
    let seen: Date | undefined;
    const resolveMany = vi.fn(
      async (
        queries: readonly WidgetQuery[],
        _caller: unknown,
        opts?: ResolverOptions
      ) => {
        seen = opts?.now;
        return queries.map(() => count(1));
      }
    );
    const plugin: ExecutableSource = {
      kind: "plugin",
      source,
      resolve: vi.fn(),
      resolveMany,
    };
    vi.mocked(resolveExecutableSource).mockReturnValue(plugin);
    await answerReadyQueries(
      [ready(0, plugin), ready(1, plugin)],
      caller,
      createBatchScope()
    );
    expect(resolveMany).toHaveBeenCalledTimes(1);
    expect(seen?.getTime()).toBe(start);
  });
});
