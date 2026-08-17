/**
 * Layering contract for the API Docs plugin.
 *
 * The plugin reaches core ONLY through `@nextlyhq/plugin-sdk` (the stable
 * surface), is framework-agnostic (zero `next`/`react`), and never imports
 * `@nextlyhq/admin` directly. The guard REFUSES a blocklist of known-banned
 * specifier shapes — it rejects every banned package and subpath outright, at
 * the cost of not proving the absence of an unlisted dependency (a true import
 * allowlist would). Comments are stripped before matching so a JSDoc example
 * import is not a false positive. Scans `src/` recursively.
 *
 * @module layering
 * @since alpha
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// `next`, `next/*`, `react`, `react-dom`, a direct `@nextlyhq/admin` reach, and
// a direct `nextly` import are all refused — the sdk is the only core surface.
// (`nextly` as a substring does not match: the regex requires the closing quote.)
const FORBIDDEN =
  /\bfrom\s+["'](?:next(?:\/[^"']*)?|react|react-dom|@nextlyhq\/admin(?:\/[^"']*)?|nextly(?:\/[^"']*)?)["']/;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      listSourceFiles(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("layering", () => {
  it("imports core only through @nextlyhq/plugin-sdk (no next/react/admin/nextly)", () => {
    const sourceFiles = listSourceFiles(SRC_DIR);
    expect(sourceFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const code = readFileSync(file, "utf8");
      // Drop comments so an example inside JSDoc cannot trip the guard.
      const stripped = code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (FORBIDDEN.test(stripped)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
