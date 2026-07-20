/**
 * The README tells consumers of `styles.scoped.css` which components need a
 * `PortalProvider`, because a portalled overlay defaults to `document.body` —
 * outside the wrapper, where the scoped rules and tokens do not reach.
 *
 * The list is derived from the source rather than trusted as prose: an omission
 * is invisible, since the overlay still renders, just unstyled.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = resolve(HERE, "components");
const README = resolve(HERE, "../README.md");

/** `select.tsx` -> `Select`, `alert-dialog.tsx` -> `AlertDialog`. */
function componentName(file: string): string {
  return file
    .replace(/\.tsx$/, "")
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function portalledComponents(): string[] {
  return readdirSync(COMPONENTS)
    .filter(file => file.endsWith(".tsx"))
    .filter(file =>
      readFileSync(join(COMPONENTS, file), "utf8").includes(
        "usePortalContainer"
      )
    )
    .map(componentName)
    .sort();
}

describe("scoped stylesheet portal docs", () => {
  it("names every component that portals its overlay", () => {
    const readme = readFileSync(README, "utf8");
    const section = readme.slice(readme.indexOf("### Overlays need a portal"));
    const listed = section.slice(0, section.indexOf("```"));

    const missing = portalledComponents().filter(
      name => !new RegExp(`\\b${name}\\b`).test(listed)
    );

    expect(
      missing,
      "these components call usePortalContainer but the README does not list them"
    ).toEqual([]);
  });
});
