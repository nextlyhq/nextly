/**
 * The editor chrome's tokens must reach the iframe under the names the
 * overlay reads.
 *
 * The iframe is its own document rendering the user's page, so the admin's
 * tokens are mirrored in under `--nx-pb-ed-*` names. Nothing tied the emitted
 * names to the consumed ones, so renaming the admin's tokens silently
 * published `--nx-pb-ed-nx-primary` while the overlay went on reading
 * `--nx-pb-ed-primary`, and the chrome lost every colour it had.
 *
 * This walks the real overlay sources and holds the two ends together.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MIRRORED_TOKENS, mirroredName } from "./IframeCanvas";

const adminDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Every `--nx-pb-ed-*` name the editor chrome actually reads.
 *
 * Stops at a comma as well as the closing paren: `var(--x, fallback)` is a
 * usage like any other, and requiring the paren to follow the name would skip
 * exactly the declarations most likely to hide a missing token.
 */
function consumedNames(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(adminDir)) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/var\(\s*(--nx-pb-ed-[a-z0-9-]+)\s*[,)]/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

describe("mirroredName", () => {
  it("drops the admin prefix rather than a fixed number of characters", () => {
    expect(mirroredName("--nx-primary")).toBe("--nx-pb-ed-primary");
    expect(mirroredName("--nx-muted-foreground")).toBe(
      "--nx-pb-ed-muted-foreground"
    );
  });

  it("never doubles the namespace", () => {
    for (const token of MIRRORED_TOKENS) {
      expect(mirroredName(token)).not.toContain("-nx-nx-");
      expect(mirroredName(token)).not.toContain("pb-ed-nx-");
    }
  });
});

describe("the mirror covers what the chrome reads", () => {
  it("emits every token the overlay consumes", () => {
    const emitted = new Set(MIRRORED_TOKENS.map(mirroredName));
    const missing = [...consumedNames()].filter(n => !emitted.has(n));
    expect(
      missing,
      `not mirrored into the iframe: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("reads at least one mirrored token, so this test can fail", () => {
    // Guards the walker itself: if the scan silently found nothing, the
    // assertion above would pass while checking nothing at all.
    expect(consumedNames().size).toBeGreaterThan(0);
  });
});
