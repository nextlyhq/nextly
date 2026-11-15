/**
 * Whether a package is installed is read from the app's own layout, as its
 * imports resolve: a `node_modules` on the way up from its root. Node's
 * resolver also reads `NODE_PATH`, which pnpm's bin shims set to the store's
 * hoisted folder for every command they run (`nextly generate:types` and this
 * suite's own runner among them), so a package reachable only through it is
 * one the app's own imports cannot reach, and must read as not installed.
 *
 * `NODE_PATH` is read once, when Node starts, so the case is run in a child
 * process started with it set. The module imports Node's built-ins alone, so
 * the child loads its source directly.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { packageInstalled } from "./installed-package";

// A file URL, not a path: on Windows the ESM loader reads `D:\...` as a URL
// with the scheme `d:` and refuses it.
const SOURCE = new URL("./installed-package.ts", import.meta.url).href;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "nextly-installed-package-"));
  made.push(dir);
  return dir;
}

/** A package `name` with a runtime entry, in `nodeModules`. */
function plant(nodeModules: string, name: string): void {
  const dir = join(nodeModules, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", main: "index.js" })
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
}

/**
 * Asks, in a fresh Node started with `NODE_PATH`, whether Node's resolver
 * finds `name` from the app, and whether `packageInstalled` says it is there.
 */
function askWithNodePath(
  nodePath: string,
  name: string,
  cwd: string
): { resolverFinds: boolean; installed: boolean } {
  const script = [
    `import { createRequire } from "node:module";`,
    `import { packageInstalled } from ${JSON.stringify(SOURCE)};`,
    `const [name, cwd] = process.argv.slice(1);`,
    `let resolverFinds = true;`,
    `try { createRequire(cwd + "/package.json").resolve(name); } catch { resolverFinds = false; }`,
    `console.log(JSON.stringify({ resolverFinds, installed: packageInstalled(name, cwd) }));`,
  ].join("\n");
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "--no-warnings", "-e", script, name, cwd],
    { env: { ...process.env, NODE_PATH: nodePath }, encoding: "utf8" }
  );
  return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
    resolverFinds: boolean;
    installed: boolean;
  };
}

describe("whether a package is installed for an app", () => {
  it("is, in a node_modules in the app's root or a folder above it", () => {
    const root = folder();
    plant(join(root, "node_modules"), "@acme/admin");
    const app = join(root, "apps/site");
    mkdirSync(app, { recursive: true });
    expect(packageInstalled("@acme/admin", root)).toBe(true);
    expect(packageInstalled("@acme/admin", app)).toBe(true);
    expect(packageInstalled("@acme/other", app)).toBe(false);
  });

  it("is not, where only NODE_PATH reaches it", () => {
    const store = folder();
    plant(store, "@acme/admin");
    const app = folder();
    // Node's resolver does find it, so the case reaches what it is about.
    expect(askWithNodePath(store, "@acme/admin", app)).toEqual({
      resolverFinds: true,
      installed: false,
    });
  });

  it("is, in the app's node_modules, whatever NODE_PATH holds", () => {
    const store = folder();
    const app = folder();
    plant(join(app, "node_modules"), "@acme/admin");
    expect(askWithNodePath(store, "@acme/admin", app)).toEqual({
      resolverFinds: true,
      installed: true,
    });
  });
});
