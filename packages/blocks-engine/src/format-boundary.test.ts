import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The `./format` entry point's whole value is what it does NOT reach.
 *
 * It exists so a consumer that needs the document format's vocabulary — a
 * generator, a schema publisher, an agent — does not also load the validator,
 * the migrations and the style compiler's CSS parser. Reading four constants
 * through the package root once took a dependent's bundle from 53,685 to
 * 204,524 bytes, none of it reachable from what it imported.
 *
 * **This is asserted against the BUILT bundles, and the distinction is the
 * test.** `runtime-free.test.ts` reads source and constrains what this package
 * as a whole may depend on; neither it nor any type-level check can say what a
 * particular entry point PULLS IN once the bundler has decided how to split
 * things. A re-export added to `format.ts` from a module that happens to touch
 * the compiler compiles, type-checks, and passes every source-level guard while
 * silently restoring the regression this entry point was added to remove.
 *
 * ## Why nothing here reads the bundle as text
 *
 * The boundary used to be checked by matching import syntax with a regular
 * expression, and a scan over syntax has an unbounded surface: measured, an
 * `import` written with a comment between the keyword and its parenthesis
 * matched nothing — certifying the entry while omitting a module it reaches —
 * and a keyword inside a longer string was read as an import that does not
 * exist. Both directions were wrong, and the first is the dangerous one,
 * because a scan that sees less reports a healthier boundary.
 *
 * Two instruments replace it, each complete in a dimension the other is not.
 *
 * **The build's own module graph.** `tsup` writes esbuild's metafile beside the
 * bundles, recording every import edge with its KIND — including the ones
 * nothing executes. A `import("css-tree/parser")` behind a function is a real
 * edge to a real dependency, and no amount of loading the entry point asks the
 * resolver for it. Authoritative because it comes from the tool that emitted
 * the code.
 *
 * **The resolver.** The entry is imported from a directory with NO
 * `node_modules` above it, so anything reaching a runtime dependency fails to
 * resolve. That says nothing about deferred edges, and it is the only one of
 * the two that judges the FILE rather than a record about it.
 *
 * Neither alone is enough, and the pairing is the point: a metafile can
 * describe a build the files on disk are no longer from, and an import passes
 * over every dependency it never reaches. So the metafile is checked against
 * the bytes actually on disk, and the import is run against the real files.
 *
 * @module format-boundary.test
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PACKAGE = dirname(DIST);
const METAFILE = join(DIST, "metafile-esm.json");

/**
 * How long a child gets to import one entry point before it is a hang.
 *
 * Loading two files is milliseconds of work; a minute is the point past which
 * no plausible amount of runner contention explains it.
 */
const CHILD_TIMEOUT_MS = 60_000;
const FORMAT_ENTRY = "format.mjs";
const ROOT_ENTRY = "index.mjs";

/** What running one entry point in a child process reported. */
interface EntryRun {
  readonly ok: boolean;
  readonly stderr: string;
  /** Each specifier the resolver was asked for, with what it answered. */
  readonly resolved: readonly { specifier: string; url: string }[];
}

/**
 * The directories a bare specifier would be looked up in, from `from` upwards.
 *
 * Node walks parents until the filesystem root, so isolation is a property of
 * the whole chain rather than of the directory chosen. Asserted rather than
 * assumed: a `node_modules` anywhere above would make every import below
 * resolve, and the boundary test would pass by not being a boundary.
 */
function lookupChain(from: string): string[] {
  const chain: string[] = [];
  let current = from;
  for (;;) {
    chain.push(join(current, "node_modules"));
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return chain;
    current = parent;
  }
}

