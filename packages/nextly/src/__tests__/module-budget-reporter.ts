/**
 * Holds nextly's unit suite to a module budget: how many modules its test
 * files load.
 *
 * A file that loads the service registry or a dialect's schema bundle loads
 * most of the package, more than a thousand modules, and every such file adds
 * that load to every run of the suite. The budget caps how many files are that
 * heavy and how many modules the heaviest tenth of files load on average, so
 * an import that puts the registry back under a widely used module fails CI
 * instead of slowing every run unnoticed.
 *
 * A mean over the heaviest tenth, not a percentile: the files' counts have a
 * gap between the files that reach the registry and those that do not, and a
 * percentile landing at the gap jumps across it when one file is added or
 * removed anywhere in the suite, or when another machine runs one file more,
 * failing an unrelated change in either direction. One file entering or
 * leaving the tenth moves the mean by a few modules.
 *
 * The counts come from this run: Vitest records the modules each file loaded
 * (`experimental.recordDependencies`) and writes the records before reporters
 * hear that the run ended, so this reads exactly what the files just loaded.
 * Only a run of the whole suite is judged. A selection such as the pre-push's
 * `--changed` runs the files a change touches, often the heaviest ones, and its
 * numbers say nothing about the suite; nor does a run told to select
 * projects, such as the shuffled-order job's `--project nextly`.
 *
 * A record lists the package's own modules: Vitest leaves out every path under
 * `node_modules`, which Node loads outside the module runner. So the count is
 * how much of nextly a test file reaches, which is what an import reaching the
 * registry changes. What a dependency costs to load is not measured here.
 *
 * Only the isolated project is judged. A file's record is the closure of its
 * imports over the worker's evaluated modules, and in the shared project
 * (`isolate: false`) those modules stay loaded from one file to the next,
 * along with every `import()` an earlier file's tests ran. A file there is
 * recorded with the registry whenever an earlier file in its worker loaded it
 * lazily, so its count depends on which files shared the worker: it changes
 * from run to run, and with the number of workers a machine runs. Measured on
 * the same code, the shared project's heavy files went from 40 to 39 and nine
 * files crossed the line, while the isolated project's records were identical.
 * The shared and whole-suite numbers are printed on every run, not judged.
 *
 * When the budget is exceeded, there are two readings, and they need different
 * fixes, so the message prints the evidence for both: the chain from each of
 * the heaviest files to the module that makes it heavy, and whether the set of
 * heavy files still matches the one pinned in `module-budget-heavy-files.json`.
 * - A new import pulling `di/register` or a dialect bundle into files that did
 *   not load it: new files in the set, or chains through the new import. Fix
 *   the import, by loading it lazily; do not raise the pin.
 * - The registry itself gaining modules (a new service): the same heavy files
 *   and chains, each loading more. Raise the pin in the same pull request to
 *   the measured value plus the same margin, and say so in its description.
 * Otherwise the pins only go down, and a run lighter than a pin by more than
 * its margin fails until the pin is lowered.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { Reporter, TestModule, Vitest } from "vitest/node";

/** A test file loading more modules than this is heavy. */
export const HEAVY_MODULES = 1_000;

/** The project whose files are judged, as `vitest.config.ts` names it. */
export const JUDGED_PROJECT = "nextly (isolated)";

/**
 * The judged project's pins, each a margin above what it measured when it was
 * set (62 heavy files, and a mean of 1,191 modules over the heaviest tenth,
 * over 597 files; CI's runs measured 61 and 1,190), and the heavy files of
 * that measurement. The heavy files' pin was raised when three tests that
 * load the service registry by design joined them (the boot refusal of an
 * unsupported framework and two migrate commands' tests): 65 measured, so 67
 * held whether CI measured one fewer, as it has before. It comes down when
 * the two migrate commands' tests stop loading the registry (HEAVY_PIN_NOTE).
 * The tail mean's pin
 * was raised when the dashboard's pins joined the service registry (their
 * route and service) beside the logger's credential shapes: 1,228 measured,
 * the heavy files' chains unchanged, so 1,262 holds whether CI measures one
 * fewer. Each pin is the higher measurement plus its margin, at
 * most the lower measurement plus it, so it holds on both. A run that
 * measures below a pin by more than its margin fails, naming the pin to set;
 * the list is refreshed with them. The pins are edited by hand so that a
 * change to one is a line a reviewer reads; only the list has a command.
 */
