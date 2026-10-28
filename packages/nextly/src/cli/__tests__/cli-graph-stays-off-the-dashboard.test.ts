/**
 * The CLI's commands load neither the service registry, the core widgets nor
 * the dashboard defaults when they are imported.
 *
 * A command's test that reaches any of them loads more than a thousand modules,
 * and the module budget counts those files. It has broken that way twice: a
 * command imported a widget id, which brought `core-widgets/index.ts` and every
 * widget with it, and seven CLI and codegen tests turned heavy together. The
 * budget then names the heavy FILES; this names the EDGE, at the commit that
 * adds it, so the fix is the import rather than a hunt through the graph. The
 * budget stays the gate; this is the pointer.
 *
 * A static walk over the source, through the repository's one reader of what a
 * file loads, with no module evaluated, so this test is light itself. It
 * follows what a file loads with it: type-only references erase, and an
 * `import()` loads only when it runs, which is how the commands boot nextly
 * when they need it. Its limit: an `import()` that runs while the module
 * initialises (a top-level `await import()`, or one inside a function called
 * at load) is read as deferred, because telling those apart needs control-flow
 * analysis; the budget catches what that costs.
 *
 * Resolution is the package's own: relative paths, the `paths` in its
 * `tsconfig.json`, and explicit `.ts`/`.js` extensions. A reference it cannot
 * read or resolve fails the walk rather than counting as importing nothing.
 *
 * @module cli/__tests__/cli-graph-stays-off-the-dashboard.test
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  moduleSpecifierRefs,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

import { UNIT_FILE } from "../../__tests__/unit-files";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(PACKAGE, "src");
const COMMANDS = join(SRC, "cli", "commands");

/** What no command may load at once, named from `src`. */
const OFF_LIMITS = [
  "di/register.ts",
  "domains/widgets/core-widgets/index.ts",
  "domains/widgets/default-layout.ts",
];

/** A module under `src`, with `/` on every platform. */
const fromSrc = (file: string): string =>
  relative(SRC, file).split(sep).join("/");

/**
 * The `paths` of the package's `tsconfig.json`, longest prefix first, which is
 * the order TypeScript tries them in.
 */
const PATHS = Object.entries(
  (
    JSON.parse(readFileSync(join(PACKAGE, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths?: Record<string, string[]> };
    }
  ).compilerOptions.paths ?? {}
).sort(([a], [b]) => b.replace("*", "").length - a.replace("*", "").length);

/** The paths a non-relative specifier maps to, or undefined for a package. */
function aliased(specifier: string): string[] | undefined {
  for (const [pattern, targets] of PATHS) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      if (specifier === pattern) return targets.map(t => resolve(PACKAGE, t));
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      const rest = specifier.slice(
        prefix.length,
        specifier.length - suffix.length
      );
      return targets.map(t => resolve(PACKAGE, t.replace("*", rest)));
    }
  }
  return undefined;
}

/** The source file a path names: as written, by extension, or as a folder. */
function sourceFile(base: string): string | undefined {
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base, base.replace(/\.([cm]?)js(x?)$/, ".$1ts$2")]
    : [];
  candidates.push(
    ...[".ts", ".tsx", "/index.ts", "/index.tsx"].map(ext => `${base}${ext}`)
  );
  return candidates.find(file => existsSync(file) && statSync(file).isFile());
}

/** A module a file loads, and whether it loads only when it runs. */
type Edge =
  | { kind: "module"; target: string; dynamic: boolean }
  | { kind: "unread" | "unresolved"; detail: string; dynamic: boolean };

/**
 * Each file's runtime edges, read once: every command's walk crosses the same
 * shared modules, and parsing them per walk made this test slow.
 */
const edgeCache = new Map<string, Edge[]>();

function edgesOf(file: string): Edge[] {
  const cached = edgeCache.get(file);
  if (cached) return cached;
  const edges: Edge[] = [];
  for (const ref of moduleSpecifierRefs(readFileSync(file, "utf8"), file)) {
    if (ref.typeOnly) continue;
    const { specifier, dynamic } = ref;
    if (specifier === UNRESOLVABLE_SPECIFIER) {
      edges.push({ kind: "unread", detail: fromSrc(file), dynamic });
      continue;
    }
    const bases = specifier.startsWith(".")
      ? [resolve(dirname(file), specifier)]
      : aliased(specifier);
    // A package, resolved outside this source tree.
    if (bases === undefined) continue;
    const target = bases.map(sourceFile).find(found => found !== undefined);
    edges.push(
      target === undefined
        ? {
            kind: "unresolved",
            detail: `${fromSrc(file)}: ${specifier}`,
            dynamic,
          }
        : { kind: "module", target, dynamic }
    );
  }
  edgeCache.set(file, edges);
  return edges;
}

