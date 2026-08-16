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

import { generate, parse } from "css-tree";
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
    // CSS ignores an `@import` that follows a style rule, so an import at the
    // bottom is silently dropped by every browser while still being present in
    // the file. Ordering is the property, and it is asked of the PARSED
    // stylesheet rather than of string offsets.
    //
    // Both operands defeated a text search in turn. Searching the bare word
    // `@import` measured the position of the COMMENT above the statement; and
    // taking `.nx-pb-editor {` as the first rule measures one specific
    // selector, so a rule inserted above the import but below that selector
    // invalidates the import while the comparison still reads correctly.
    // Neither is a property of the file — they are properties of two strings
    // that happen to appear in it.
    //
    // Walking the top-level children in order asks what CSS itself asks: does
    // any style rule precede the import.
    const sheet = parse(css);
    if (sheet.type !== "StyleSheet") throw new Error("not a stylesheet");

    const kinds: string[] = [];
    sheet.children.forEach(node => {
      if (node.type === "Rule") kinds.push("rule");
      else if (node.type === "Atrule" && node.name === "import") {
        // `generate` rather than reading the prelude's shape: css-tree gives an
        // `AtrulePrelude` here, and a guess at the node type silently matches
        // nothing — which reads as a missing import rather than a bad probe.
        kinds.push(
          `import:${node.prelude === null ? "" : generate(node.prelude)}`
        );
      }
    });

    const importIndex = kinds.findIndex(
      kind =>
        kind.startsWith("import:") &&
        kind.includes("@nextlyhq/builder/styles.css")
    );
    const firstRuleIndex = kinds.indexOf("rule");

    // Population first: a parse that yielded neither would satisfy an ordering
    // comparison between two -1s.
    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(firstRuleIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeLessThan(firstRuleIndex);
  });
});