export const BUDGET = { heavyFiles: 67, tailMeanModules: 1_262 };
const MARGIN = { heavyFiles: 3, tailMeanModules: 35 };
const PINNED_HEAVY_FILES = new URL(
  "./module-budget-heavy-files.json",
  import.meta.url
);
/** Set to 1 on a whole run to write that run's heavy files to the pinned list. */
const WRITE_HEAVY = "NEXTLY_MODULE_BUDGET_WRITE_HEAVY";

/** The modules a heavy file's load is explained by, relative to the package. */
const PULLS = [
  "src/di/register.ts",
  "src/schemas/_dialect-bundles/mysql.ts",
  "src/schemas/_dialect-bundles/postgres.ts",
  "src/schemas/_dialect-bundles/sqlite.ts",
];

/** How many files are named when the budget is exceeded. */
const NAMED = 10;

export interface Measured {
  files: number;
  heavyFiles: number;
  tailMeanModules: number;
}

/**
 * The mean module count of the heaviest tenth of `sorted` (ascending), at
 * least one file, rounded to a whole module; 0 for no files.
 */
function tailMean(sorted: readonly number[]): number {
  const tail = sorted.slice(
    sorted.length - Math.max(1, Math.ceil(sorted.length / 10))
  );
  if (tail.length === 0) return 0;
  return Math.round(tail.reduce((sum, count) => sum + count, 0) / tail.length);
}

/** A set of test files' numbers from each one's module count. */
export function measure(counts: readonly number[]): Measured {
  const sorted = [...counts].sort((a, b) => a - b);
  return {
    files: sorted.length,
    heavyFiles: sorted.filter(n => n > HEAVY_MODULES).length,
    tailMeanModules: tailMean(sorted),
  };
}

/** What the budget says about a measurement: what it exceeds, and pins to lower. */
export function judge(measured: Measured, budget = BUDGET) {
  const over: string[] = [];
  const lower: string[] = [];
  const pins = { ...budget };
  for (const key of ["heavyFiles", "tailMeanModules"] as const) {
    if (measured[key] > budget[key]) over.push(key);
    else if (measured[key] + MARGIN[key] < budget[key]) {
      lower.push(key);
      pins[key] = measured[key] + MARGIN[key];
    }
  }
  // `pins` is the budget as it should now read: each pin the suite has moved
  // below by more than its margin, lowered to the measurement plus the margin.
  return { over, lower, pins };
}

/** How this run's heavy files differ from the pinned ones. */
export function compareHeavy(
  current: readonly string[],
  pinned: readonly string[]
): { added: string[]; removed: string[] } {
  const now = new Set(current);
  const then = new Set(pinned);
  return {
    added: [...now].filter(file => !then.has(file)).sort(),
    removed: [...then].filter(file => !now.has(file)).sort(),
  };
}

