/**
 * Which packages the playground's server keeps external, and whether each
 * resolves from the playground to the copy its workspace packages load. The
 * real playground is checked by the CI job; these cases pin the derivation
 * and the comparison on folders built for them.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bundledExternals,
  externalPackages,
  loadedWorkspace,
  packageDirFrom,
  parseNextExternals,
  runtimeDependencies,
} from "./check-playground-externals.mjs";

const made = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A package's folder, with a manifest so a lookup finds it. */
function pkgAt(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  return dir;
}

/**
 * A workspace laid out as pnpm lays one out: an app and a library, each with
 * its own `node_modules`, linking packages into a store.
 */
function workspace() {
  const top = mkdtempSync(join(tmpdir(), "playground-externals-"));
  made.push(top);
  const app = join(top, "apps/app");
  const lib = join(top, "packages/lib");
  pkgAt(app, "app");
  pkgAt(lib, "lib");
  const store = name => pkgAt(join(top, "store", name), name.split("@")[0]);
  const link = (from, name, target) => {
    mkdirSync(join(from, "node_modules"), { recursive: true });
    symlinkSync(target, join(from, "node_modules", name));
  };
  return { app, lib, store, link };
}

describe("which copy of a package the playground and its workspace load", () => {
  it("reads two links to one store copy as one copy", () => {
    const w = workspace();
    const copy = w.store("esbuild@1");
    w.link(w.app, "esbuild", copy);
    w.link(w.lib, "esbuild", copy);
    expect(packageDirFrom(w.app, "esbuild")).toBe(
      packageDirFrom(w.lib, "esbuild")
    );
  });

  it("finds nothing for a package installed nowhere the app looks", () => {
    const w = workspace();
    expect(packageDirFrom(w.app, "esbuild")).toBeNull();
  });
});

describe("which externals the playground would bundle", () => {
  const loaders = w => [{ name: "lib", dir: w.lib, declares: ["esbuild"] }];

  it("none, when the playground has the copy the library loads", () => {
    const w = workspace();
    const copy = w.store("esbuild@1");
    w.link(w.app, "esbuild", copy);
    w.link(w.lib, "esbuild", copy);
    expect(
      bundledExternals({
        appDir: w.app,
        packages: ["esbuild"],
        loaders: loaders(w),
      })
    ).toEqual([]);
  });

  it("one the playground cannot find", () => {
    const w = workspace();
    w.link(w.lib, "esbuild", w.store("esbuild@1"));
    const found = bundledExternals({
      appDir: w.app,
      packages: ["esbuild"],
      loaders: loaders(w),
    });
    expect(found.map(f => f.pkg)).toEqual(["esbuild"]);
    expect(found[0].reason).toContain("cannot be found");
  });

  it("one the playground finds as another copy than the library's, naming the library", () => {
    const w = workspace();
    w.link(w.app, "esbuild", w.store("esbuild@2"));
    w.link(w.lib, "esbuild", w.store("esbuild@1"));
    const found = bundledExternals({
      appDir: w.app,
      packages: ["esbuild"],
      loaders: loaders(w),
    });
    expect(found.map(f => f.pkg)).toEqual(["esbuild"]);
    expect(found[0].reason).toContain("from lib");
  });

  it("not one no bundled package declares, whatever copy it would find", () => {
    const w = workspace();
    w.link(w.app, "esbuild", w.store("esbuild@2"));
    w.link(w.lib, "esbuild", w.store("esbuild@1"));
    expect(
      bundledExternals({
        appDir: w.app,
        packages: ["esbuild"],
        loaders: [{ name: "lib", dir: w.lib, declares: [] }],
      })
    ).toEqual([]);
  });

  it("not a listed external nothing bundled declares, though the playground cannot find it", () => {
    // A stale entry of serverExternalPackages: no importer, nothing to bundle.
    const w = workspace();
    expect(
      bundledExternals({
        appDir: w.app,
        packages: ["bundle-require"],
        loaders: loaders(w),
      })
    ).toEqual([]);
  });
});

describe("which workspace packages webpack bundles into the playground", () => {
  const pkg = (name, deps) => ({
    dir: `/w/${name}`,
    manifest: { name, dependencies: deps },
  });
  const ws = new Map([
    ["nextly", pkg("nextly", { "@x/adapter": "workspace:*", zod: "1" })],
    ["@x/adapter", pkg("@x/adapter", { "@x/base": "workspace:*", pg: "8" })],
    ["@x/base", pkg("@x/base", { "drizzle-orm": "1" })],
    ["unused", pkg("unused", {})],
  ]);
  const app = { dependencies: { nextly: "workspace:*" } };

  it("follows workspace dependencies through each other, and stops at outside ones", () => {
    const loaded = loadedWorkspace(app, ws, []);
    expect(loaded.map(l => l.name).sort()).toEqual([
      "@x/adapter",
      "@x/base",
      "nextly",
    ]);
    expect(loaded.find(l => l.name === "@x/adapter").declares).toEqual([
      "@x/base",
      "pg",
    ]);
  });

  it("leaves out an external one, and what is reached only through it", () => {
    // webpack never reads inside an external package, so its imports cannot
    // be bundled whatever copy they find.
    const loaded = loadedWorkspace(app, ws, ["@x/adapter"]);
    expect(loaded.map(l => l.name)).toEqual(["nextly"]);
  });
});

describe("which packages the playground keeps external", () => {
  it("takes the playground's own list for the configuration", () => {
    expect(
      externalPackages({
        configured: ["pg", "drizzle-kit", "pg"],
        nextExternals: [],
        nextlyRuntime: [],
      })
    ).toEqual(["drizzle-kit", "pg"]);
  });

  it("adds the packages on Next's own list that nextly depends on, and only those", () => {
    expect(
      externalPackages({
        configured: ["pg"],
        nextExternals: ["sharp", "zeromq"],
        nextlyRuntime: ["sharp", "zod"],
      })
    ).toEqual(["pg", "sharp"]);
  });

  it("reads Next's list past its comments", () => {
    const text = `[\n  // Native Node.js addons\n  "sharp",\n  // generated at build time\n  "@prisma/client",\n]`;
    expect(parseNextExternals(text)).toEqual(["sharp", "@prisma/client"]);
  });

  it("counts every package a manifest may load: dependencies, optional and peer", () => {
    expect(
      runtimeDependencies({
        dependencies: { zod: "1" },
        optionalDependencies: { "better-sqlite3": "1" },
        peerDependencies: { nodemailer: "1" },
      })
    ).toEqual(["zod", "better-sqlite3", "nodemailer"]);
  });
});
