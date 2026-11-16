/**
 * The editor's words name each reusable thing one way.
 *
 * A saved part of a page is a "saved section", never a pattern; a header and
 * footer set is never a "Layout", a word the Style tab keeps for its Layout
 * section; a design copied once is a "Starter", and "template" means only a
 * linked design of a collection's entries. Code names stay as they are
 * (`"pattern"`, `"save-as-pattern"`, `kind: "pattern"`), so this reads only
 * what an author can see: string literals, template text and JSX text in the
 * shipped source.
 *
 * Read from the AST, so comments are never findings. Skipped as not shown to
 * an author: module specifiers, literal types, object keys, lower-case code
 * names with no space, and any argument of a `console` call. Every other hit
 * must be listed in {@link ALLOWED} with why it names something else, and a
 * listed text that no longer appears fails too.
 *
 * @module user-words.test
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node as AstNode } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { TEST_MODULE, collectModules } from "./source-modules";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

const RULES: readonly RegExp[] = [
  /\blayouts?\b/i,
  /\bpatterns?\b/i,
  // A bare "Template(s)" as a name; "its template" in a sentence is the
  // linked design of a collection's entries, which is what the word means.
  /(?<![Cc]ollection )\bTemplates?\b/,
  /\b(?:starter|page|site)s? templates?\b/i,
  /\bstarters?\b(?! (?:header|footer|pages?|sites?)\b)/i,
];

/** A lower-case code name: a slug, an id, a path, a CSS class. */
const CODE_NAME = /^[a-z0-9_\-:./#@*${}…[\]]*$/;

/** Whether a string at this place in the tree is never shown to an author. */
function notShown(node: AstNode, ancestors: readonly AstNode[]): boolean {
  const parent = ancestors.at(-1);
  if (
    (parent?.type === "Property" || parent?.type === "TSPropertySignature") &&
    parent.key === node
  ) {
    return true;
  }
  return ancestors.some(
    above =>
      above.type === "TSLiteralType" ||
      ((above.type === "ImportDeclaration" ||
        above.type === "ExportNamedDeclaration" ||
        above.type === "ExportAllDeclaration" ||
        above.type === "ImportExpression") &&
        above.source === node) ||
      (above.type === "CallExpression" &&
        above.callee.type === "MemberExpression" &&
        above.callee.object.type === "Identifier" &&
        above.callee.object.name === "console")
  );
}

/** The texts an author could read in one source file. */
function shownTexts(source: string, fileName: string): string[] {
  const texts: string[] = [];
  walk(parseSource(source, fileName).program, (node, ancestors) => {
    let text: string | null = null;
    if (node.type === "Literal" && typeof node.value === "string") {
      text = node.value;
    } else if (node.type === "TemplateLiteral") {
      text = node.quasis.map(quasi => quasi.value.cooked ?? "").join("{…}");
    } else if (node.type === "JSXText") {
      text = node.value;
    }
    if (text === null) return;
    // A stylesheet's comments are never drawn.
    const trimmed = text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (trimmed === "" || CODE_NAME.test(trimmed)) return;
    if (notShown(node, ancestors)) return;
    texts.push(trimmed);
  });
  return texts;
}

function brokenRules(texts: readonly string[]): string[] {
  return texts.filter(text => RULES.some(rule => rule.test(text)));
}

/**
 * Texts that match a rule but name something else, by file. Each says why.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // A Columns block's arrangement of its columns.
  "columns-layout-field.tsx": ["A layout of its own, written as CSS below."],
  "columns-layout.ts": ["Not a layout."],
  // The Add panel's group of layout blocks (Section, Columns, Grid).
  "inserter-palette.ts": ["Layout"],
  // The Style tab's Layout section.
  "inspector-sections.ts": ["Layout"],
  // A header or footer the site's own code draws around the canvas.
  "site-chrome-cues.tsx": [
    "Part of your site’s layout",
    "Part of your site’s layout. It comes from your site’s code and can’t be edited here.",
  ],
};

function productFiles(): string[] {
  return collectModules(
    SRC_DIR,
    at => readdirSync(at, { withFileTypes: true }),
    join
  ).filter(file => !TEST_MODULE.test(file) && !file.endsWith(".d.ts"));
}

describe("the editor's words", () => {
  const files = productFiles();
  const findings = files.flatMap(file =>
    brokenRules(shownTexts(readFileSync(file, "utf8"), file)).map(text => ({
      file: relative(SRC_DIR, file),
      text,
    }))
  );

  it("reads the files it claims to", () => {
    expect(files.map(file => relative(SRC_DIR, file))).toEqual(
      expect.arrayContaining([
        "editor-words.ts",
        "builder-commands.ts",
        "toolbar-actions.ts",
        "insert-panel.tsx",
      ])
    );
  });

  it("name each reusable thing one way", () => {
    expect(
      findings.filter(f => !(ALLOWED[f.file] ?? []).includes(f.text))
    ).toEqual([]);
  });

  it("allow nothing that no longer appears", () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, texts]) =>
      texts
        .filter(t => !findings.some(f => f.file === file && f.text === t))
        .map(t => `${file}: ${t}`)
    );
    expect(stale).toEqual([]);
  });

  it("reads strings, template text and JSX text, not comments or code names", () => {
    const texts = shownTexts(
      [
        "// Save as pattern",
        'type Id = "save-as-pattern";',
        'const ids = { "save-as-pattern": 1, kind: "pattern" };',
        'console.warn("a pattern could not be read");',
        'const a = "Save as pattern";',
        "const b = `More ${1} patterns`;",
        "const C = () => <p>Choose a Layout</p>;",
      ].join("\n"),
      "probe.tsx"
    );
    expect(brokenRules(texts)).toEqual([
      "Save as pattern",
      "More {…} patterns",
      "Choose a Layout",
    ]);
  });
});
