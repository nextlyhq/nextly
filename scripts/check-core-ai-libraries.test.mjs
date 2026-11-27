/**
 * The check that keeps AI and MCP libraries out of core's dependency tree:
 * it must find one planted directly or deep in the tree and name the path,
 * pass the repository as it is, and fail rather than pass over a tree it
 * cannot read.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkInstalled,
  checkLockfile,
  describeFinding,
  findInstalledAILibraries,
  isAILibrary,
  readLockfile,
  walkCoreTree,
} from "./check-core-ai-libraries.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const realLockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");

/**
 * A small lockfile in pnpm's shape: a toolchain document first, then the
 * project's, with a workspace link, a peer-suffixed key, a quoted scoped
 * name and an alias.
 */
const FIXTURE = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.5.1
        version: 12.5.1

packages:

  pnpm@12.5.1:
    resolution: {integrity: sha512-x}

snapshots:

  pnpm@12.5.1: {}

---
lockfileVersion: '9.0'

importers:

  packages/nextly:
    dependencies:
      '@nextlyhq/adapter':
        specifier: workspace:*
        version: link:../adapter
      wrapper:
        specifier: ^1.0.0
        version: 1.0.0(peer@2.0.0)
    devDependencies:
      vitest:
        specifier: ^5.0.0
        version: 5.0.0

  packages/adapter:
    dependencies:
      'helper':
        specifier: ^3.0.0
        version: 3.0.0
    devDependencies:
      langchain:
        specifier: ^1.0.0
        version: 1.0.0

  packages/admin: {}

  packages/plugin-sdk: {}

  packages/plugin-mcp:
    dependencies:
      '@modelcontextprotocol/server':
        specifier: ^2.4.0
        version: 2.4.0

packages:

  wrapper@1.0.0:
    resolution: {integrity: sha512-a}

snapshots:

  '@modelcontextprotocol/server@2.4.0': {}

  helper@3.0.0:
    dependencies:
      renamed: real-name@4.0.0

  langchain@1.0.0: {}

  peer@2.0.0: {}

  real-name@4.0.0: {}

  vitest@5.0.0: {}

  wrapper@1.0.0(peer@2.0.0):
    dependencies:
      peer: 2.0.0
    optionalDependencies:
      tiny: 0.1.0

  tiny@0.1.0: {}
