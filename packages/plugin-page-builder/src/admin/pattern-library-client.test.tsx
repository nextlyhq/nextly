// @vitest-environment jsdom

/**
 * What the insert panel is actually handed, as opposed to what the rule says.
 *
 * The rule itself is covered beside the contract it lives in. This asks the
 * question a rule cannot answer about itself: whether the surface applies it.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
}));

import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type { LibraryResponse } from "../library-contract";

import { usePatternLibrary } from "./pattern-library-client";

const read = vi.mocked(usePluginRoute);

function answering(items: unknown[]): void {
  read.mockReturnValue({
    data: { items, meta: { count: items.length, truncated: false } },
    error: null,
    pending: false,
  } as unknown as ReturnType<typeof usePluginRoute<LibraryResponse>>);
}

const document = {
  formatVersion: 1,
  kind: "pattern",
  nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
};

describe("what reaches the insert panel", () => {
  it("offers the patterns that are part of a page", () => {
    // The positive control: without it, every assertion below is satisfied by a
    // hook that offers nothing at all.
    answering([
      { id: "a", title: "A", granularity: "section", document },
      { id: "b", title: "B", granularity: "element", document },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.patterns.map(p => p.id)).toEqual(["a", "b"]);
  });

  it("keeps a whole-page pattern out of the list", () => {
    answering([
      { id: "page", title: "Landing", granularity: "page", document },
      { id: "sec", title: "Hero", granularity: "section", document },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.patterns.map(p => p.id)).toEqual(["sec"]);
  });

  it("keeps out a row whose granularity was STRIPPED on the way here", () => {
    // The reachable failure. `granularity` is required on the collection, so a
    // row arriving without one had it removed by an `afterRead` hook or a
    // field-level read rule — and the document is still a whole page. A rule
    // phrased as "not page" offers it, and the author places a page inside the
    // page they are editing.
    answering([
      { id: "stripped", title: "Landing", document },
      { id: "sec", title: "Hero", granularity: "section", document },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.patterns.map(p => p.id)).toEqual(["sec"]);
  });

  it("returns ONE empty list while the read is in flight", () => {
    // Identity, not emptiness: the panel builds its catalogue in a memo keyed
    // on this array, running the planner's preflight over every pattern, so a
    // fresh `[]` each render rebuilds all of it on every keystroke.
    read.mockReturnValue({
      data: undefined,
      error: null,
      pending: true,
    } as unknown as ReturnType<typeof usePluginRoute<LibraryResponse>>);

    const first = renderHook(() => usePatternLibrary());
    const second = renderHook(() => usePatternLibrary());

    expect(first.result.current.patterns).toHaveLength(0);
    expect(first.result.current.patterns).toBe(second.result.current.patterns);
  });
});
