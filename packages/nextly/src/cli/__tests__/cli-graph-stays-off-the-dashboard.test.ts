/**
 * The CLI's commands load neither the service registry, the core widgets nor
 * the dashboard defaults when they are imported.
 *
 * A command's test that reaches any of them loads more than a thousand modules,
 * and the module budget counts those files. It has broken that way twice: a
 * command imported a widget id, which brought `core-widgets/index.ts` and every
 * widget with it, and seven CLI and codegen tests turned heavy together. The
 * budget then names the heavy FILES; this names the EDGE, at the commit that
 * adds it, so the fix is the import rather than a hunt through the graph.
 *
 * A static walk over the source, through the repository's one reader of what a
 * file loads, with no module evaluated, so this test is light itself. It
 * follows what a file loads with it: type-only references erase, and an
 * `import()` loads only when it runs, which is how the commands boot nextly
 * when they need it.
 *
 * @module cli/__tests__/cli-graph-stays-off-the-dashboard.test
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { moduleSpecifierRefs } from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

/** A module a file loads, resolved, and whether it loads only when it runs. */
interface Edge {
  target: string;
  dynamic: boolean;
}

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
    if (ref.typeOnly || !ref.specifier.startsWith(".")) continue;
    const base = resolve(dirname(file), ref.specifier.replace(/\.js$/, ""));
    const target = [".ts", ".tsx", "/index.ts"]
      .map(ext => `${base}${ext}`)
      .find(existsSync);
    if (target !== undefined) edges.push({ target, dynamic: ref.dynamic });
  }
  edgeCache.set(file, edges);
  return edges;
}

/**
 * Every module `entry` loads, mapped to the module that imported it, so a
 * reached module can be traced back to the entry. With `lazy`, an `import()` is
 * followed too.
 */
function loads(entry: string, lazy = false): Map<string, string | null> {
  const from = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const { target, dynamic } of edgesOf(file)) {
      if ((dynamic && !lazy) || from.has(target)) continue;
      from.set(target, file);
      queue.push(target);
    }
  }
  return from;
}

/** The import chain from the walk's entry to `module`. */
function chainTo(walk: Map<string, string | null>, module: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = module; at; at = walk.get(at)) {
    chain.unshift(fromSrc(at));
  }
  return chain.join(" > ");
}

/** The command modules: every source file in `cli/commands`, tests aside. */
const commandFiles = readdirSync(COMMANDS)
  .filter(name => /\.tsx?$/.test(name) && !/\.test(-d)?\.tsx?$/.test(name))
  .map(name => join(COMMANDS, name));

describe("the CLI's commands", () => {
  it("load none of the service registry, core widgets or dashboard defaults", () => {
    const reached = commandFiles.flatMap(command => {
      const walk = loads(command);
      return OFF_LIMITS.map(module => join(SRC, module))
        .filter(module => walk.has(module))
        .map(module => chainTo(walk, module));
    });
    expect(reached).toEqual([]);
  });

  it("are all read, and the walk goes past their own files", () => {
    // Without this the assertion above passes as well for a walk that read
    // nothing: an empty folder, or every import resolved to nothing.
    expect(commandFiles.length).toBeGreaterThan(20);
    const migrate = loads(join(COMMANDS, "migrate.ts"));
    expect(migrate.size).toBeGreaterThan(20);
  });

  it("is the control: the walk finds each module where a static edge does reach it", () => {
    // The same walk from the files that do import them, so a module renamed
    // away, or a resolver that misses its path, fails here rather than
    // making the first case pass by finding nothing.
    expect(
      loads(join(SRC, "di/registrations/register-widgets.ts")).has(
        join(SRC, "domains/widgets/core-widgets/index.ts")
      )
    ).toBe(true);
    expect(
      loads(join(SRC, "di/registrations/register-widgets.ts")).has(
        join(SRC, "domains/widgets/default-layout.ts")
      )
    ).toBe(true);
    // And the lazy edges are why the first case holds: followed, they reach
    // the registry from a command.
    expect(
      loads(join(COMMANDS, "plugin-lifecycle-runner.ts"), true).has(
        join(SRC, "di/register.ts")
      )
    ).toBe(true);
  });
});
