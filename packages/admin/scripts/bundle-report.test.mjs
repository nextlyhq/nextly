/**
 * Unit tests for bundle-report.mjs: the measurement contract — every emitted
 * chunk accounted for, classified by the entry's import graph, with refusals
 * for the dists that cannot be measured honestly.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  DECLARED_BROWSER_ENTRIES,
  findJsFiles,
  formatKB,
  formatReport,
  measureBundle,
  parseArgs,
  parseChunkImports,
  readCommit,
} from "./bundle-report.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFixtureDist(files) {
  const dir = mkdtempSync(join(tmpdir(), "nx-bundle-test-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("bundle-report", () => {
  describe("formatKB", () => {
    it("formats byte values to 2 decimal places in KB", () => {
      expect(formatKB(1024)).toBe("1.00");
      expect(formatKB(1536)).toBe("1.50");
      expect(formatKB(0)).toBe("0.00");
    });
  });

  describe("parseChunkImports", () => {
    it("extracts static import and export specifiers", () => {
      const code = `
        import { foo } from "./chunk-a.mjs";
        export * from "./chunk-b.mjs";
        import React from "react";
      `;
      const result = parseChunkImports("test.js", code);
      expect(result.staticImports).toEqual(["./chunk-a.mjs", "./chunk-b.mjs"]);
      expect(result.dynamicImports).toEqual([]);
    });

    it("extracts dynamic import specifiers", () => {
      const code = `
        const Route = React.lazy(() => import("./route-chunk.mjs"));
        import("./another-lazy.mjs");
        import("external-package");
      `;
      const result = parseChunkImports("test.js", code);
      expect(result.staticImports).toEqual([]);
      expect(result.dynamicImports).toEqual([
        "./route-chunk.mjs",
        "./another-lazy.mjs",
      ]);
    });

    it("deduplicates identical imports", () => {
      const code = `
        import { a } from "./shared.mjs";
        import { b } from "./shared.mjs";
        import("./lazy.mjs");
        import("./lazy.mjs");
      `;
      const result = parseChunkImports("test.js", code);
      expect(result.staticImports).toEqual(["./shared.mjs"]);
      expect(result.dynamicImports).toEqual(["./lazy.mjs"]);
    });
  });

  describe("parseArgs", () => {
    it("parses the flags it knows", () => {
      expect(parseArgs([])).toEqual({ json: false, dist: null });
      expect(parseArgs(["--json"])).toEqual({ json: true, dist: null });
      expect(parseArgs(["--dist", "some/dir"])).toEqual({
        json: false,
        dist: "some/dir",
      });
      expect(parseArgs(["--json", "--dist", "d"])).toEqual({
        json: true,
        dist: "d",
      });
    });

    it("refuses a trailing --dist with no value instead of measuring the default", () => {
      expect(() => parseArgs(["--dist"])).toThrow(/--dist requires/);
    });

    it("refuses an unrecognized option instead of ignoring it", () => {
      expect(() => parseArgs(["--jsoon"])).toThrow(/unknown option/);
      expect(() => parseArgs(["out.json"])).toThrow(/unknown option/);
    });
  });

  describe("measureBundle on fixture", () => {
    it("distinguishes first-screen from route-later and CLI chunks using import graphs", () => {
      const dist = createFixtureDist({
        "index.mjs": `
          import { shell } from "./chunk-shell.mjs";
          const LazyRoute = () => import("./chunk-route.mjs");
        `,
        "chunk-shell.mjs": `
          import { util } from "./chunk-shared.mjs";
          export const shell = "shell";
        `,
        "chunk-shared.mjs": `
          export const util = "util";
        `,
        "chunk-route.mjs": `
          import { util } from "./chunk-shared.mjs";
          export default "page";
        `,
        "cli.cjs": `
          console.log("cli tool");
        `,
        "cli.mjs": `
          console.log("cli tool esm");
        `,
      });

      const fixedDate = "2026-10-16T12:00:00.000Z";
      const fixedCommit = "abc1234";

      const report = measureBundle({
        distDir: dist,
        commit: fixedCommit,
        date: fixedDate,
      });

      expect(report.date).toBe(fixedDate);
      expect(report.commit).toBe(fixedCommit);

      // Verify every chunk is accounted for
      expect(report.chunks).toHaveLength(6);
      expect(report.totals.totalEmitted.count).toBe(6);
      expect(report.builtAt).toBeDefined();

      // First-screen: index.mjs, chunk-shell.mjs, chunk-shared.mjs
      const firstScreenFiles = report.categories.firstScreen.chunks.map(
        c => c.rel
      );
      expect(firstScreenFiles).toEqual([
        "chunk-shared.mjs",
        "chunk-shell.mjs",
        "index.mjs",
      ]);
      expect(report.totals.firstScreen.count).toBe(3);

      // Route-later: chunk-route.mjs — reachable from index.mjs, but only
      // through its dynamic import
      const routeLaterFiles = report.categories.routeLater.chunks.map(
        c => c.rel
      );
      expect(routeLaterFiles).toEqual(["chunk-route.mjs"]);
      expect(report.totals.routeLater.count).toBe(1);

      // No independent entrypoints in this fixture: nothing is unreachable
      expect(report.categories.otherEntry.count).toBe(0);

      // CLI: cli.cjs, cli.mjs
      const cliFiles = report.categories.cli.chunks.map(c => c.rel);
      expect(cliFiles).toEqual(["cli.cjs", "cli.mjs"]);
      expect(report.totals.cli.count).toBe(2);

      // Browser totals: firstScreen (3) + routeLater (1) = 4
      expect(report.totals.browser.count).toBe(4);
      expect(report.totals.browser.minifiedBytes).toBe(
        report.totals.firstScreen.minifiedBytes +
          report.totals.routeLater.minifiedBytes
      );

      // Formatted text output
      const text = formatReport(report, { json: false });
      expect(text).toContain("Admin Bundle Size Report");
      expect(text).toContain("Date:    2026-10-16T12:00:00.000Z");
      expect(text).toContain("Commit:  abc1234");
      expect(text).toContain("First-screen chunks (3 chunks");
      expect(text).toContain("Route-later chunks (1 chunks");
      expect(text).toContain("Non-browser chunks (2 chunks");

      // JSON output
      const jsonStr = formatReport(report, { json: true });
      const parsed = JSON.parse(jsonStr);
      expect(parsed.commit).toBe(fixedCommit);
      expect(parsed.totals.browser.count).toBe(4);
    });

    it("throws when dist directory does not exist", () => {
      expect(() =>
        measureBundle({ distDir: join(tmpdir(), "nonexistent-dist-dir-1234") })
      ).toThrow(/dist directory not found/);
    });

    it("throws when dist directory holds no JS chunks", () => {
      const emptyDir = createFixtureDist({ "other.txt": "hello" });
      expect(() => measureBundle({ distDir: emptyDir })).toThrow(
        /no JS chunks found/
      );
    });

    it("throws when the entry chunk is absent rather than reporting an empty first screen", () => {
      const dist = createFixtureDist({
        "main.mjs": `export const app = "app";`,
        "cli.cjs": `console.log("cli");`,
      });
      expect(() => measureBundle({ distDir: dist })).toThrow(
        /entry chunk index\.mjs not found/
      );
    });

    it("throws when an import edge resolves to a chunk the dist does not hold", () => {
      const dist = createFixtureDist({
        "index.mjs": `import { shell } from "./chunk-gone.mjs";`,
      });
      expect(() => measureBundle({ distDir: dist })).toThrow(
        /import edge resolves to unknown chunk/
      );
    });

    it("classifies a declared independent entrypoint and its exclusive imports as other-entry, a truly unimported chunk as unreachable", () => {
      // lib/plugins/plugin-components.mjs is a separate entry the build
      // declares for a different consumer: reachable from index.mjs by
      // neither edge, so it is not a lazy route and must not pad the
      // route-later subtotal. Its OWN import (chunk-plugin-only.mjs, shared
      // with nothing else) ships for that consumer too, so it is other-entry
      // as well — not an orphan. chunk-devtools.mjs is reachable by nothing
      // at all — retained by the build, loadable by no consumer — and the
      // report must not dress it up as an entrypoint either.
      const dist = createFixtureDist({
        "index.mjs": `
          import { shell } from "./chunk-shell.mjs";
          const LazyRoute = () => import("./chunk-route.mjs");
        `,
        "chunk-shell.mjs": `
          import { util } from "./chunk-shared.mjs";
          export const shell = "shell";
        `,
        "chunk-shared.mjs": `
          export const util = "util";
        `,
        "chunk-route.mjs": `
          import { util } from "./chunk-shared.mjs";
          export default "page";
        `,
        "lib/plugins/plugin-components.mjs": `
          import { util } from "../../chunk-shared.mjs";
          import { extra } from "./chunk-plugin-only.mjs";
          export const components = { util, extra };
        `,
        "lib/plugins/chunk-plugin-only.mjs": `
          export const extra = "extra";
        `,
        "chunk-devtools.mjs": `
          export const devtools = { render() {} };
        `,
        "cli.cjs": `
          console.log("cli tool");
        `,
      });

      const report = measureBundle({ distDir: dist });

      const otherEntryFiles = report.categories.otherEntry.chunks.map(
        c => c.rel
      );
      expect(otherEntryFiles).toEqual([
        "lib/plugins/chunk-plugin-only.mjs",
        "lib/plugins/plugin-components.mjs",
      ]);
      expect(report.totals.otherEntry.count).toBe(2);

      const unreachableFiles = report.categories.unreachable.chunks.map(
        c => c.rel
      );
      expect(unreachableFiles).toEqual(["chunk-devtools.mjs"]);
      expect(report.totals.unreachable.count).toBe(1);

      // The lazy route stays route-later even though the other entry
      // shares its imports.
      expect(
        report.categories.routeLater.chunks.map(c => c.rel)
      ).toEqual(["chunk-route.mjs"]);
      // First-screen is untouched by the other entry.
      expect(report.totals.firstScreen.count).toBe(3);

      // Browser = first-screen + route-later + other entries + unreachable;
      // all five categories reassemble into the emitted total.
      expect(report.totals.browser.count).toBe(7);
      expect(report.totals.totalEmitted.count).toBe(8);
      expect(report.totals.totalEmitted.count).toBe(
        report.totals.firstScreen.count +
          report.totals.routeLater.count +
          report.totals.otherEntry.count +
          report.totals.unreachable.count +
          report.totals.cli.count
      );

      // The CLI build does not minify: the report says so, on the category
      // and per chunk, instead of labelling raw bytes as minified.
      expect(report.categories.cli.minified).toBe(false);
      expect(report.chunks.find(c => c.file === "cli.cjs").minified).toBe(
        false
      );
      expect(
        report.chunks.find(c => c.file === "index.mjs").minified
      ).toBe(true);

      const text = formatReport(report, { json: false });
      expect(text).toContain("Other entry chunks (2 chunks");
      expect(text).toContain("Unreachable chunks (1 chunks");
      expect(text).toContain("raw sizes: the CLI build does not minify");
    });
  });

  describe("measureBundle on actual admin build dist", () => {
    // The suite's 10s ceiling is right for the jsdom component tests around
    // this one; this test digests the whole real dist — gzipping 87 chunks,
    // index.mjs alone is ~900 KB — and under the suite's parallel workers
    // that work measured 11s+ where it takes ~3s alone. The override bounds
    // the real work, it does not hide a hang.
    it(
      "measures the real built package and verifies all accounting invariants",
      { timeout: 60_000 },
      () => {
        const distDir = join(PACKAGE_ROOT, "dist");
        const report = measureBundle({ distDir });

        expect(report.commit).toBeDefined();
        expect(report.date).toBeDefined();
        expect(report.builtAt).toBeDefined();

        // The dist measures the COMPLETE package: every entrypoint the
        // exports map declares was emitted. A partial dist (an interrupted
        // build, say) would otherwise pass on whatever fragments it holds.
        const reportedFiles = new Set(report.chunks.map(c => c.file));
        for (const entry of DECLARED_BROWSER_ENTRIES) {
          expect(reportedFiles).toContain(entry);
        }

        // Invariant 1: Total emitted chunks equals first-screen + route-later
        // + other entries + unreachable + cli
        const {
          firstScreen,
          routeLater,
          otherEntry,
          unreachable,
          cli,
          totalEmitted,
          browser,
        } = report.totals;
        expect(totalEmitted.count).toBe(
          firstScreen.count +
            routeLater.count +
            otherEntry.count +
            unreachable.count +
            cli.count
        );
        expect(totalEmitted.minifiedBytes).toBe(
          firstScreen.minifiedBytes +
            routeLater.minifiedBytes +
            otherEntry.minifiedBytes +
            unreachable.minifiedBytes +
            cli.minifiedBytes
        );
        expect(browser.count).toBe(
          firstScreen.count +
            routeLater.count +
            otherEntry.count +
            unreachable.count
        );
        expect(browser.minifiedBytes).toBe(
          firstScreen.minifiedBytes +
            routeLater.minifiedBytes +
            otherEntry.minifiedBytes +
            unreachable.minifiedBytes
        );

        // Invariant 2: index.mjs must be in first-screen
        const firstScreenFiles = report.categories.firstScreen.chunks.map(
          c => c.rel
        );
        expect(firstScreenFiles).toContain("index.mjs");

        // Invariant 3: CLI files must not be in browser categories
        expect(firstScreenFiles).not.toContain("cli.cjs");
        expect(firstScreenFiles).not.toContain("cli.mjs");

        // Invariant 4: Every chunk has valid minified and gzipped sizes.
        // Gzip carries a small fixed container overhead — header, trailer,
        // block header — so a chunk of a few dozen bytes can gzip slightly
        // larger than it ships (seen at +4 bytes on a 109-byte chunk); past
        // that overhead, gzip never inflates a chunk.
        for (const chunk of report.chunks) {
          expect(chunk.minifiedBytes).toBeGreaterThan(0);
          expect(chunk.gzippedBytes).toBeGreaterThan(0);
          expect(chunk.gzippedBytes).toBeLessThanOrEqual(
            chunk.minifiedBytes + 64
          );
        }
      }
    );
  });
});
