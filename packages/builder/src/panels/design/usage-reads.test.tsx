// @vitest-environment jsdom

/**
 * The usage reads every Design tab with counts shares, driven through the
 * hook alone with a value type of its own: reads a read's size at a time,
 * each id once, the latest read kept for what a tab reads beside the counts,
 * a failure marked, and Count now offered only where the host can and the
 * author may.
 *
 * The recount timer and Count now's words are driven through the Shared
 * styles tab in `shared-styles-panel.test`, and through the Variables tab in
 * `tokens-panel.usage.test`.
 *
 * @module usage-reads.test
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useUsageReads, type UsageRead, type UsageSource } from "./usage-reads";

afterEach(cleanup);

/** A value type of the test's own: the hook knows nothing of what it holds. */
interface Uses {
  readonly n: number;
}

type Read = UsageRead<Uses> & { readonly stamp: number };

function source(
  answer: (ids: readonly string[]) => Read | Error,
  count?: UsageSource<Uses, Read>["count"]
): UsageSource<Uses, Read> & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    usage: async ids => {
      asked.push([...ids]);
      const read = answer(ids);
      if (read instanceof Error) throw read;
      return read;
    },
    ...(count === undefined ? {} : { count }),
  };
}

function readOf(ids: readonly string[], stamp: number, mayCount = false): Read {
  return {
    whole: true,
    mayCount,
    stamp,
    values: new Map(ids.map(id => [id, { n: id.length }])),
  };
}

const ids = (count: number): string[] =>
  Array.from({ length: count }, (_, at) => `id-${String(at)}`);

describe("the usage reads", () => {
  it("asks fifty ids to a read, each once, and keeps every answer", async () => {
    let stamp = 0;
    const host = source(asked => readOf(asked, (stamp += 1)));
    const listed = ids(120);
    const { result } = renderHook(() => useUsageReads(host, listed));
    await waitFor(() => expect(result.current.values.size).toBe(120));
    expect(host.asked.map(read => read.length)).toEqual([50, 50, 20]);
    expect(new Set(host.asked.flat()).size).toBe(120);
    expect(result.current.whole).toBe(true);
    // The latest read, for what a tab reads beside the counts.
    expect(result.current.latest?.stamp).toBe(3);
  });

  it("asks only for ids not read before as more come on screen", async () => {
    const host = source(asked => readOf(asked, 1));
    const { result, rerender } = renderHook(
      ({ listed }: { listed: string[] }) => useUsageReads(host, listed),
      { initialProps: { listed: ["a", "b"] } }
    );
    await waitFor(() => expect(result.current.values.size).toBe(2));
    rerender({ listed: ["a", "b", "c"] });
    await waitFor(() => expect(result.current.values.size).toBe(3));
    expect(host.asked).toEqual([["a", "b"], ["c"]]);
  });

  it("reads nothing without a source, and marks a read that failed", async () => {
    const none = renderHook(() => useUsageReads(undefined, ["a"]));
    expect(none.result.current.values.size).toBe(0);
    expect(none.result.current.whole).toBeUndefined();

    const host = source(() => new Error("down"));
    const { result } = renderHook(() => useUsageReads(host, ["a"]));
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("offers Count now only where the host can count and the read says the author may", async () => {
    const counting = source(
      asked => readOf(asked, 1, true),
      async () => ({ kind: "counted", whole: true, counting: false })
    );
    const may = renderHook(() => useUsageReads(counting, ["a"]));
    await waitFor(() => expect(may.result.current.counter).toBeDefined());

    const refused = source(
      asked => readOf(asked, 1, false),
      async () => ({ kind: "counted", whole: true, counting: false })
    );
    const mayNot = renderHook(() => useUsageReads(refused, ["a"]));
    await waitFor(() => expect(mayNot.result.current.values.size).toBe(1));
    expect(mayNot.result.current.counter).toBeUndefined();

    const cannot = source(asked => readOf(asked, 1, true));
    const noCount = renderHook(() => useUsageReads(cannot, ["a"]));
    await waitFor(() => expect(noCount.result.current.values.size).toBe(1));
    expect(noCount.result.current.counter).toBeUndefined();
  });

  it("reads every listed id again once a count answers", async () => {
    const host = source(
      asked => readOf(asked, 1, true),
      async () => ({ kind: "counted", whole: true, counting: false })
    );
    const { result } = renderHook(() => useUsageReads(host, ["a", "b"]));
    await waitFor(() => expect(result.current.counter).toBeDefined());
    await act(async () => {
      result.current.counter?.run();
    });
    await waitFor(() =>
      expect(host.asked).toEqual([
        ["a", "b"],
        ["a", "b"],
      ])
    );
  });
});