interface Walk {
  /** Each module reached, mapped to the module that imported it. */
  from: Map<string, string | null>;
  /** References the walk could not read or resolve. */
  problems: string[];
}

/** What `entry` loads. With `lazy`, an `import()` is followed too. */
function loads(entry: string, lazy = false): Walk {
  const from = new Map<string, string | null>([[entry, null]]);
  const problems: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const edge of edgesOf(file)) {
      if (edge.dynamic && !lazy) continue;
      if (edge.kind !== "module") {
        problems.push(`${edge.kind}: ${edge.detail}`);
        continue;
      }
      if (from.has(edge.target)) continue;
      from.set(edge.target, file);
      queue.push(edge.target);
    }
  }
  return { from, problems: [...new Set(problems)] };
}

/** The import chain from the walk's entry to `module`. */
function chainTo(walk: Walk, module: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = module; at; at = walk.from.get(at)) {
    chain.unshift(fromSrc(at));
  }
  return chain.join(" > ");
}

/** The command modules: every source file in `cli/commands`, tests aside. */
const commandFiles = readdirSync(COMMANDS)
  .filter(name => /\.tsx?$/.test(name))
  .filter(name => !UNIT_FILE.test(name) && !/\.test-d\.tsx?$/.test(name))
  .map(name => join(COMMANDS, name));

describe("the CLI's commands", () => {
  it("load none of the service registry, core widgets or dashboard defaults", () => {
    const reached = commandFiles.flatMap(command => {
      const walk = loads(command);
      return OFF_LIMITS.map(module => join(SRC, module))
        .filter(module => walk.from.has(module))
        .map(module => chainTo(walk, module));
    });
    expect(reached).toEqual([]);
  });

  it("load nothing the walk cannot read or resolve", () => {
    const problems = [
      ...new Set(commandFiles.flatMap(command => loads(command).problems)),
    ];
    expect(problems).toEqual([]);
  });

  it("are all read, and the walk goes past their own files", () => {
    // Without this the assertions above pass as well for a walk that read
    // nothing: an empty folder, or every import resolved to nothing.
    expect(commandFiles.length).toBeGreaterThan(20);
    expect(commandFiles.some(file => UNIT_FILE.test(file))).toBe(false);
    expect(loads(join(COMMANDS, "migrate.ts")).from.size).toBeGreaterThan(20);
  });

  it("is the control: the walk finds each module where a static edge does reach it", () => {
    // The same walk from the files that do import them, so a module renamed
    // away, or a resolver that misses its path, fails here rather than
    // making the first case pass by finding nothing.
    const widgets = loads(join(SRC, "di/registrations/register-widgets.ts"));
    expect(
      widgets.from.has(join(SRC, "domains/widgets/core-widgets/index.ts"))
    ).toBe(true);
    expect(
      widgets.from.has(join(SRC, "domains/widgets/default-layout.ts"))
    ).toBe(true);
    // And the lazy edges are why the first case holds: followed, they reach
    // the registry from a command.
    expect(
      loads(join(COMMANDS, "plugin-lifecycle-runner.ts"), true).from.has(
        join(SRC, "di/register.ts")
      )
    ).toBe(true);
  });

  it("resolves every spelling the package resolves", () => {
    // The package's `@nextly/*` paths and an explicit extension name the same
    // modules a relative path does; a resolver that knew only the last would
    // let either spelling past the first case.
    expect(aliased("@nextly/di/register")?.map(sourceFile)).toContain(
      join(SRC, "di/register.ts")
    );
    expect(sourceFile(join(SRC, "di/register.ts"))).toBe(
      join(SRC, "di/register.ts")
    );
    expect(sourceFile(join(SRC, "di/register.js"))).toBe(
      join(SRC, "di/register.ts")
    );
    expect(aliased("zod")).toBeUndefined();
  });
});
