/**
 * The words an author reads name each reusable thing one way.
 *
 * The four libraries have one plain name each: "Header & footer" (a named one
 * is a "header & footer set"), "Saved sections", "Components" and
 * "Collection templates". A design copied once and then the author's own is
 * a "Starter", and "template" means only a linked design of a collection's
 * entries. Code names stay as they are (`layout`, `pattern`, the collection
 * slugs, API paths and stored fields), so this reads only what an author can
 * see: string literals, template text and JSX text in the shipped source, and
 * the prose of the Page Builder docs.
 *
 * Read from the AST, so comments are never findings and a string split over
 * lines still is. Skipped as not shown to an author:
 * - module specifiers and literal types;
 * - object keys, and an `icon` or `logMessage` value;
 * - lower-case code names with no space (`"layout"`, `"save-as-pattern"`);
 * - log lines: a string starting "[page-builder]", and any argument of a
 *   `warn`, `error`, `info`, `debug` or `log` call on anything but `toast`.
 *
 * Every other hit must be listed in {@link ALLOWED} with why it is not one
 * of the four libraries, and a listed text that no longer appears fails too,
 * so the list cannot outlive what it excuses.
 *
 * @module user-words.test
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node as AstNode } from "oxc-parser";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(SRC_DIR, "../../../docs/page-builder");

/** One old or mixed-up name, and what to say instead. */
interface WordRule {
  readonly test: RegExp;
  readonly instead: string;
}

const RULES: readonly WordRule[] = [
  {
    test: /\blayouts?\b/i,
    instead: '"Header & footer", or "header & footer set" for a named one',
  },
  { test: /\bpatterns?\b/i, instead: '"Saved sections", or "saved section"' },
  {
    // A bare "Template(s)" as a name; "a collection's template" in a sentence
    // is the linked design, which is what "template" means.
    test: /(?<![Cc]ollection )\bTemplates?\b/,
    instead: '"Collection templates", or "collection template"',
  },
  {
    test: /\b(?:starter|page|site)s? templates?\b/i,
    instead: '"Starter …": a copied design is never a template',
  },
  {
    test: /\bstarters?\b(?! (?:header|footer|pages?|sites?)\b)/i,
    instead:
      '"Starter header", "Starter footer", "Starter pages" or "Starter sites"',
  },
];

/** A text that breaks a rule, and where. */
interface WordFinding {
  readonly file: string;
  readonly text: string;
}

const LOG_METHODS = new Set(["warn", "error", "info", "debug", "log"]);
const SKIPPED_KEYS = new Set(["icon", "logMessage"]);
/** A lower-case code name: a slug, an id, a path, a CSS class. */
const CODE_NAME = /^[a-z0-9_\-:./#@*${}…[\]]*$/;

function keyName(node: AstNode | undefined): string | null {
  if (node === undefined) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

/** Whether a string at this place in the tree is never shown to an author. */
function notShown(node: AstNode, ancestors: readonly AstNode[]): boolean {
  const parent = ancestors.at(-1);
  if (parent === undefined) return false;
  if (parent.type === "Property" || parent.type === "TSPropertySignature") {
    if (parent.key === node) return true;
    if (SKIPPED_KEYS.has(keyName(parent.key as AstNode) ?? "")) return true;
  }
  for (const above of ancestors) {
    switch (above.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
      case "ImportExpression":
        if ("source" in above && above.source === node) return true;
        break;
      case "TSLiteralType":
        return true;
      case "CallExpression": {
        const callee = above.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          LOG_METHODS.has(callee.property.name) &&
          !(
            callee.object.type === "Identifier" &&
            callee.object.name === "toast"
          )
        ) {
          return true;
        }
        break;
      }
    }
  }
  return false;
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
    if (trimmed.startsWith("[page-builder]")) return;
    if (notShown(node, ancestors)) return;
    texts.push(trimmed);
  });
  return texts;
}

/** The texts that break a rule. */
function brokenRules(texts: readonly string[]): string[] {
  return texts.filter(text => RULES.some(rule => rule.test.test(text)));
}

/** The prose of an `.mdx` page: no code, no link targets, no tag attributes. */
function docsProse(page: string): string[] {
  return page
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[A-Za-z][^>]*>/g, "")
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, " ").trim())
    .filter(paragraph => paragraph !== "");
}

