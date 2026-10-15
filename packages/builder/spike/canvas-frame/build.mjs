#!/usr/bin/env node
// fallow-ignore-file -- a throwaway spike on a branch that never merges;
// it is run by hand (`node build.mjs`) and deleted with its branch.
/**
 * SPIKE, throwaway: bundle the canvas-frame harness into `out/`.
 *
 * Workspace packages are aliased to their SOURCE so no package build is
 * needed, and `lexical` resolves from the admin package, as it does in the
 * admin bundle. The metafile is then read to count how many copies of Lexical
 * the bundle holds: the editor must stay the admin's single copy.
 */

import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* global console, process */

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const pkgs = join(repo, "packages");

// esbuild is tsup's own dependency; resolved through it rather than added.
const fromTsup = createRequire(
  createRequire(join(pkgs, "builder/package.json")).resolve("tsup")
);
const esbuild = fromTsup("esbuild");

// Outside the repository: a 13MB bundle has no business in the package tree.
const out = join(tmpdir(), "canvas-frame-spike", "out");
mkdirSync(out, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(here, "harness.tsx")],
  bundle: true,
  format: "esm",
  outfile: join(out, "harness.js"),
  sourcemap: "inline",
  metafile: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  alias: {
    "@admin": join(pkgs, "admin/src"),
    "@nextlyhq/blocks-engine": join(pkgs, "blocks-engine/src/index.ts"),
    "@nextlyhq/blocks-react": join(pkgs, "blocks-react/src/index.ts"),
    "@nextlyhq/ui": join(pkgs, "ui/src/index.ts"),
  },
  logLevel: "warning",
});

writeFileSync(join(out, "meta.json"), JSON.stringify(result.metafile));
copyFileSync(join(here, "index.html"), join(out, "index.html"));

// Every distinct directory a Lexical module was bundled from is one copy.
const copies = new Set(
  Object.keys(result.metafile.inputs)
    .map(path => path.match(/^(.*\/node_modules\/lexical)\//)?.[1])
    .filter(Boolean)
);
const reacts = new Set(
  Object.keys(result.metafile.inputs)
    .map(path => path.match(/^(.*\/node_modules\/react-dom)\//)?.[1])
    .filter(Boolean)
);
console.log(`lexical copies in the bundle: ${copies.size}`);
for (const c of copies) console.log(`  ${c}`);
console.log(`react-dom copies in the bundle: ${reacts.size}`);
if (copies.size !== 1 || reacts.size !== 1) process.exit(1);
