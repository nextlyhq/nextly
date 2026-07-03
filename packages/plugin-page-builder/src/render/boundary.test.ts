import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The `./render` entry is the import-safe, server-first surface (spec §10/§16). It must
 * never pull the CMS runtime (`getNextly`) or the admin bundle, and `"use client"` may
 * appear ONLY in ErrorBoundary (the single intentional client island). This guard fails
 * the build if a future edit leaks a client/admin/runtime import into the renderer.
 */
const RENDER_DIR = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(RENDER_DIR);

/** Strip block + line comments so documentation ("NO getNextly") isn't a false match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("render entry stays server-first + import-safe", () => {
  it("finds the render sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports no CMS runtime (getNextly / nextly) or admin bundle", () => {
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      expect(code, f).not.toMatch(/from ["']nextly["']/);
      expect(code, f).not.toMatch(/\bgetNextly\b/);
      expect(code, f).not.toMatch(/from ["']@nextlyhq\/admin["']/);
      expect(code, f).not.toMatch(/from ["']\.\.\/admin/);
    }
  });

  it("uses the 'use client' directive only in ErrorBoundary", () => {
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      // Match the actual directive (its own statement), not prose.
      if (/^\s*["']use client["'];?\s*$/m.test(code)) {
        expect(f).toContain("ErrorBoundary");
      }
    }
  });
});
