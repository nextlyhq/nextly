// Tests for resolveNextBinary.
// Why tmp-dir fixtures instead of the real playground app: fixtures are
// hermetic (no reliance on dev setup, no pnpm hoisting quirks), reproducible
// on CI, and isolate behaviour under test from real package changes.
// Fixtures simulate a minimal node_modules/next/ install with a bin field
// so we exercise the same createRequire + bin.next resolution the helper
// would use in production.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NextBinaryNotFoundError,
  resolveNextBinary,
} from "./resolve-next-bin.js";

describe("resolveNextBinary", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "nextly-resolve-test-"));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function writeProjectPackageJson(): void {
    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({ name: "fixture-project", version: "0.0.0" })
    );
  }

  function writeFakeNextInstall(
    bin: string | Record<string, string> | undefined,
    binEntryRelative = "dist/bin/next"
  ): void {
    const nextDir = join(fixtureDir, "node_modules", "next");
    mkdirSync(join(nextDir, "dist", "bin"), { recursive: true });
    writeFileSync(
      join(nextDir, "package.json"),
      JSON.stringify({ name: "next", version: "15.0.0", bin })
    );
    // Script body does not matter for resolution tests.
    writeFileSync(
      join(nextDir, binEntryRelative),
      "#!/usr/bin/env node\n// fake next bin for tests\n"
    );
  }

  it("returns an absolute path to next's JS entry when next is installed", () => {
    writeProjectPackageJson();
    writeFakeNextInstall({ next: "dist/bin/next" });

    const result = resolveNextBinary(fixtureDir);

    expect(result).toMatch(/[/\\]next[/\\]dist[/\\]bin[/\\]next$/);
    // Cross-platform absolute-path check (POSIX "/…" or Windows "C:\…").
    expect(result.startsWith("/") || /^[A-Za-z]:[\\/]/.test(result)).toBe(true);
  });

  it("supports a string `bin` field (single-entry form)", () => {
    writeProjectPackageJson();
    writeFakeNextInstall("dist/bin/next");

    const result = resolveNextBinary(fixtureDir);

    expect(result).toMatch(/[/\\]next[/\\]dist[/\\]bin[/\\]next$/);
  });

  // Note: we do not test the "next truly not installed anywhere" path in
  // unit tests because vitest's module resolver falls back to the workspace
  // root's pnpm store, so a bare tmp fixture without node_modules/next still
  // resolves to the hoisted next used by nextly's own dev deps. That case is
  // covered by production smoke tests (nextly dev run against a project
  // without next as a dep will hit the MODULE_NOT_FOUND catch branch in
  // resolveNextBinary and throw NextBinaryNotFoundError). The two tests
  // below exercise the same error class via the bin-field validation
  // branches, which vitest's resolver cannot interfere with because we
  // control next's package.json directly.

  it("throws NextBinaryNotFoundError with actionable message when next's package.json has no bin field", () => {
    writeProjectPackageJson();
    writeFakeNextInstall(undefined);

    expect(() => resolveNextBinary(fixtureDir)).toThrow(
      NextBinaryNotFoundError
    );

    try {
      resolveNextBinary(fixtureDir);
    } catch (err) {
      expect(err).toBeInstanceOf(NextBinaryNotFoundError);
      const msg = (err as Error).message;
      expect(msg).toContain("next");
      expect(msg.toLowerCase()).toMatch(/install|not found|locate/);
    }
  });

  it("throws NextBinaryNotFoundError when bin object lacks a `next` key", () => {
    writeProjectPackageJson();
    writeFakeNextInstall({ somethingElse: "dist/bin/next" });

    expect(() => resolveNextBinary(fixtureDir)).toThrow(
      NextBinaryNotFoundError
    );
  });
});