`;

/** `text` with `line` added under the first line that ends with `after`. */
function plant(text, after, line) {
  const at = text.indexOf(after);
  if (at === -1) throw new Error(`no ${after} to plant under`);
  const end = text.indexOf("\n", at + after.length - 1);
  return `${text.slice(0, end + 1)}${line}\n${text.slice(end + 1)}`;
}

const nextly = ["packages/nextly"];

describe("the AI library list", () => {
  it("names the libraries and the scopes, and nothing that only looks like them", () => {
    for (const name of [
      "ai",
      "@ai-sdk/openai",
      "@modelcontextprotocol/sdk",
      "openai",
      "@anthropic-ai/sdk",
      "@langchain/core",
      "langchain",
    ]) {
      expect(isAILibrary(name), name).toBe(true);
    }
    for (const name of [
      "aim",
      "zod",
      "@aws-sdk/client-s3",
      "openapi-types",
      "air",
    ]) {
      expect(isAILibrary(name), name).toBe(false);
    }
  });
});

describe("the lockfile's resolved tree", () => {
  it("reads the project's document, not the toolchain's", () => {
    const lock = readLockfile(FIXTURE);
    expect([...lock.importers.keys()]).toEqual([
      "packages/nextly",
      "packages/adapter",
      "packages/admin",
      "packages/plugin-sdk",
      "packages/plugin-mcp",
    ]);
    expect(
      lock.snapshots.get("wrapper@1.0.0(peer@2.0.0)")?.dependencies
    ).toEqual(
      new Map([
        ["peer", "2.0.0"],
        ["tiny", "0.1.0"],
      ])
    );
  });

  it("walks links, peer-suffixed keys, aliases and optional dependencies, and finds nothing in a clean tree", () => {
    const tree = walkCoreTree(readLockfile(FIXTURE), nextly);
    expect(tree.libraries).toEqual([]);
    expect(tree.unresolved).toEqual([]);
    // nextly, the adapter, wrapper, vitest, helper, peer, tiny, real-name.
    expect(tree.reached).toBe(8);
  });

  it("counts a core package's own development dependencies, not those of what it links", () => {
    // `langchain` is the adapter's development dependency: it ships with nothing.
    expect(walkCoreTree(readLockfile(FIXTURE), nextly).libraries).toEqual([]);
    // Into nextly's own development dependencies, the first such group.
    const devPlanted = FIXTURE.replace(
      "    devDependencies:\n      vitest:",
      "    devDependencies:\n      langchain:\n        specifier: ^1.0.0\n        version: 1.0.0\n      vitest:"
    );
    expect(
      walkCoreTree(readLockfile(devPlanted), nextly).libraries.map(
        describeFinding
      )
    ).toEqual(["langchain: packages/nextly > langchain@1.0.0"]);
  });

  it("names a library planted deep in the tree, with the path through a link and an alias", () => {
    const planted = FIXTURE.replace(
      "  real-name@4.0.0: {}",
      "  real-name@4.0.0:\n    dependencies:\n      '@ai-sdk/openai': 1.2.3\n\n  '@ai-sdk/openai@1.2.3': {}"
    );
    expect(
      walkCoreTree(readLockfile(planted), nextly).libraries.map(describeFinding)
    ).toEqual([
      "@ai-sdk/openai: packages/nextly > packages/adapter > helper@3.0.0 > real-name@4.0.0 > @ai-sdk/openai@1.2.3",
    ]);
  });

  it("finds the MCP library in an opt-in package, which may hold it", () => {
    expect(
      walkCoreTree(readLockfile(FIXTURE), [
        "packages/plugin-mcp",
      ]).libraries.map(f => f.library)
    ).toEqual(["@modelcontextprotocol/server"]);
  });

  it("reports what the tree points at but the lockfile does not hold", () => {
    const broken = FIXTURE.replace("  tiny@0.1.0: {}\n", "");
    expect(walkCoreTree(readLockfile(broken), nextly).unresolved).toEqual([
      {
        entry: "tiny@0.1.0",
        path: ["packages/nextly", "wrapper@1.0.0(peer@2.0.0)", "tiny@0.1.0"],
      },
    ]);
  });
});

describe("this repository's lockfile", () => {
  const lock = readLockfile(realLockfile);

  it("holds no AI or MCP library in core's tree, and the walk reaches it all", () => {
    const tree = walkCoreTree(lock);
    expect(tree.libraries).toEqual([]);
    expect(tree.unresolved).toEqual([]);
    // Core's packages reach hundreds of packages; a walk that stopped at the
    // first level would reach a few dozen.
    expect(tree.reached).toBeGreaterThan(300);
  });

  it("finds the MCP SDK the MCP plugin holds, so the walk would see one in core", () => {
    expect(
      walkCoreTree(lock, ["packages/plugin-mcp"]).libraries.length
    ).toBeGreaterThan(0);
  });

  it("names a library planted as a direct dependency of nextly", () => {
    const planted = plant(
      realLockfile,
      "  packages/nextly:\n    dependencies:",
      "      ai:\n        specifier: ^5.0.0\n        version: 5.0.0"
    ).replace("\nsnapshots:\n", "\nsnapshots:\n\n  ai@5.0.0: {}\n");
    expect(
      walkCoreTree(readLockfile(planted)).libraries.map(describeFinding)
    ).toEqual(["ai: packages/nextly > ai@5.0.0"]);
  });

  it("names a library planted under something nextly depends on, with the path", () => {
    // A package nextly depends on that depends on nothing itself, so the
    // plant is the only thing under it.
    const nextlyDeps = lock.importers
      .get("packages/nextly")
      ?.groups.get("dependencies");
    const key = [...(nextlyDeps ?? [])]
      .filter(([, version]) => !version.startsWith("link:"))
      .map(([name, version]) => `${name}@${version}`)
      .find(k => lock.snapshots.get(k)?.dependencies.size === 0);
    if (key === undefined)
      throw new Error("no leaf dependency of nextly to plant under");
    const quoted =
      /^[a-z0-9]/.test(key) && !key.includes("(") ? key : `'${key}'`;
    const header = `\n  ${quoted}: {}\n`;
    expect(realLockfile.includes(header)).toBe(true);
    const planted = realLockfile
      .replace(
        header,
        `\n  ${quoted}:\n    dependencies:\n      openai: 4.0.0\n`
      )
      .replace("\nsnapshots:\n", "\nsnapshots:\n\n  openai@4.0.0: {}\n");
    expect(
      walkCoreTree(readLockfile(planted)).libraries.map(describeFinding)
    ).toContain(`openai: packages/nextly > ${key} > openai@4.0.0`);
  });

  it("passes as a command on this repository", () => {
    const out = execFileSync(
      process.execPath,
      [join(root, "scripts/check-core-ai-libraries.mjs")],
      { encoding: "utf8", cwd: root }
    );
    expect(out).toMatch(/none among the \d+ packages/);
  });
});

describe("installed modules", () => {
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function project(dirs) {
    const dir = mkdtempSync(join(tmpdir(), "core-ai-libraries-"));
    made.push(dir);
    for (const each of dirs)
      mkdirSync(join(dir, "node_modules", each), { recursive: true });
    return join(dir, "node_modules");
  }

  it("finds a library installed at the top, nested, scoped or in pnpm's store", () => {
    const modules = project([
      "zod",
      "openai",
      "nextly/node_modules/ai",
      "@ai-sdk/openai",
      ".pnpm/x@1.0.0/node_modules/@modelcontextprotocol/sdk",
    ]);
    expect(
      findInstalledAILibraries(modules)
        .map(f => f.library)
        .sort()
    ).toEqual(["@ai-sdk/openai", "@modelcontextprotocol/sdk", "ai", "openai"]);
  });

  it("finds none in a project without them", () => {
    expect(
      findInstalledAILibraries(project(["zod", "nextly/node_modules/react"]))
    ).toEqual([]);
  });
});

describe("the two checks, as the command runs them", () => {
  const made = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of made.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function quiet() {
    const errors = [];
    vi.spyOn(console, "error").mockImplementation(
      line => void errors.push(String(line))
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    return errors;
  }

  function lockfileWith(text) {
    const dir = mkdtempSync(join(tmpdir(), "core-ai-lockfile-"));
    made.push(dir);
    const file = join(dir, "pnpm-lock.yaml");
    writeFileSync(file, text);
    return file;
  }

  it("fails on a lockfile with a planted library, naming it and its path", () => {
    const errors = quiet();
    const planted = FIXTURE.replace(
      "  real-name@4.0.0: {}",
      "  real-name@4.0.0:\n    dependencies:\n      openai: 4.0.0\n\n  openai@4.0.0: {}"
    );
    expect(checkLockfile(lockfileWith(planted))).toBe(1);
    expect(errors.join("\n")).toContain(
      "openai: packages/nextly > packages/adapter > helper@3.0.0 > real-name@4.0.0 > openai@4.0.0"
    );
  });

  it("fails on a tree it cannot read, rather than passing over it", () => {
    const errors = quiet();
    expect(
      checkLockfile(lockfileWith(FIXTURE.replace("  tiny@0.1.0: {}\n", "")))
    ).toBe(1);
    expect(errors.join("\n")).toContain("tiny@0.1.0");
  });

  it("fails when there is nothing to read", () => {
    quiet();
    expect(checkLockfile(join(tmpdir(), "no-such-lockfile.yaml"))).toBe(1);
    expect(checkLockfile(undefined)).toBe(1);
    expect(checkInstalled(join(tmpdir(), "no-such-node-modules"))).toBe(1);
    expect(checkInstalled(undefined)).toBe(1);
  });

  it("passes a clean lockfile and clean installed modules, and fails installed ones holding a library", () => {
    const errors = quiet();
    expect(checkLockfile(lockfileWith(FIXTURE))).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "core-ai-installed-"));
    made.push(dir);
    mkdirSync(join(dir, "node_modules", "zod"), { recursive: true });
    expect(checkInstalled(join(dir, "node_modules"))).toBe(0);
    mkdirSync(join(dir, "node_modules", "@ai-sdk", "openai"), {
      recursive: true,
    });
    expect(checkInstalled(join(dir, "node_modules"))).toBe(1);
    expect(errors.join("\n")).toContain("@ai-sdk/openai");
  });
});