/**
 * A directory to build the sandbox under whose ancestors hold no
 * `node_modules`.
 *
 * `os.tmpdir()` is the obvious answer and is not always the right one: it reads
 * `TMPDIR`, which a hermetic or project-local test setup can point INSIDE the
 * checkout — and then the sandbox sits under the workspace, every runtime
 * dependency resolves by the ordinary upward lookup, and the boundary passes by
 * not being one. The precondition below catches that, so the failure is honest;
 * it is still a red for a reason that has nothing to do with the bundle.
 *
 * So the location is CHOSEN rather than assumed. Candidates are tried in order
 * and the first with a clean ancestor chain wins.
 *
 * Refuses rather than falling back to a dirty directory. A sandbox that
 * resolves is not a sandbox, and a suite that quietly went on using one would
 * report the boundary intact whatever the bundle imports.
 */
function isolatedRoot(): string {
  // The runner's own temp first where CI provides one, then the platform's,
  // then the POSIX default — which is deliberately last, because it is the one
  // an environment variable cannot redirect and so the one least likely to have
  // been pointed anywhere.
  const candidates = [process.env.RUNNER_TEMP, tmpdir(), "/tmp"];
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined || !existsSync(candidate)) continue;
    const reachable = lookupChain(realpathSync(candidate)).filter(existsSync);
    if (reachable.length === 0) return candidate;
    tried.push(`${candidate} (reaches ${reachable[0] ?? ""})`);
  }
  throw new Error(
    `no dependency-free directory to sandbox in; tried ${tried.join(", ")}`
  );
}

let sandbox = "";
let hooks = "";
let record = "";

beforeAll(() => {
  sandbox = mkdtempSync(join(isolatedRoot(), "nextly-format-boundary-"));
  cpSync(DIST, join(sandbox, "dist"), { recursive: true });

  record = join(sandbox, "resolved.jsonl");
  hooks = join(sandbox, "hooks.mjs");
  // A resolution hook rather than a reading of the emitted text. It records
  // what the resolver was ASKED and what it ANSWERED, so a specifier written in
  // a form no pattern anticipates is still seen — there is no form to miss.
  writeFileSync(
    hooks,
    [
      `import { appendFileSync } from "node:fs";`,
      `export async function resolve(specifier, context, next) {`,
      `  const result = await next(specifier, context);`,
      `  appendFileSync(process.env.NEXTLY_RESOLVE_RECORD, JSON.stringify({ specifier, url: result.url }) + "\\n");`,
      `  return result;`,
      `}`,
    ].join("\n")
  );
});

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Import one entry point in a child process, optionally recording what the
 * resolver did.
 *
 * A child rather than this process, because the question is what happens on a
 * fresh resolution from a particular directory — and the test runner has
 * already loaded this package, its dependencies and its own graph.
 */
function runEntry(
  from: string,
  entry: string,
  { instrumented }: { instrumented: boolean }
): EntryRun {
  const url = pathToFileURL(join(from, entry)).href;
  const bootstrap = instrumented
    ? [
        `import { register } from "node:module";`,
        `import { pathToFileURL } from "node:url";`,
        `register(pathToFileURL(${JSON.stringify(hooks)}));`,
        `await import(${JSON.stringify(url)});`,
      ].join("\n")
    : `await import(${JSON.stringify(url)});`;

  if (instrumented) writeFileSync(record, "");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", bootstrap],
    {
      encoding: "utf8",
      // The child's own cwd, so a bare specifier is looked up from the
      // directory holding the entry rather than from wherever vitest was run.
      cwd: from,
      env: { ...process.env, NEXTLY_RESOLVE_RECORD: record },
      // A ceiling, because this call is SYNCHRONOUS: an entry point that opens
      // a handle or deadlocks while initialising would otherwise block the
      // vitest worker itself, and vitest's own per-test timeout cannot fire on
      // a thread that is not yielding — the suite hangs where it should report.
      // Generous, so a cold start on a loaded runner is never the cause.
      timeout: CHILD_TIMEOUT_MS,
    }
  );

  // `spawnSync` reports a timeout or a failure to start through `error` and
  // leaves `status` null, which reads as "did not exit 0" — the right verdict
  // for the boundary and the wrong REASON to show. Carried into the message so
  // a hang is reported as a hang.
  const stderr = [result.stderr ?? "", result.error?.message ?? ""]
    .filter(part => part !== "")
    .join("\n");

  const resolved = !instrumented
    ? []
    : readFileSync(record, "utf8")
        .split("\n")
        .filter(line => line !== "")
        .map(line => JSON.parse(line) as { specifier: string; url: string });

  return { ok: result.status === 0, stderr, resolved };
}

