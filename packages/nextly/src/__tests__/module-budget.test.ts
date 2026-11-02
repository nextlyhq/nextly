/**
 * The module budget's arithmetic: what counts as heavy, how the heaviest tenth
 * is averaged, when a pin is exceeded or should come down, the import chain a
 * failure names, and which imports cross the dialect boundary. The reporter
 * applies these to the run's records; that it
 * reads the right records is shown by the suite itself, which prints the
 * measurement on every whole run.
 */

import { describe, expect, it } from "vitest";

import {
  BUDGET,
  boundByDialectBoundary,
  compareHeavy,
  dialectBoundaryCrossings,
  type GraphModule,
  HEAVY_MODULES,
  judge,
  measure,
  moduleWithKey,
  shortestPath,
  tableFileDialect,
} from "./module-budget-reporter";

describe("measure", () => {
  it("counts a file as heavy only past the line, not at it", () => {
    const m = measure([HEAVY_MODULES, HEAVY_MODULES + 1, 10]);
    expect(m.heavyFiles).toBe(1);
  });

  it("averages the heaviest tenth of the files, whatever order they ran in", () => {
    // Ten files of 1..10 modules: the tenth is the one file with 10.
    expect(measure([3, 10, 1, 7, 2, 9, 4, 8, 6, 5]).tailMeanModules).toBe(10);
    // Twenty-five: the heaviest three (a tenth, rounded up), 23 to 25.
    const many = Array.from({ length: 25 }, (_, i) => i + 1);
    expect(measure(many.reverse()).tailMeanModules).toBe(24);
    // One file is its own tenth; none averages to 0.
    expect(measure([7]).tailMeanModules).toBe(7);
    expect(measure([]).tailMeanModules).toBe(0);
  });

  it("moves by a few modules when one file is added below a gap in the counts", () => {
    // The suite's shape: most files well below the heavy line, a group of
    // files that reach the registry above it, and nothing in between. A
    // percentile here reads whichever side of the gap its position lands on,
    // so one file added anywhere can move it by the whole gap.
    const suite = [...Array(531).fill(986), ...Array(59).fill(1_124)];
    const before = measure(suite).tailMeanModules;
    const after = measure([...suite, 986]).tailMeanModules;
    expect(before).toBe(1_124);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3);
  });
});

