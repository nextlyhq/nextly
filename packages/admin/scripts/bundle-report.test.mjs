/**
 * Unit tests for bundle-report.mjs (specs/admin-bundle/spec.md R-1).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  findJsFiles,
  formatKB,
  formatReport,
  measureBundle,
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

      // Route-later: chunk-route.mjs
      const routeLaterFiles = report.categories.routeLater.chunks.map(
        c => c.rel
      );
      expect(routeLaterFiles).toEqual(["chunk-route.mjs"]);
      expect(report.totals.routeLater.count).toBe(1);

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

        // Invariant 1: Total emitted chunks equals first-screen + route-later + cli
        const { firstScreen, routeLater, cli, totalEmitted, browser } =
          report.totals;
        expect(totalEmitted.count).toBe(
          firstScreen.count + routeLater.count + cli.count
        );
        expect(totalEmitted.minifiedBytes).toBe(
          firstScreen.minifiedBytes +
            routeLater.minifiedBytes +
            cli.minifiedBytes
        );
        expect(browser.count).toBe(firstScreen.count + routeLater.count);
        expect(browser.minifiedBytes).toBe(
          firstScreen.minifiedBytes + routeLater.minifiedBytes
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