const isRelative = (specifier: string) => specifier.startsWith(".");

/**
 * The bare package specifiers a run actually resolved.
 *
 * A specifier carrying a SCHEME is not one of them, and excluding it is not
 * cosmetic: the bootstrap imports the entry by its own `file:` URL, so a run
 * that resolved nothing at all would otherwise report one external and every
 * empty-set assertion below would fail on the harness rather than on the
 * boundary. Built-ins are excluded for the reason the boundary is about
 * bundle weight: `node:path` costs a consumer nothing to load.
 */
function externals(run: EntryRun): string[] {
  const found = new Set<string>();
  for (const { specifier } of run.resolved) {
    if (isRelative(specifier) || URL.canParse(specifier)) continue;
    if (specifier.startsWith("node:")) continue;
    found.add(specifier);
  }
  return [...found].sort();
}

/** The bytes of every emitted file a run loaded from `dist`. */
function bytesOf(run: EntryRun): number {
  const files = new Set<string>();
  for (const { url } of run.resolved) {
    if (!url.startsWith("file:")) continue;
    const file = fileURLToPath(url);
    if (file.startsWith(DIST)) files.add(file);
  }
  let total = 0;
  for (const file of files) total += statSync(file).size;
  return total;
}

describe("the format entry point's boundary", () => {
  it("has been built", () => {
    // Every assertion below reads these files. A missing one makes the
    // isolated import fail for a reason that has nothing to do with the
    // boundary, and an unbuilt tree would otherwise read as a broken one.
    for (const entry of [FORMAT_ENTRY, ROOT_ENTRY]) {
      const file = join(DIST, entry);
      expect(existsSync(file), `${file} is missing`).toBe(true);
    }
  });

  it("is asked from a directory nothing can be resolved out of", () => {
    // The precondition the two assertions below rest on, and the one that fails
    // in the flattering direction if it is wrong: a `node_modules` anywhere
    // above the sandbox resolves every runtime dependency, the isolated import
    // succeeds for the wrong reason, and the control below stops controlling.
    //
    // `isolatedRoot` chose a clean root, so this asserts that creating the
    // sandbox inside it introduced nothing — and that the choice was made at
    // all, which is the part a later edit could drop.
    const reachable = lookupChain(realpathSync(sandbox)).filter(existsSync);
    expect(reachable, `resolvable from ${sandbox}`).toEqual([]);
  });

  it("imports with no node_modules in reach", () => {
    // The boundary itself. Not "no import matched a pattern" — the resolver was
    // given the entry with nothing to resolve a bare specifier from, and it
    // loaded. Anything reaching a runtime dependency cannot.
    const run = runEntry(join(sandbox, "dist"), FORMAT_ENTRY, {
      instrumented: false,
    });

    expect(run.ok, run.stderr).toBe(true);
  });

  it("CONTROL: the package root cannot, in that same directory", () => {
    // Without this the test above passes on an isolation that isolates
    // nothing — a sandbox that could still see a `node_modules`, a child that
    // silently exited 0, an entry file that does not exist. The root reaches
    // the CSS parser, so it must fail here, and its failure is what proves the
    // format entry's success means something.
    const run = runEntry(join(sandbox, "dist"), ROOT_ENTRY, {
      instrumented: false,
    });

    expect(run.ok).toBe(false);
    expect(run.stderr).toContain("ERR_MODULE_NOT_FOUND");
    expect(run.stderr).toContain("css-tree");
  });
});

