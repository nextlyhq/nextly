/**
 * The dev CSS build's variant-confinement report.
 *
 * The release build fails on an unconfined dark/group/peer reference; this
 * build only reports one, because killing a watcher mid-session costs more
 * than the warning. That report is the dev loop's only signal, so it has to
 * name what the pipeline left unconfined rather than pass silently — pinned
 * here over a sheet chosen to contain one, since the real sheet (confined a
 * line earlier in the same pipeline) contains none.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCssFast } from "./build-css-fast.mjs";

const tmpDirs = [];

function tmpOutput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-css-fast-"));
  tmpDirs.push(dir);
  return path.join(dir, "globals.css");
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true });
});

/**
 * A sheet with both shapes the report has to tell apart: a `:where(.dark …)`
 * variant reference, which confineVariantClasses rewrites under the scope, and
 * a bare `.dark` ancestor compound, which it does not — the release gate fails
 * on the second, so the report has to carry it.
 */
const UNCONFINED_SHEET = [
  ".nextly-admin .dark\\:border-border:where(.dark, .dark *){border-color:red}",
  ".dark .nextly-admin .card{color:red}",
].join("\n");

describe("the dev CSS build's variant report", () => {
  it("confines what the pipeline confines and reports the rest by name", async () => {
    const out = tmpOutput();
    const report = await buildCssFast({
      inputCss: UNCONFINED_SHEET,
      outputFile: out,
    });

    // The where-shaped reference was rewritten, not reported.
    expect(report.unconfinedVariants).toEqual([".dark .nextly-admin .card"]);
    const built = fs.readFileSync(out, "utf-8");
    expect(built).not.toContain(":where(.dark, .dark *)");
    expect(report.unscoped).toEqual([]);
  });

  it("reports none for the real sheet", async () => {
    // The real entry is the sheet the release build ships; after confinement
    // it holds no reference an outside element can satisfy. (The dev sheet's
    // `unscoped` report is a separate, pre-existing matter: the in-process
    // compile formats some base rules in shapes the line-based scoper leaves
    // alone, which is why only the variant report is asserted here.)
    const report = await buildCssFast({ outputFile: tmpOutput() });
    expect(report.unconfinedVariants).toEqual([]);
  });
});