function shippedSources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter(name => /\.tsx?$/.test(name))
    .filter(
      name => !/\.test(?:-d)?\.tsx?$|\.d\.ts$|(?:^|\/)__tests__\//.test(name)
    )
    .map(name => join(dir, name));
}

/**
 * Texts that match a rule but name something else, by file. Each says why.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {};

function findingsIn(
  files: readonly string[],
  read: (file: string) => readonly string[]
): WordFinding[] {
  return files.flatMap(file =>
    brokenRules(read(file)).map(text => ({
      file: relative(join(SRC_DIR, "../../.."), file),
      text,
    }))
  );
}

function notAllowed(findings: readonly WordFinding[]): WordFinding[] {
  return findings.filter(f => !(ALLOWED[f.file] ?? []).includes(f.text));
}

function staleAllowances(findings: readonly WordFinding[]): string[] {
  return Object.entries(ALLOWED).flatMap(([file, texts]) =>
    texts
      .filter(text => !findings.some(f => f.file === file && f.text === text))
      .map(text => `${file}: ${text}`)
  );
}

describe("the words an author reads", () => {
  const sources = findingsIn(shippedSources(SRC_DIR), file =>
    shownTexts(readFileSync(file, "utf8"), file)
  );
  const docs = findingsIn(
    readdirSync(DOCS_DIR)
      .filter(name => name.endsWith(".mdx") || name === "meta.json")
      .map(name => join(DOCS_DIR, name)),
    file => docsProse(readFileSync(file, "utf8"))
  );

  it("reads the files it claims to", () => {
    // By membership, not by count: a scan reduced to a stray folder still
    // reads SOME files. These hold the library names.
    const read = shippedSources(SRC_DIR).map(file => relative(SRC_DIR, file));
    expect(read).toEqual(
      expect.arrayContaining([
        "overview/admin-panel.ts",
        "admin/overview/PageBuilderOverview.tsx",
        "collections/layouts.ts",
        "admin/SavePatternDialog.tsx",
      ])
    );
    expect(read.some(file => file.includes(".test."))).toBe(false);
  });

  it("name each reusable thing one way in the plugin's source", () => {
    expect(notAllowed(sources)).toEqual([]);
  });

  it("name each reusable thing one way in the Page Builder docs", () => {
    expect(notAllowed(docs)).toEqual([]);
  });

  it("allow nothing that no longer appears", () => {
    expect(staleAllowances([...sources, ...docs])).toEqual([]);
  });
});

describe("the words scan", () => {
  it("reads strings, template text and JSX text, and skips comments", () => {
    const texts = shownTexts(
      [
        "// Save as pattern",
        'const a = "Save as pattern";',
        "const b = `${1} Layouts use it`;",
        "const C = () => <p>Choose a Layout</p>;",
      ].join("\n"),
      "probe.tsx"
    );
    expect(brokenRules(texts)).toEqual([
      "Save as pattern",
      "{…} Layouts use it",
      "Choose a Layout",
    ]);
  });

  it("skips code names, keys, icons, imports and log lines", () => {
    const texts = shownTexts(
      [
        'import { x } from "./layout";',
        'type K = "pattern" | "layout";',
        'const m = { layouts: "x y", icon: "Layout", kind: "pattern" };',
        'deps.warn("a Layout could not be read");',
        'toast.error("The Layout could not be read");',
      ].join("\n"),
      "probe.ts"
    );
    expect(brokenRules(texts)).toEqual(["The Layout could not be read"]);
  });

  it("keeps a collection's template and a starter header, and refuses the rest", () => {
    expect(
      brokenRules([
        "Collection templates",
        "Every post is shown with this template.",
        "Starter header",
        "Templates",
        "Starter template",
        "Pick a starter",
      ])
    ).toEqual(["Templates", "Starter template", "Pick a starter"]);
  });

  it("reads docs prose, not code", () => {
    expect(
      docsProse(
        "---\ntitle: Layouts\n---\n\nUse `layouts` here.\n\n```ts\nconst layout = 1;\n```\n\nSee [the API](/docs/layouts)."
      )
    ).toEqual(["--- title: Layouts ---", "Use here.", "See [the API]."]);
  });
});