/** The line saying whether the heavy files are the pinned ones. */
function describeHeavyChange({
  added,
  removed,
}: ReturnType<typeof compareHeavy>): string {
  if (added.length === 0 && removed.length === 0) {
    return "heavy-file set unchanged vs. pinned: yes";
  }
  return [
    "heavy-file set unchanged vs. pinned: no",
    added.length > 0 ? `newly heavy: ${added.join(", ")}` : "",
    removed.length > 0 ? `no longer heavy: ${removed.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** One line of numbers, as every line here prints them. */
function describeMeasured(measured: Measured, budget?: typeof BUDGET): string {
  const cap = (key: keyof typeof BUDGET) =>
    budget ? ` (at most ${budget[key]})` : "";
  return (
    `${measured.heavyFiles} heavy files${cap("heavyFiles")}, ` +
    `${measured.tailMeanModules} modules on average in the heaviest tenth${cap("tailMeanModules")}, ` +
    `over ${measured.files} test files`
  );
}

/** Vitest's dependency records: per project, the files and what each loaded. */
interface Records {
  version: number;
  projects: Record<
    string,
    { modules: string[]; files: Record<string, number[]> }
  >;
}

/**
 * A test file's key in the records. Vitest keys them by the module id with the
 * root and its slash cut off, ids using `/` on every platform, and falls back
 * to `relative` only for a file outside the root; `relative` alone would give
 * `\` on Windows and find no record.
 */
function recordKey(root: string, moduleId: string): string {
  return moduleId.startsWith(`${root}/`)
    ? moduleId.slice(root.length + 1)
    : relative(root, moduleId);
}

/** A module in Vite's graph, as far as a walk over its imports needs. */
export interface GraphModule {
  id: string | null;
  importedModules: Set<GraphModule>;
}

/**
 * The module among `modules` whose record key is `key`. Found by the key, the
 * spelling every other lookup here uses, rather than by building its id: Vite's
 * ids use `/` on every platform, so an id joined with the platform's separator
 * names no module on Windows.
 */
export function moduleWithKey(
  modules: Iterable<GraphModule>,
  root: string,
  key: string
): GraphModule | undefined {
  for (const module of modules) {
    if (module.id && recordKey(root, module.id) === key) return module;
  }
  return undefined;
}

/**
 * The modules from `start` to the nearest one `isTarget` accepts, breadth
 * first, so the chain printed is the shortest; empty when none is reached.
 */
export function shortestPath(
  start: GraphModule,
  isTarget: (module: GraphModule) => boolean
): GraphModule[] {
  const previous = new Map<GraphModule, GraphModule | null>([[start, null]]);
  const queue = [start];
  for (let current = queue.shift(); current; current = queue.shift()) {
    if (isTarget(current)) {
      const path: GraphModule[] = [];
      for (
        let at: GraphModule | null = current;
        at;
        at = previous.get(at) ?? null
      ) {
        path.unshift(at);
      }
      return path;
    }
    for (const next of current.importedModules) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return [];
}

/**
 * The dialect whose table definitions the module `key` (its path in the
 * package) holds: a feature's dialect file, or a dialect's bundle or its
 * relations. Undefined for any other module.
 */
export function tableFileDialect(key: string): string | undefined {
  const match =
    /^src\/schemas\/[^/]+\/(postgres|mysql|sqlite)(?:\.relations)?\.ts$/.exec(
      key
    );
  if (!match) return undefined;
  return match[1] === "postgres" ? "postgresql" : match[1];
}

/**
 * The published entry that re-exports PostgreSQL's tables by name, and so
 * loads them for whoever imports it. A public contract, not a path product
 * code takes to a table.
 */
const PUBLIC_TABLE_ENTRIES = ["src/index.ts"];

/**
 * Whether the module `key` is product code held to the dialect boundary: it
 * reads a dialect's tables through the loaded dialect. The schema files, the
 * loader that imports one dialect's on purpose, the published entry above,
 * tests and their helpers are not.
 */
export function boundByDialectBoundary(key: string): boolean {
  return (
    key.startsWith("src/") &&
    !key.startsWith("src/schemas/") &&
    key !== "src/database/dialect-tables.ts" &&
    !PUBLIC_TABLE_ENTRIES.includes(key) &&
    !/(^|\/)__tests__\/|\.(test|spec|test-d)\.tsx?$/.test(key)
  );
}

/** A product module's import that reaches another dialect's tables. */
export interface Crossing {
  /** The product module importing. */
  from: GraphModule;
  /** From its import to the other dialect's table file, through `schemas/`. */
  path: GraphModule[];
}

/**
 * Every import, in `modules`, by product code held to the dialect boundary
 * that reaches a table file of a dialect other than `dialect`: directly, or
 * through modules under `src/schemas/` such as a barrel re-exporting every
 * dialect. A dialect is reached through the loader only by the files that
 * load it on purpose, so on a run on one dialect the others' files are
 * reached through no product import at all.
 */
export function dialectBoundaryCrossings(
  modules: Iterable<GraphModule>,
  name: (module: GraphModule) => string,
  dialect: string
): Crossing[] {
  const other = (m: GraphModule) => {
    const of = tableFileDialect(name(m));
    return of !== undefined && of !== dialect;
  };
  const crossings: Crossing[] = [];
  for (const from of modules) {
    if (!boundByDialectBoundary(name(from))) continue;
    for (const imported of from.importedModules) {
      const key = name(imported);
      if (other(imported)) {
        crossings.push({ from, path: [imported] });
      } else if (key.startsWith("src/schemas/")) {
        const within = schemasOnly(imported, name);
        const path = shortestPath(within, m => other(m));
        if (path.length > 0) crossings.push({ from, path: path.map(unwrap) });
      }
    }
  }
  return crossings;
}

/** A view of `start` whose imports stay under `src/schemas/`. */
interface Restricted extends GraphModule {
  original: GraphModule;
}

function schemasOnly(
  start: GraphModule,
  name: (module: GraphModule) => string
): Restricted {
  const views = new Map<GraphModule, Restricted>();
  const view = (module: GraphModule): Restricted => {
    const known = views.get(module);
    if (known) return known;
    const made: Restricted = {
      id: module.id,
      original: module,
      get importedModules() {
        return new Set(
          [...module.importedModules]
            .filter(next => name(next).startsWith("src/schemas/"))
            .map(view)
        );
      },
    };
    views.set(module, made);
    return made;
  };
  return view(start);
}

function unwrap(module: GraphModule): GraphModule {
  return (module as Restricted).original ?? module;
}

/** The shortest import chain from a test file to a module that pulls, if any. */
function chainToPull(module: TestModule): string | undefined {
  const root = module.project.config.root;
  const name = (m: GraphModule) => (m.id ? recordKey(root, m.id) : "?");
  for (const environment of Object.values(module.project.vite.environments)) {
    const start = environment.moduleGraph.getModuleById(module.moduleId);
    if (!start) continue;
    const path = shortestPath(start, m => PULLS.includes(name(m)));
    if (path.length > 0) return path.map(name).join(" → ");
  }
  return undefined;
}

export default class ModuleBudgetReporter implements Reporter {
  private vitest!: Vitest;
  private started = 0;

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  onTestRunStart(): void {
    this.started = Date.now();
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>): Promise<void> {
    const partial = await this.partialRun(testModules);
    if (partial) {
      console.log(`module budget not judged: ${partial}`);
      return;
    }
    // Decided before the records are read: a run that judges nothing needs
    // none, and one told to select projects may run without the cache that
    // writes them.
    if (!testModules.some(m => m.project.name === JUDGED_PROJECT)) {
      // A run told to select projects, such as `--project nextly`, ran no file
      // of the judged one by request. Without that request, its absence means
      // the project was renamed, and the budget would judge nothing while
      // every run reported it as passing.
      const selected = this.vitest.config.project;
      if (selected.length > 0) {
        console.log(
          `module budget not judged: this run selected the projects ${selected.join(", ")}`
        );
        return;
      }
      return fail(
        `module budget: no test file of the project "${JUDGED_PROJECT}" ran; ` +
          "set JUDGED_PROJECT in src/__tests__/module-budget-reporter.ts to its name"
      );
    }
    const counted = this.recordedCounts(testModules);
    if (typeof counted === "string") return fail(counted);
    this.report(
      counted,
      counted.filter(c => c.module.project.name === JUDGED_PROJECT)
    );
  }

  /** Why this run is not the whole suite, or undefined when it is. */
  private async partialRun(
    testModules: ReadonlyArray<TestModule>
  ): Promise<string | undefined> {
    const {
      cliExclude = [],
      tagsFilter = [],
      testNamePattern,
    } = this.vitest.config;
    // Narrowed before discovery: files left out with `--exclude` are missing
    // from the glob below as well, so comparing the two cannot see them, and a
    // name or tag filter narrows the tests inside files that all ran.
    const narrowed = [
      cliExclude.length > 0 ? `files excluded with --exclude` : "",
      tagsFilter.length > 0 ? "filtered by tag" : "",
      testNamePattern ? "filtered by test name" : "",
    ].filter(Boolean);
    const all = await this.vitest.globTestSpecifications();
    const key = (project: string, file: string) =>
      JSON.stringify([project, file]);
    const ran = new Set(testModules.map(m => key(m.project.name, m.moduleId)));
    const missing = all.filter(s => !ran.has(key(s.project.name, s.moduleId)));
    if (narrowed.length === 0 && missing.length === 0) return undefined;
    return [
      `this run ran ${testModules.length} of ${all.length} test files`,
      ...narrowed,
    ].join(", ");
  }

  /**
   * Each file's module count from this run's records, or why they cannot be
   * read. The whole suite ran, and Vitest records every file of such a run, so
   * a missing record is the instrument failing (the cache or
   * `recordDependencies` turned off), not a reason to pass.
   */
  private recordedCounts(
    testModules: ReadonlyArray<TestModule>
  ): Counted[] | string {
    // Where Vitest writes the records, from the same setting it reads.
    const path = join(this.vitest.viteConfig.cacheDir, "dependencies.json");
    const advice =
      "keep experimental.recordDependencies on and the cache enabled";
    if (!existsSync(path)) {
      return `module budget: the whole suite ran but Vitest wrote no dependency records at ${path}; ${advice}`;
    }
    // A file left by an earlier run is still on disk when this one wrote
    // nothing, and its counts would be judged as this run's.
    if (statSync(path).mtimeMs < this.started) {
      return `module budget: the whole suite ran but its dependency records at ${path} predate this run, so this run wrote none; ${advice}`;
    }
    const records = JSON.parse(readFileSync(path, "utf8")) as Records;
    const root = this.vitest.config.root;
    const counted: Counted[] = [];
    for (const module of testModules) {
      const count =
        records.projects[module.project.name]?.files[
          recordKey(root, module.moduleId)
        ]?.length;
      if (count === undefined) {
        return `module budget: the whole suite ran but ${relative(root, module.moduleId)} has no dependency record`;
      }
      counted.push({ module, count });
    }
    return counted;
  }

  /** Judges the judged project's files and reports the rest. */
  private report(counted: Counted[], judged: Counted[]): void {
    const root = this.vitest.config.root;
    const measured = measure(judged.map(c => c.count));
    const { over, lower, pins } = judge(measured);
    const heavy = judged.filter(c => c.count > HEAVY_MODULES);
    const pinned = JSON.parse(readFileSync(PINNED_HEAVY_FILES, "utf8")) as {
      files: string[];
    };
    const change = describeHeavyChange(
      compareHeavy(
        heavy.map(c => recordKey(root, c.module.moduleId)),
        pinned.files
      )
    );
    console.log(
      `module budget, judged on ${JUDGED_PROJECT}: ${describeMeasured(measured, BUDGET)}; ${change}`
    );
    console.log(
      "module budget, reported, not judged (shared workers vary by run order): " +
        describeUnjudged(counted)
    );
    if (process.env[WRITE_HEAVY] === "1") {
      writeFileSync(
        PINNED_HEAVY_FILES,
        `${JSON.stringify({ files: heavy.map(c => recordKey(root, c.module.moduleId)).sort() }, null, 2)}\n`
      );
      console.log(
        `module budget: wrote this run's ${heavy.length} heavy files to the pinned list`
      );
    }
    this.judgeDialectBoundary(counted);
    if (over.length > 0) {
      fail(exceededMessage(root, over, measured, change, heavy));
    } else if (lower.length > 0) {
      // A ratchet that only asks leaves the headroom for a later regression
      // to spend unseen, so a suite lighter than a pin by more than its margin
      // fails until the pin comes down. The counts are the same on every run,
      // so this cannot flake.
      fail(
        `module budget: ${JUDGED_PROJECT} is lighter than its pins (${lower.join(", ")}), ` +
          "and the pins only go down. In src/__tests__/module-budget-reporter.ts set\n" +
          `  export const BUDGET = { heavyFiles: ${pins.heavyFiles}, tailMeanModules: ${pins.tailMeanModules} };\n` +
          "and refresh the pinned heavy files from a whole run:\n" +
          `  ${WRITE_HEAVY}=1 pnpm --filter nextly exec vitest run`
      );
    }
  }
  /**
   * Holds the run to the dialect boundary, over every module the run's Vite
   * graphs hold. Two claims, each failing the run with the chains it found:
   * no product import reaches another dialect's table file (the run's dialect
   * is `DB_DIALECT`, which the unit setup defaults to SQLite), and the boot
   * path, from `di/register`, does not reach the public schemas entry, which
   * loads PostgreSQL's tables. A run whose graphs never loaded the boot module
   * fails too, rather than passing the second claim unchecked.
   */
  private judgeDialectBoundary(counted: Counted[]): void {
    const root = this.vitest.config.root;
    const name = (m: GraphModule) => (m.id ? recordKey(root, m.id) : "?");
    const dialect = process.env.DB_DIALECT ?? "sqlite";
    const graphs = new Set(
      counted.flatMap(({ module }) =>
        Object.values(module.project.vite.environments).map(
          environment => environment.moduleGraph
        )
      )
    );
    const crossings = new Map<string, Crossing>();
    let boot: GraphModule | undefined;
    for (const graph of graphs) {
      for (const crossing of dialectBoundaryCrossings(
        graph.idToModuleMap.values(),
        name,
        dialect
      )) {
        const line = [crossing.from, ...crossing.path].map(name).join(" → ");
        crossings.set(line, crossing);
      }
      boot ??= moduleWithKey(
        graph.idToModuleMap.values(),
        root,
        "src/di/register.ts"
      );
    }
    const problems: string[] = [];
    for (const [line, crossing] of [...crossings].slice(0, NAMED)) {
      const reached = chainFromTest(counted, crossing.from, name);
      problems.push(
        `  ${line}${reached ? `\n    reached from ${reached}` : ""}`
      );
    }
    if (crossings.size > 0) {
      problems.unshift(
        `a product import reaches another dialect's tables on this ${dialect} run (${crossings.size}):`
      );
    }
    if (!boot) {
      problems.push(
        "the boot module src/di/register.ts was not loaded by this run, so whether boot reaches the public schemas entry was not checked"
      );
    } else {
      const toPublic = shortestPath(
        boot,
        m => name(m) === "src/schemas/index.ts"
      );
      if (toPublic.length > 0) {
        problems.push(
          `the boot path reaches the public schemas entry, which loads PostgreSQL's tables:\n  ${toPublic.map(name).join(" → ")}`
        );
      }
    }
    if (problems.length === 0) {
      console.log(
        `module budget, dialect boundary: no product import reaches another dialect's tables on this ${dialect} run, and boot does not reach the public schemas entry`
      );
      return;
    }
    fail(
      `module budget, dialect boundary FAILED: ${problems.join("\n")}\n` +
        "Read a dialect's tables through the loaded dialect (loadedDialect or getDialectTables from database/); a type-only import of a dialect file loads nothing."
    );
  }
}

