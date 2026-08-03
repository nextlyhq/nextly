/**
 * The modal scrim is a token, and stays one.
 *
 * It was written inline as `bg-black/80` — identical in both modes, at four
 * different strengths across six components. That is drift rather than intent,
 * and it is invisible to every token check the package has, because a literal
 * in a class name is not a token to check.
 *
 * Scope note: this reads sibling packages' source, which `packages/ui/turbo.json`
 * declares as inputs to this package's `test` task, so a change in a scanned
 * package invalidates the cached result. Same arrangement as the alpha-utility
 * call-site guard beside it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseThemeTokens } from "../contrast/parse-theme";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");
const css = readFileSync(resolve(here, "../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(css);

const OVERLAY_TOKENS = ["--nx-overlay", "--nx-overlay-soft"];

/** Every `.tsx` under a package's `src`, minus tests. */
function sources(pkg: string): string[] {
  const root = join(repo, "packages", pkg, "src");
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
    }
  };
  visit(root);
  return out;
}

describe("overlay scrim token", () => {
  it("is defined in both modes", () => {
    for (const token of OVERLAY_TOKENS) {
      expect(light.get(token), `${token} missing from :root`).toBeDefined();
      expect(dark.get(token), `${token} missing from .dark`).toBeDefined();
    }
  });

  it("differs between the modes, which is the reason it is a token", () => {
    // A scrim composites over what is beneath it, and what is beneath it is
    // white in one mode and near-black in the other. One value for both is a
    // literal with extra steps, and that is exactly what the inline
    // `bg-black/80` was.
    for (const token of OVERLAY_TOKENS) {
      expect(dark.get(token)).not.toBe(light.get(token));
    }
  });

  it("is the only way a scrim is written", () => {
    // The call-site half. A token nothing uses does not fix anything, and a
    // literal reintroduced next to it is invisible to the checks above.
    const offenders: string[] = [];
    for (const pkg of ["ui", "admin"]) {
      for (const file of sources(pkg)) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(
          /\bbg-(?:black|white)\/(?:\[[^\]]*\]|\d+)/g
        )) {
          offenders.push(`${file.slice(repo.length + 1)}: ${m[0]}`);
        }
      }
    }
    expect(
      offenders,
      "A scrim written as a literal is the same colour in light and dark and " +
        "cannot be themed. Use bg-overlay, or bg-overlay-soft over content:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});