/**
 * One output file as the build recorded it: what it weighs, and what it
 * imports.
 *
 * `external` distinguishes a bare package from another emitted chunk, so
 * following the second and collecting the first is the whole graph walk — over
 * data the bundler produced, rather than over the text it produced.
 */
interface BuildOutput {
  readonly bytes: number;
  readonly imports?: readonly {
    readonly path: string;
    readonly kind: string;
    readonly external?: boolean;
  }[];
}

function buildGraph(): Record<string, BuildOutput> {
  const raw: unknown = JSON.parse(readFileSync(METAFILE, "utf8"));
  const outputs = (raw as { outputs?: Record<string, BuildOutput> }).outputs;
  if (outputs === undefined) {
    throw new Error(`${METAFILE} has no outputs; the build did not write it`);
  }
  return outputs;
}

/**
 * Every emitted file an entry reaches, chunks included.
 *
 * The one traversal both questions below are asked of. They differ only in what
 * they read off each file — its externals, or its bytes — and walking twice is
 * two answers to "what does this entry reach", which drift the first time a
 * kind of edge is treated differently in one of them.
 */
function reachableOutputs(
  outputs: Record<string, BuildOutput>,
  entry: string
): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    // An emitted chunk can reference another in a cycle, so a walk without this
    // does not return.
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const edge of outputs[file]?.imports ?? []) {
      if (edge.external !== true) queue.push(edge.path);
    }
  }
  return [...seen];
}

/**
 * Every bare package an emitted entry reaches.
 *
 * Every KIND of edge counts, and that is the point of reading this rather than
 * observing an import: `kind` is `dynamic-import` for the deferred ones, and a
 * deferred edge to a runtime dependency is exactly as much of a dependency as
 * an eager one — it is simply one nothing asks for until it is called.
 */
function buildExternals(
  outputs: Record<string, BuildOutput>,
  entry: string
): string[] {
  const externals = new Set<string>();
  for (const file of reachableOutputs(outputs, entry)) {
    for (const edge of outputs[file]?.imports ?? []) {
      if (edge.external === true) externals.add(edge.path);
    }
  }
  return [...externals].sort();
}

/** The bytes of every emitted file an entry reaches, chunks included. */
function buildBytes(
  outputs: Record<string, BuildOutput>,
  entry: string
): number {
  return reachableOutputs(outputs, entry).reduce(
    (total, file) => total + (outputs[file]?.bytes ?? 0),
    0
  );
}

/** The metafile's own name for an emitted file: a path from the package root. */
const emitted = (file: string) => `dist/${file}`;

describe("the walk over that graph", () => {
  /**
   * A graph with the three shapes the real one does not currently have.
   *
   * The build emits no dynamic import today and reaches its dependency
   * straight from the entry, so every property below is invisible when asserted
   * against `dist`: a walk that ignored deferred edges, or never followed a
   * chunk, or summed only the entry, agrees with the correct one on this
   * build. They would start disagreeing the day the bundle changed shape,
   * which is the day the walk stops being watched.
   */
  const FIXTURE: Record<string, BuildOutput> = {
    "dist/entry.mjs": {
      bytes: 10,
      imports: [
        { path: "dist/chunk.mjs", kind: "import-statement" },
        { path: "eager-pkg", kind: "import-statement", external: true },
      ],
    },
    "dist/chunk.mjs": {
      bytes: 100,
      imports: [
        { path: "deferred-pkg", kind: "dynamic-import", external: true },
        // Back to the entry: emitted chunks do reference each other in cycles,
        // and a walk without a seen-set does not return from this.
        { path: "dist/entry.mjs", kind: "import-statement" },
      ],
    },
  };

  it("follows chunk edges to the dependencies behind them", () => {
    expect(buildExternals(FIXTURE, "dist/entry.mjs")).toContain("deferred-pkg");
  });

  it("counts a DEFERRED edge as a dependency", () => {
    // The property this file was rebuilt for. An import behind a function is a
    // real edge to a real package; nothing asks the resolver for it until it is
    // called, which is exactly why observing an import cannot see it.
    const deferredOnly: Record<string, BuildOutput> = {
      "dist/only.mjs": {
        bytes: 1,
        imports: [{ path: "lazy-pkg", kind: "dynamic-import", external: true }],
      },
    };

    expect(buildExternals(deferredOnly, "dist/only.mjs")).toEqual(["lazy-pkg"]);
  });

  it("sums the bytes of every chunk an entry reaches", () => {
    expect(buildBytes(FIXTURE, "dist/entry.mjs")).toBe(110);
  });

  it("does not treat a chunk as a dependency", () => {
    // The other direction: a relative edge is code this package emitted, and
    // reporting it as an external would make every entry point look like it
    // reaches something.
    expect(buildExternals(FIXTURE, "dist/entry.mjs")).toEqual([
      "deferred-pkg",
      "eager-pkg",
    ]);
  });
});

