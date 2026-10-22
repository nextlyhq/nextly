/**
 * A declared card's own data, answered by the batch's one runner: under its own budget, with
 * its owner's view of the scope, settled as its slot, and empty only when its test holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBatchScope } from "../domains/widgets/batch-scope";
import type { WidgetResult } from "../domains/widgets/result";

import {
  answerReadyQueries,
  SLOT_TIMEOUT_MS,
  type ReadyCardData,
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
