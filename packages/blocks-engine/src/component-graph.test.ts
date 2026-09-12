/**
 * The reachability question both the insert panel and the write ask.
 *
 * The resolver is the oracle for what a cycle DOES — it draws what it reached
 * and leaves one unresolved node where the loop closes — so the cases here
 * assert that this answers `cycle` for exactly the graphs the resolver reports
 * as cyclic, and `none` for the ones it composes whole.
 *
 * @module component-graph.test
 */
import { describe, expect, it } from "vitest";

import { componentReach, type ComponentPlacements } from "./component-graph";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, ComponentDocument } from "./document";
import { resolveComponentInstances } from "./resolve-instances";

/** What each component places, as a fixture writes it. */
const graph = (places: Record<string, readonly string[]>) => {
  const reader: ComponentPlacements = id => places[id];
  return reader;
};

describe("componentReach", () => {
  it("answers none when nothing leads back", () => {
    expect(
      componentReach({
        places: ["b"],
        self: "a",
        placedBy: graph({ b: ["c"], c: [] }),
      })
    ).toEqual({ kind: "none" });
  });

  it("names the loop a placement closes directly", () => {
    expect(
      componentReach({
        places: ["a"],
        self: "a",
        placedBy: graph({}),
      })
    ).toEqual({ kind: "cycle", path: ["a", "a"] });
  });

  it("names the whole chain, so an author knows which placement to remove", () => {
    // The point of carrying a path: "this would reference itself" leaves an
    // author looking through every placement, and naming the chain does not.
    expect(
      componentReach({
        places: ["b"],
        self: "a",
        placedBy: graph({ b: ["c"], c: ["a"] }),
      })
    ).toEqual({ kind: "cycle", path: ["a", "b", "c", "a"] });
  });

  it("ends a loop among OTHER components where it began, reading each once", () => {
    /*
     * A library that already contains a loop between two other components must
     * not make this walk run while a write waits on it.
     *
     * The reader REFUSES past a bound rather than the test asserting a count
     * afterwards. An unbounded walk never returns, so an assertion placed after
     * the call is never reached and the failure is a hung runner rather than a
     * red test — which is no signal at all. Refusing inside the reader turns
     * non-termination into a thrown error the assertion can name.
     */
    const places: Record<string, readonly string[]> = {
      b: ["c"],
      c: ["b"],
    };
    const reads: string[] = [];
    const bounded: ComponentPlacements = id => {
      reads.push(id);
      if (reads.length > 8)
        throw new Error(`unbounded walk: ${reads.join(">")}`);
      return places[id];
    };

    expect(
      componentReach({ places: ["b"], self: "a", placedBy: bounded })
    ).toEqual({ kind: "none" });
    // Each component once, which is what makes the walk finite.
    expect(reads).toEqual(["b", "c"]);
  });

  it("answers unknown, naming where, for a definition it could not read", () => {
    // Not `none`: a definition nobody could read names no component as far as
    // the reader can see, and reporting that as "does not reach" answers the
    // question with a fact nobody has.
    expect(
      componentReach({
        places: ["b"],
        self: "a",
        placedBy: graph({}),
      })
    ).toEqual({ kind: "unknown", at: "b" });
  });

  it("answers unknown for a document whose own placements are unread", () => {
    expect(
      componentReach({ places: undefined, self: "a", placedBy: graph({}) })
    ).toEqual({ kind: "unknown", at: "a" });
  });

  it("prefers the loop it can prove over an unknown further out", () => {
    // Breadth-first, so a chain that closes is found before a longer branch
    // runs into something unreadable. An author with a real loop is told about
    // the loop rather than about a definition they cannot see.
    expect(
      componentReach({
        places: ["a", "unreadable"],
        self: "a",
        placedBy: graph({}),
      })
    ).toEqual({ kind: "cycle", path: ["a", "a"] });
  });

  it("agrees with the resolver about which graphs are cyclic", () => {
    // The oracle. What this answers `cycle` for is what the resolver reports
    // as `reason: "cycle"`, and what it answers `none` for is what the
    // resolver composes leaving nothing unresolved.
    const instance = (id: string, componentId: string): BlockNode => ({
      id,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId },
    });
    const component = (nodes: BlockNode[]): ComponentDocument => ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes,
    });
    const page = (nodes: BlockNode[]): BlockDocument => ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    });

    const looped = new Map<string, BlockDocument>([
      ["a", component([instance("a1", "b")])],
      ["b", component([instance("b1", "a")])],
    ]);
    const clean = new Map<string, BlockDocument>([
      ["a", component([instance("a1", "b")])],
      ["b", component([])],
    ]);

    expect(
      resolveComponentInstances(page([instance("p", "a")]), looped).unresolved
    ).toEqual([expect.objectContaining({ componentId: "a", reason: "cycle" })]);
    expect(
      componentReach({
        places: ["b"],
        self: "a",
        placedBy: graph({ b: ["a"] }),
      }).kind
    ).toBe("cycle");

    expect(
      resolveComponentInstances(page([instance("p", "a")]), clean).unresolved
    ).toEqual([]);
    expect(
      componentReach({ places: ["b"], self: "a", placedBy: graph({ b: [] }) })
        .kind
    ).toBe("none");
  });
});
