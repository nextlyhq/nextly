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
 * `core/image` — the package's primary image block — used the navigation helper
 * for its source, so it kept reaching undeclared hosts after every background
 * had been gated. This scans for that shape rather than trusting the next
 * person to pick the right one.
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
        for (const re of [direct, inline]) {
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
