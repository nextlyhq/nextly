// @vitest-environment jsdom

/**
 * How a screen's groups of variables are asked about together: in reads no
 * larger than the host answers, a group too large for one left added up,
 * and the host's count used only for the reads it was made from.
 *
 * @module variable-together-reads.test
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { togetherBatches, useReachTogether } from "./variable-together-reads";
import type {
  VariableReach,
  VariablesAccess,
  VariablesTogether,
} from "./variable-usage";

/** A group of `size` variables, named from `from`. */
const group = (from: number, size: number): string[] =>
  Array.from({ length: size }, (_, at) => `v-${String(from + at)}`);

describe("reading groups together", () => {
  it("asks at most fifty groups to a read", () => {
    const groups = Array.from({ length: 51 }, (_, at) => group(at * 0, 2));
    expect(togetherBatches(groups).map(batch => batch.length)).toEqual([50, 1]);
  });

  it("asks about at most fifty variables in all to a read", () => {
    // 30 and 30 are 60 variables: two reads. Shared ones count once.
    expect(
      togetherBatches([group(0, 30), group(30, 30)]).map(batch => batch.length)
    ).toEqual([1, 1]);
    expect(togetherBatches([group(0, 30), group(10, 30)])).toHaveLength(1);
  });

  it("leaves out a group larger than one read", () => {
    expect(togetherBatches([group(0, 51), group(0, 2)])).toEqual([
      [group(0, 2)],
    ]);
  });
});

/** A variable's usage as one read answers it: a new answer each read. */
function reach(documents: number): VariableReach {
  return {
    documents,
    byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
    sharedStyles: [],
    blockDefaults: [],
    complete: true,
  };
}

/** A host counting every group as `documents` together, or never answering. */
function host(
  answer: () => Promise<readonly VariablesTogether[]> | undefined
): VariablesAccess & { usageTogether: ReturnType<typeof vi.fn> } {
  const usageTogether = vi.fn(
    () => answer() ?? new Promise<readonly VariablesTogether[]>(() => undefined)
  );
  return {
    usage: async () => ({ whole: true, variables: new Map() }),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
    usageTogether,
  };
}

const counted = (documents: number): VariablesTogether => ({
  documents,
  byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
  complete: true,
});

describe("a group's usage as one count", () => {
  it("adds up a group larger than one read, which is never asked", () => {
    const access = host(async () => [counted(1)]);
    const big = group(0, 51);
    const values = new Map(big.map(id => [id, reach(1)] as const));
    const { result } = renderHook(() =>
      useReachTogether(access, [big], values)
    );
    expect(result.current(big)?.documents).toBe(51);
    expect(access.usageTogether).not.toHaveBeenCalled();
  });

  it("adds up while the host's count is being read, so a use is never unread", async () => {
    const access = host(() => undefined);
    const pair = ["font-size.body", "line-height.body"];
    const values = new Map([
      ["font-size.body", reach(1)],
      ["line-height.body", reach(2)],
    ]);
    const { result } = renderHook(() =>
      useReachTogether(access, [pair], values)
    );
    await waitFor(() => expect(access.usageTogether).toHaveBeenCalled());
    expect(result.current(pair)?.documents).toBe(3);
  });

  it("asks again once its variables are read again, though their numbers are the same", async () => {
    // Both on one page, then the line height moved to another: each still
    // counts one page, and only the host can tell the pair now counts two.
    let together = 1;
    const access = host(async () => [counted(together)]);
    const pair = ["font-size.body", "line-height.body"];
    const read = () =>
      new Map([
        ["font-size.body", reach(1)],
        ["line-height.body", reach(1)],
      ]);
    const { result, rerender } = renderHook(
      ({ values }) => useReachTogether(access, [pair], values),
      { initialProps: { values: read() } }
    );
    await waitFor(() => expect(result.current(pair)?.documents).toBe(1));
    together = 2;
    act(() => rerender({ values: read() }));
    await waitFor(() => expect(result.current(pair)?.documents).toBe(2));
    expect(access.usageTogether).toHaveBeenCalledTimes(2);
  });
});
