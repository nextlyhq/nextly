/**
 * A fetched URL goes through the origin policy; a navigated one does not.
 *
 * The distinction is the whole of it, and it is easy to get wrong because both
 * helpers take a URL and return a URL. `safeUrl` checks the scheme, which is
 * what an `href` needs — a navigation happens when someone clicks it. `src`,
 * `poster`, `srcSet` and inline backgrounds are requested without asking, and
 * whether that request happens can be made conditional by CSS, which is the
 * channel the allowlist closes.
 *
 * Both helpers take a URL and return a URL, so nothing about a call site makes
 * the wrong one look wrong. This scans for the shape instead: a URL flowing
 * into a fetched attribute from the scheme-only helper reaches whatever host it
 * names, whatever the allowlist says.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Attributes the browser resolves on its own, without a user action. */
const FETCHING = ["src", "poster", "srcSet", "backgroundImage"];

describe("fetched URLs use the origin-gated helper", () => {
  it("never assigns safeUrl() to an attribute the browser fetches", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(here)) {
      if (!entry.endsWith(".tsx") || entry.includes(".test.")) continue;
      const text = readFileSync(join(here, entry), "utf8");
      for (const attr of FETCHING) {
        // `const src = safeUrl(...)` and `src={safeUrl(...)}` alike.
        const direct = new RegExp(
          `(?:const|let)\\s+${attr}\\b[^=]*=\\s*safeUrl\\(`,
          "g"
        );
        const inline = new RegExp(`\\b${attr}=\\{?\\s*safeUrl\\(`, "g");
        // `style={{ backgroundImage: safeUrl(v) }}` — a property, not an
        // assignment or a JSX attribute, and the commonest shape for the
        // inline backgrounds that are fetched most conditionally of all.
        const property = new RegExp(`\\b${attr}\\s*:\\s*safeUrl\\(`, "g");
        for (const re of [direct, inline, property]) {
          if (re.test(text)) offenders.push(`${entry}: ${attr} = safeUrl(...)`);
        }
      }
    }
    expect(
      offenders.sort(),
      "These feed a URL the browser fetches into the scheme-only helper, so no " +
        "allowlist applies and the host is reachable. Use mediaUrl(value, " +
        `remotePatterns):\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

/**
 * Every place a block is rendered hands it the allowlist.
 *
 * A block reads `remotePatterns` from its render arguments, so a call site that
 * omits it does not fail — the argument is optional and the block falls back to
 * an empty list. That failure is silent and it is fail-OPEN in the editor's
 * direction: the canvas drops images the published page will show, which reads
 * as a rendering bug rather than as a missing argument. Three call sites had it
 * missing for exactly that reason.
 */
describe("every block render call passes the allowlist", () => {
  const SRC = join(here, "..", "..");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...sourceFiles(full));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test."))
        continue;
      out.push(full);
    }
    return out;
  }

  it.each([
    // The registry call every renderer makes, and the component that wraps it.
    ["def.render({", /\bdef\.render\(\{([\s\S]*?)\}\)/g],
    ["<RenderNode", /<RenderNode\b([\s\S]*?)\/>/g],
  ])("%s carries remotePatterns", (label, pattern) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(pattern)) {
        if (m[1].includes("remotePatterns")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(
      offenders.sort(),
      `These render a block without the allowlist, so it falls back to an ` +
        `empty one and refuses hosts the page allows:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
