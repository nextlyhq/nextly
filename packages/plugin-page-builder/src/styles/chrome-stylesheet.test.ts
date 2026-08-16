/**
 * The editor stylesheet pulls in the shell's, because hosts load only this one.
 *
 * `EditorSurface` renders `@nextlyhq/builder`'s shell, whose layout rules and
 * `--nx-builder-*` tokens live in that package's sheet. The plugin documents and
 * exports exactly one stylesheet — `./styles/editor.css` — so a host that
 * followed the documentation precisely would still render the chrome with no
 * layout and no colours.
 *
 * Asserted over the SOURCE rather than by rendering: the rules only take effect
 * in a real browser with a real bundler, and jsdom applies no stylesheet at all,
 * so a render-based check here would pass whatever the CSS says.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = dirname(fileURLToPath(import.meta.url));
const EDITOR_CSS = join(STYLES, "editor.css");

describe("the editor stylesheet", () => {
  const css = readFileSync(EDITOR_CSS, "utf8");

  it("reads a stylesheet with rules in it, so the checks below are not vacuous", () => {
    // Positive control. An empty or misresolved file would satisfy a `toContain`
    // check for nothing and fail one for something, either way proving little.
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain(".nx-pb-editor");
  });

  it("imports the builder's chrome sheet", () => {
    expect(css).toContain('@import "@nextlyhq/builder/styles.css"');
  });

  it("imports it BEFORE any rule, which is what makes the import valid", () => {
    // CSS ignores an `@import` that follows a style rule. Asserting only that the
    // import exists would pass on a file where it sits at the bottom and is
    // silently dropped by every browser — the failure this ordering prevents.
    const importAt = css.indexOf("@import");
    const firstRuleAt = css.indexOf(".nx-pb-editor");

    expect(importAt).toBeGreaterThanOrEqual(0);
    expect(firstRuleAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeLessThan(firstRuleAt);
  });
});
