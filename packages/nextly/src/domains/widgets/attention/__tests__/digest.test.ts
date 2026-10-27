/**
 * The attention digest's runner: every reader at once, each within its own
 * budget, failing alone; absent and zero alike leave nothing; floors and the
 * cap say "N+"; and the order is critical first, then most waiting, then label.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../../observability/logger", () => ({
  getNextlyLogger: () => ({ warn, error: vi.fn(), info: vi.fn() }),
}));

import {
  ATTENTION_ITEM_BUDGET_MS,
  type DigestReader,
  parseAttentionCount,
  runDigest,
} from "../digest";

function reader(
  id: string,
  read: DigestReader["read"],
  more: Partial<DigestReader> = {}
): DigestReader {
  return {
    id,
    kind: "plugin",
    label: id,
    severity: "warning",
    link: id,
    owner: 'plugin "test"',
    read,
    ...more,
  };
}

const answers = (value: unknown) => () => Promise.resolve(value);

afterEach(() => {
  vi.useRealTimers();
  warn.mockReset();
});

describe("the digest's order", () => {
  it("puts critical items first, then the most waiting, then by label", async () => {
    const items = await runDigest([
      reader("w/b", answers(5)),
      reader("w/a", answers(5)),
      reader("w/many", answers(40)),
      reader("core/overdue-releases", answers(1), {
        kind: "overdue",
        severity: "critical",
        label: "Overdue releases",
      }),
    ]);
    // 🔴 A plugin's larger count never ranks it above a critical item.
    expect(items.map(item => item.id)).toEqual([
      "core/overdue-releases",
      "w/many",
      "w/a",
      "w/b",
    ]);
  });
});

describe("what leaves an item", () => {
  it("leaves nothing for a reader that may not act on it, or that counts nothing", async () => {
    const items = await runDigest([
      reader("w/absent", answers(null)),
      reader("w/zero", answers(0)),
      reader("w/one", answers(1)),
    ]);
    expect(items.map(item => item.id)).toEqual(["w/one"]);
  });

  it("keeps a zero that is a floor, since lists went unread", async () => {
    const [item] = await runDigest([
      reader("w/floor", answers({ count: 0, atLeast: true })),
    ]);
    expect(item).toMatchObject({ count: 0, atLeast: true });
  });

  it("answers a count above 99 as 99 and a floor, and keeps a declared floor", async () => {
    const items = await runDigest([
      reader("w/huge", answers(1234)),
      reader("w/floor", answers({ count: 7, atLeast: true })),
      reader("w/whole", answers(99)),
    ]);
    expect(items).toEqual([
      expect.objectContaining({ id: "w/huge", count: 99, atLeast: true }),
      expect.objectContaining({ id: "w/whole", count: 99 }),
      expect.objectContaining({ id: "w/floor", count: 7, atLeast: true }),
    ]);
    expect(items[1]).not.toHaveProperty("atLeast");
  });
});

describe("an item that fails", () => {
  it("fails alone when its count throws, and is logged with its owner and id", async () => {
    const items = await runDigest([
      reader("w/broken", () => Promise.reject(new Error("boom"))),
      reader("w/fine", answers(2)),
    ]);
    expect(items).toEqual([
      expect.objectContaining({ id: "w/fine", count: 2 }),
      expect.objectContaining({ id: "w/broken", count: 0, failed: true }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "attention-item-failed",
        owner: 'plugin "test"',
        item: "w/broken",
        reason: "threw",
      })
    );
  });

  it.each([
    ["3"],
    [-1],
    [1.5],
    [{ count: 2 }],
    [{ count: 2, atLeast: false }],
    [undefined],
  ])(
    "fails an item whose count answers %j, which is not a count",
    async value => {
      const [item] = await runDigest([reader("w/odd", answers(value))]);
      expect(item).toMatchObject({ id: "w/odd", failed: true });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "not-a-count" })
      );
    }
  );

  it("fails an item past its own budget, aborting its signal, while the others answer", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const slow = reader("w/slow", signal => {
      seen = signal;
      return new Promise(() => {});
    });
    const done = runDigest([slow, reader("w/quick", answers(3))]);
    await vi.advanceTimersByTimeAsync(ATTENTION_ITEM_BUDGET_MS - 1);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const items = await done;
    expect(seen?.aborted).toBe(true);
    expect(items).toEqual([
      expect.objectContaining({ id: "w/quick", count: 3 }),
      expect.objectContaining({ id: "w/slow", failed: true }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ item: "w/slow", reason: "timed-out" })
    );
  });

  it("aborts every item's signal when the request is abandoned", async () => {
    const request = new AbortController();
    const signals: AbortSignal[] = [];
    const waiting = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      );
    };
    const done = runDigest(
      [reader("w/a", waiting), reader("w/b", waiting)],
      request.signal
    );
    request.abort();
    // At once, not when each item's own budget later runs out.
    expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
    await done;
  });
});

describe("a count read back", () => {
  it("is a whole number, or a floor marked atLeast", () => {
    expect(parseAttentionCount(4)).toEqual({ count: 4, atLeast: false });
    expect(parseAttentionCount({ count: 4, atLeast: true })).toEqual({
      count: 4,
      atLeast: true,
    });
    expect(parseAttentionCount(Number.NaN)).toBeUndefined();
    expect(parseAttentionCount(null)).toBeUndefined();
  });
});
