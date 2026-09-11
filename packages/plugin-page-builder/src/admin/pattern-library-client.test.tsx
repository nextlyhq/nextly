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

  it("tells a read that failed with an earlier answer cached (stale) apart from one that never answered (unavailable)", () => {
    // The same three-way split the component read makes, for the same
    // reason: the panel says "none are offered" beside an unavailable tier,
    // and beside the cached tiles a failed refresh leaves standing, that
    // sentence would be false.
    const item = {
      id: "hero",
      title: "Hero",
      granularity: "section",
      document,
    };
    read.mockReturnValue({
      data: { items: [item], meta: { count: 1, truncated: false } },
      error: new Error("Forbidden"),
      pending: false,
      refetch: () => {},
    } as unknown as ReturnType<typeof usePluginRoute<LibraryResponse>>);
    const stale = renderHook(() => usePatternLibrary());
    read.mockReturnValue({
      data: undefined,
      error: new Error("Forbidden"),
      pending: false,
      refetch: () => {},
    } as unknown as ReturnType<typeof usePluginRoute<LibraryResponse>>);
    const unavailable = renderHook(() => usePatternLibrary());

    expect(stale.result.current.state).toBe("stale");
    expect(stale.result.current.patterns).toHaveLength(1);
    expect(unavailable.result.current.state).toBe("unavailable");
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

describe("the categories the save form suggests", () => {
  it("offers every category the library uses, in a predictable order", () => {
    // Sorted by name rather than by how often each is used: a suggestion list
    // an author scans has to stay where they last saw it, and frequency moves
    // the entries around as the library grows.
    answering([
      {
        id: "a",
        title: "A",
        granularity: "section",
        category: "Heroes",
        document,
      },
      {
        id: "b",
        title: "B",
        granularity: "element",
        category: "Buttons",
        document,
      },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.categories).toEqual(["Buttons", "Heroes"]);
  });

  it("does not offer one spelling of a category twice", () => {
    // A library holding both already has the problem the suggestions exist to
    // prevent; offering both invites a third.
    // The FIRST spelling is the one kept, and the fixtures have to be able to
    // tell: written with a last row that trims back to the first, this passed
    // with the de-duplication removed entirely, because a map keyed on the
    // lower-cased name overwrites to the same value either way.
    answering([
      {
        id: "a",
        title: "A",
        granularity: "section",
        category: "Heroes",
        document,
      },
      {
        id: "b",
        title: "B",
        granularity: "section",
        category: "heroes",
        document,
      },
      {
        id: "c",
        title: "C",
        granularity: "section",
        category: "  HEROES  ",
        document,
      },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.categories).toEqual(["Heroes"]);
  });

  it("includes a page pattern's category, which the insert list leaves out", () => {
    // The two lists answer different questions. A page pattern is not offered
    // for insertion; the category it uses is still one this library uses, and
    // an author filing a second page pattern should be offered it.
    answering([
      {
        id: "page",
        title: "Landing",
        granularity: "page",
        category: "Layouts",
        document,
      },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.patterns).toEqual([]);
    expect(result.current.categories).toEqual(["Layouts"]);
  });

  it("offers nothing rather than a blank suggestion", () => {
    // A category the collection stored as SQL NULL reads back with the key
    // present, and an empty string in a suggestion list is a row an author can
    // select that puts nothing in the field.
    answering([
      { id: "a", title: "A", granularity: "section", category: null, document },
      {
        id: "b",
        title: "B",
        granularity: "section",
        category: "   ",
        document,
      },
      { id: "c", title: "C", granularity: "section", document },
    ]);

    const { result } = renderHook(() => usePatternLibrary());

    expect(result.current.categories).toEqual([]);
  });

  it("keeps ONE empty list while the read is in flight", () => {
    // A fresh `[]` per render is a new prop identity, and the form memoises on
    // it. The same reason the patterns list is stabilised.
    read.mockReturnValue({
      data: undefined,
      error: null,
      pending: true,
    } as unknown as ReturnType<typeof usePluginRoute<LibraryResponse>>);

    const { result, rerender } = renderHook(() => usePatternLibrary());
    const first = result.current.categories;
    rerender();

    expect(result.current.categories).toBe(first);
  });
});
