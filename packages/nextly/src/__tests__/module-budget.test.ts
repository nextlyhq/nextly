/**
 * The module budget's arithmetic: what counts as heavy, which file is the 90th
 * percentile, when a pin is exceeded or should come down, and the import chain
 * a failure names. The reporter applies these to the run's records; that it
 * reads the right records is shown by the suite itself, which prints the
 * measurement on every whole run.
 */

import { describe, expect, it } from "vitest";

import {
  BUDGET,
  type GraphModule,
  HEAVY_MODULES,
  judge,
  measure,
  shortestPath,
} from "./module-budget-reporter";

describe("measure", () => {
  it("counts a file as heavy only past the line, not at it", () => {
    const m = measure([HEAVY_MODULES, HEAVY_MODULES + 1, 10]);
    expect(m.heavyFiles).toBe(1);
  });

  it("takes the 90th percentile as the file a tenth from the top", () => {
    // Ten files of 1..10 modules: index 9 of the sorted ten, the file with 10,
    // whatever order the files ran in.
    expect(measure([3, 10, 1, 7, 2, 9, 4, 8, 6, 5]).p90Modules).toBe(10);
    // Twenty files: index 18 of the sorted twenty.
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(measure(twenty.reverse()).p90Modules).toBe(19);
  });
});

describe("judge", () => {
  const at = (heavyFiles: number, p90Modules: number) =>
    judge({ files: 1_000, heavyFiles, p90Modules });

  it("fails a suite one file past the heavy pin", () => {
    expect(at(BUDGET.heavyFiles + 1, BUDGET.p90Modules).over).toEqual([
      "heavyFiles",
    ]);
  });

  it("fails a suite one module past the percentile pin", () => {
    expect(at(BUDGET.heavyFiles, BUDGET.p90Modules + 1).over).toEqual([
      "p90Modules",
    ]);
  });

  it("passes a suite exactly at its pins, and asks for nothing", () => {
    expect(at(BUDGET.heavyFiles, BUDGET.p90Modules)).toEqual({
      over: [],
      lower: [],
    });
  });

  it("asks for a lower pin once a suite is lighter by more than the margin", () => {
    const light = at(50, 500);
    expect(light.over).toEqual([]);
    expect(light.lower).toEqual(["heavyFiles to 53", "p90Modules to 535"]);
  });
});

describe("shortestPath", () => {
  /** A graph from `from: [to, ...]` lines, keyed by module id. */
  function graph(edges: Record<string, string[]>): Map<string, GraphModule> {
    const nodes = new Map<string, GraphModule>();
    const node = (id: string) => {
      if (!nodes.has(id)) nodes.set(id, { id, importedModules: new Set() });
      return nodes.get(id)!;
    };
    for (const [from, to] of Object.entries(edges)) {
      for (const id of to) node(from).importedModules.add(node(id));
    }
    return nodes;
  }
  const ids = (path: GraphModule[]) => path.map(m => m.id);

  it("names the shorter of two routes to the target, in either import order", () => {
    // Both orders, since a depth-first walk takes the longer route in one of
    // them whichever end of its list it explores first.
    for (const first of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      const g = graph({
        test: first,
        a: ["c"],
        c: ["register"],
        b: ["register"],
      });
      expect(
        ids(shortestPath(g.get("test")!, m => m.id === "register"))
      ).toEqual(["test", "b", "register"]);
    }
  });

  it("follows a cycle without looping, and finds nothing when nothing is reached", () => {
    const g = graph({ test: ["a"], a: ["b"], b: ["a"] });
    expect(shortestPath(g.get("test")!, m => m.id === "register")).toEqual([]);
  });

  it("answers the start itself when it is the target", () => {
    const start: GraphModule = { id: "register", importedModules: new Set() };
    expect(ids(shortestPath(start, m => m.id === "register"))).toEqual([
      "register",
    ]);
  });
});