describe("the module graph the build recorded", () => {
  it("describes the files that are actually on disk", () => {
    // The metafile is a RECORD of a build, and every assertion below trusts it
    // to describe this one. A `dist` rebuilt by some path that did not write it
    // leaves a stale graph saying whatever it said last time — which is the
    // flattering direction, because the boundary was intact then.
    //
    // NOT by comparing recorded sizes against the files. Measured, they do not
    // agree and are not meant to: esbuild records what IT emitted, and tsup
    // rewrites both the module and its map afterwards — `dist/format.mjs` is
    // 890 bytes in the record and 490 on disk. A guard built on that would fail
    // on every correct build, and be removed.
    //
    // Two things that do hold. The record names exactly the modules that exist,
    // so an entry point added or dropped without rewriting it is caught; and no
    // module is NEWER than the record, so a `dist` rebuilt by some path that
    // did not write one is caught. That second case is the one worth having,
    // because a stale graph says whatever it said last time — which is the
    // flattering direction, since the boundary was intact then.
    const outputs = buildGraph();
    const recorded = Object.keys(outputs)
      .filter(file => file.endsWith(".mjs"))
      .sort();
    const onDisk = readdirSync(DIST)
      .filter(file => file.endsWith(".mjs"))
      .map(emitted)
      .sort();

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded).toEqual(onDisk);

    const writtenAt = statSync(METAFILE).mtimeMs;
    for (const file of recorded) {
      expect(statSync(join(PACKAGE, file)).mtimeMs, file).toBeLessThanOrEqual(
        writtenAt
      );
    }
  });

  it("gives the format entry no runtime dependency, deferred ones included", () => {
    // The claim the whole entry point exists for, asked of every edge rather
    // than of the ones initialisation happens to follow.
    const outputs = buildGraph();

    expect(buildExternals(outputs, emitted(FORMAT_ENTRY))).toEqual([]);
  });

  it("CONTROL: the same walk finds the root's dependency", () => {
    // A walk that followed nothing would report an empty external set for every
    // entry point, including one that demonstrably bundles a parser. Matched by
    // package, because the compiler imports `css-tree/parser` and
    // `css-tree/walker` by subpath and an equality check against the bare name
    // finds neither.
    const outputs = buildGraph();
    const packages = buildExternals(outputs, emitted(ROOT_ENTRY)).map(
      specifier => specifier.split("/")[0]
    );

    expect(packages).toContain("css-tree");
  });

  it("stays a small fraction of the package root", () => {
    // A ratio rather than a byte ceiling: the absolute size moves whenever the
    // engine grows, and a fixed number would either fail on unrelated work or
    // be raised until it meant nothing. What must stay true is that this entry
    // costs a small fraction of the root, which is the property consumers rely
    // on.
    const outputs = buildGraph();
    const format = buildBytes(outputs, emitted(FORMAT_ENTRY));
    const root = buildBytes(outputs, emitted(ROOT_ENTRY));

    expect(format).toBeGreaterThan(0);
    expect(root).toBeGreaterThan(format * 10);
  });
});