/** The shortest chain from a test file that ran to `target`, if any. */
function chainFromTest(
  counted: Counted[],
  target: GraphModule,
  name: (m: GraphModule) => string
): string | undefined {
  for (const { module } of counted) {
    for (const environment of Object.values(module.project.vite.environments)) {
      const start = environment.moduleGraph.getModuleById(module.moduleId);
      if (!start) continue;
      const path = shortestPath(start, m => m === target);
      if (path.length > 0) return path.map(name).join(" → ");
    }
  }
  return undefined;
}

/** A test file that ran, and how many modules its record lists. */
interface Counted {
  module: TestModule;
  count: number;
}

/** Fails the run with `message`, which is why it failed. */
function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

/** The projects not judged, and the whole suite, as one line of numbers. */
function describeUnjudged(counted: Counted[]): string {
  const names = [...new Set(counted.map(c => c.module.project.name))];
  return [
    ...names
      .filter(name => name !== JUDGED_PROJECT)
      .map(
        name =>
          `${name}: ${describeMeasured(
            measure(
              counted
                .filter(c => c.module.project.name === name)
                .map(c => c.count)
            )
          )}`
      ),
    `whole suite: ${describeMeasured(measure(counted.map(c => c.count)))}`,
  ].join("; ");
}

/**
 * The failure, with the evidence for both readings of it and what each calls
 * for: the heavy-file set against the pinned one, and the chain from each of
 * the heaviest files to what makes it heavy.
 */
function exceededMessage(
  root: string,
  over: string[],
  measured: Measured,
  change: string,
  heavy: Counted[]
): string {
  const heaviest = [...heavy].sort((a, b) => b.count - a.count).slice(0, NAMED);
  return [
    `module budget EXCEEDED on ${JUDGED_PROJECT} (${over.join(", ")}): a test file ` +
      `loads more modules than ${HEAVY_MODULES} when it reaches the service registry ` +
      "or a dialect's schema bundle.",
    "- If the chains below show a NEW import pulling di/register or a dialect bundle " +
      "into files that did not load it, fix the import (load it lazily with import() " +
      "where it is needed, or make it type-only). Do not raise the pin.",
    "- If the heavy files and chains are unchanged and the numbers grew because the " +
      "registry itself gained modules (a new service), raise the pin in the same pull " +
      "request to the measured value plus the same margin, and say so in its description.",
    change,
    `The heaviest of its ${measured.heavyFiles} heavy files:`,
    ...heaviest.map(({ module, count }) => {
      const chain = chainToPull(module);
      return (
        `  ${relative(root, module.moduleId)}: ${count} modules` +
        (chain ? `\n    ${chain}` : "")
      );
    }),
  ].join("\n");
}
