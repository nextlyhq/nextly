import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
 * So the question is put to the module resolver instead, in the two forms that
 * cannot be under-read:
 *
 * - the entry is imported from a directory with NO `node_modules` above it, so
 *   anything reaching a runtime dependency fails to resolve. Complete by
 *   construction rather than a pattern to keep extending.
 * - the entry is imported again under a resolution hook, which reports every
 *   specifier Node actually resolved. That is the module graph itself, not a
 *   reading of what the text appears to say.
 *
 * @module format-boundary.test
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
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

let sandbox = "";
let hooks = "";
let record = "";

beforeAll(() => {
  // OUTSIDE the workspace, which is the whole point: a copy under the package
  // would find the workspace's `node_modules` by the ordinary upward lookup and
  // resolve every runtime dependency exactly as the real build does.
  sandbox = mkdtempSync(join(tmpdir(), "nextly-format-boundary-"));
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
    }
  );

  const resolved = !instrumented
    ? []
    : readFileSync(record, "utf8")
        .split("\n")
        .filter(line => line !== "")
        .map(line => JSON.parse(line) as { specifier: string; url: string });

  return { ok: result.status === 0, stderr: result.stderr ?? "", resolved };
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
    const reachable = lookupChain(sandbox).filter(existsSync);
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

describe("what the format entry point actually loads", () => {
  it("resolves no runtime dependency", () => {
    // The same claim asked a second way, in a place where dependencies ARE
    // resolvable. The isolated import proves nothing external could load; this
    // proves nothing external was even asked for, which is what would still
    // hold if the sandbox ever stopped being isolated.
    const run = runEntry(DIST, FORMAT_ENTRY, { instrumented: true });

    expect(run.ok, run.stderr).toBe(true);
    expect(externals(run)).toEqual([]);
  });

  it("CONTROL: the same instrument sees the root's dependency", () => {
    // A hook that recorded nothing would report an empty external set for every
    // entry point, including one that demonstrably pulls a parser. Matched by
    // package rather than by exact specifier: the compiler imports
    // `css-tree/parser` and `css-tree/walker` by subpath, so an equality check
    // against the bare name finds nothing and the control passes for the wrong
    // reason.
    const run = runEntry(DIST, ROOT_ENTRY, { instrumented: true });

    expect(run.ok, run.stderr).toBe(true);
    expect(externals(run).map(specifier => specifier.split("/")[0])).toContain(
      "css-tree"
    );
  });

  it("stays a small fraction of the package root", () => {
    // A ratio rather than a byte ceiling: the absolute size moves whenever the
    // engine grows, and a fixed number would either fail on unrelated work or
    // be raised until it meant nothing. What must stay true is that this entry
    // costs a small fraction of the root, which is the property consumers rely
    // on.
    //
    // Measured over the files the resolver REPORTED loading, so the two sides
    // are the graphs Node built rather than two readings of the text.
    const format = bytesOf(
      runEntry(DIST, FORMAT_ENTRY, { instrumented: true })
    );
    const root = bytesOf(runEntry(DIST, ROOT_ENTRY, { instrumented: true }));

    expect(format).toBeGreaterThan(0);
    expect(root).toBeGreaterThan(format * 10);
  });
});