describe("judge", () => {
  const at = (heavyFiles: number, tailMeanModules: number) =>
    judge({ files: 1_000, heavyFiles, tailMeanModules });

  it("fails a suite one file past the heavy pin", () => {
    expect(at(BUDGET.heavyFiles + 1, BUDGET.tailMeanModules).over).toEqual([
      "heavyFiles",
    ]);
  });

  it("fails a suite one module past the percentile pin", () => {
    expect(at(BUDGET.heavyFiles, BUDGET.tailMeanModules + 1).over).toEqual([
      "tailMeanModules",
    ]);
  });

  it("passes a suite exactly at its pins, and asks for nothing", () => {
    expect(at(BUDGET.heavyFiles, BUDGET.tailMeanModules)).toEqual({
      over: [],
      lower: [],
      pins: BUDGET,
    });
  });

  it("asks for nothing while a suite is lighter by no more than the margin", () => {
    // 3 heavy files and 35 modules are the margins.
    expect(
      at(BUDGET.heavyFiles - 3, BUDGET.tailMeanModules - 35).lower
    ).toEqual([]);
  });

  it("names the exact lower pins once a suite is lighter by more than the margin", () => {
    const light = at(50, 500);
    expect(light.over).toEqual([]);
    expect(light.lower).toEqual(["heavyFiles", "tailMeanModules"]);
    expect(light.pins).toEqual({ heavyFiles: 53, tailMeanModules: 535 });
  });

  it("lowers only the pin the suite moved below, and keeps the other", () => {
    const { lower, pins } = at(50, BUDGET.tailMeanModules);
    expect(lower).toEqual(["heavyFiles"]);
    expect(pins).toEqual({
      heavyFiles: 53,
      tailMeanModules: BUDGET.tailMeanModules,
    });
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

describe("moduleWithKey", () => {
  // A Windows run's graph: the root and every id use `/`, as Vite spells
  // them on every platform, while joining the root with Windows' separator
  // would give `D:\a\...\src\di\register.ts`, an id no module has.
  const root = "D:/a/nextly/nextly/packages/nextly";
  const module = (id: string): GraphModule => ({
    id,
    importedModules: new Set(),
  });
  const modules = [
    module(`${root}/src/init/first-run.ts`),
    module(`${root}/src/di/register.ts`),
  ];

  it("finds a module by its record key, on a Windows run's ids", () => {
    expect(moduleWithKey(modules, root, "src/di/register.ts")?.id).toBe(
      `${root}/src/di/register.ts`
    );
  });

  it("answers nothing for a key no module has", () => {
    expect(
      moduleWithKey(modules, root, "src/schemas/index.ts")
    ).toBeUndefined();
  });
});

describe("compareHeavy", () => {
  it("names the files that became heavy and the ones that stopped", () => {
    expect(compareHeavy(["a", "c", "d"], ["a", "b", "c"])).toEqual({
      added: ["d"],
      removed: ["b"],
    });
  });

  it("finds no change between the same files in another order", () => {
    expect(compareHeavy(["b", "a"], ["a", "b"])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("the dialect boundary", () => {
  /** A graph module keyed by its path in the package. */
  const node = (id: string, ...imports: GraphModule[]): GraphModule => ({
    id,
    importedModules: new Set(imports),
  });
  const name = (m: GraphModule) => m.id ?? "?";
  const named = (crossings: ReturnType<typeof dialectBoundaryCrossings>) =>
    crossings.map(c => [name(c.from), ...c.path.map(name)].join(" → "));

  it("knows a dialect's table files, and nothing else", () => {
    expect(tableFileDialect("src/schemas/users/postgres.ts")).toBe(
      "postgresql"
    );
    expect(
      tableFileDialect("src/schemas/_dialect-bundles/mysql.relations.ts")
    ).toBe("mysql");
    expect(tableFileDialect("src/schemas/jobs/sqlite.ts")).toBe("sqlite");
    expect(tableFileDialect("src/schemas/users/index.ts")).toBeUndefined();
    expect(tableFileDialect("src/schemas/a/b/postgres.ts")).toBeUndefined();
    expect(tableFileDialect("src/domains/postgres.ts")).toBeUndefined();
  });

  it("holds product code to it, and not schemas, the loader, the root entry or tests", () => {
    expect(boundByDialectBoundary("src/domains/email/send-claims.ts")).toBe(
      true
    );
    expect(boundByDialectBoundary("src/schemas/users/index.ts")).toBe(false);
    expect(boundByDialectBoundary("src/database/dialect-tables.ts")).toBe(
      false
    );
    expect(boundByDialectBoundary("src/index.ts")).toBe(false);
    expect(boundByDialectBoundary("src/domains/x/__tests__/fixture.ts")).toBe(
      false
    );
    expect(boundByDialectBoundary("src/domains/x/y.test.ts")).toBe(false);
  });

  it("names a product import of another dialect's file, on that run's dialect only", () => {
    const pg = node("src/schemas/users/postgres.ts");
    const service = node("src/domains/users/service.ts", pg);
    expect(
      named(dialectBoundaryCrossings([service, pg], name, "sqlite"))
    ).toEqual(["src/domains/users/service.ts → src/schemas/users/postgres.ts"]);
    expect(dialectBoundaryCrossings([service, pg], name, "postgresql")).toEqual(
      []
    );
  });

  it("names an import through a schemas barrel that re-exports every dialect", () => {
    const pg = node("src/schemas/things/postgres.ts");
    const sqlite = node("src/schemas/things/sqlite.ts");
    const barrel = node("src/schemas/things/index.ts", sqlite, pg);
    const service = node("src/domains/things/service.ts", barrel);
    expect(
      named(dialectBoundaryCrossings([service, barrel, pg], name, "sqlite"))
    ).toEqual([
      "src/domains/things/service.ts → src/schemas/things/index.ts → src/schemas/things/postgres.ts",
    ]);
  });

  it("names only the module that imports, not the product code above it", () => {
    const pg = node("src/schemas/users/postgres.ts");
    const inner = node("src/domains/users/inner.ts", pg);
    const outer = node("src/domains/users/outer.ts", inner);
    expect(
      named(dialectBoundaryCrossings([outer, inner], name, "sqlite"))
    ).toEqual(["src/domains/users/inner.ts → src/schemas/users/postgres.ts"]);
  });

  it("does not name the loader, a test, the root entry, or the run's own dialect", () => {
    const pg = node("src/schemas/_dialect-bundles/postgres.ts");
    const own = node("src/schemas/users/sqlite.ts");
    const loader = node("src/database/dialect-tables.ts", pg);
    const service = node("src/domains/users/service.ts", loader, own);
    const test = node("src/domains/users/__tests__/parity.test.ts", pg);
    const root = node("src/index.ts", pg);
    expect(
      dialectBoundaryCrossings(
        [service, loader, test, root, pg, own],
        name,
        "sqlite"
      )
    ).toEqual([]);
  });
});
