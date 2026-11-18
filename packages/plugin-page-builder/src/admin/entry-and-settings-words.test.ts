/**
 * The words of the entry and settings screens, read together across the
 * packages that draw them: the admin's entry form, list, Single panel and
 * dashboard; this plugin's New page dialog, Page settings, cards and "Shown
 * on"; the SEO plugin's tab in Page settings; and the builder's word modules
 * and shell.
 *
 * Each decided word is said, in the file that draws it, and no author ever
 * reads "slug", "document view", "field type" or "blocks field" on these
 * screens: those are the code's names for an address, a way of opening an
 * entry, a kind of field and the page builder's own field.
 *
 * Read from the AST, as the builder's `user-words.test` does, so comments are
 * never findings. Skipped as not shown to an author: module specifiers,
 * literal types, object keys, lower-case code names with no space (except
 * where a string is always shown: a header, a label, an accessible name), the
 * attributes that only code reads (`className`, `data-*` and the rest), and
 * any argument of a `console` call. A JSX element's own text and the
 * expressions between it are read as one text, `{…}` standing for each
 * expression, so `New {labels.singular}` reads "New {…}".
 *
 * @module admin/entry-and-settings-words.test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node as AstNode } from "oxc-parser";
import { describe, expect, it } from "vitest";

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The screens this feature drew or changed, by package-relative path: a
 * folder is read whole, a file alone.
 */
const SCREENS: readonly string[] = [
  "admin/src/components/features/entries/EntryForm",
  "admin/src/components/features/entries/EntryList",
  "admin/src/components/features/singles",
  "admin/src/components/features/dashboard",
  // The Singles list and a Single's own pages; its Schema Builder screen
  // (`singles/builder`) is a developer's, where "Slug" is the field's name.
  "admin/src/pages/dashboard/singles/index.tsx",
  "admin/src/pages/dashboard/singles/components",
  "admin/src/pages/dashboard/singles/[slug]",
  "admin/src/lib/navigation/document-address.ts",
  "plugin-page-builder/src/admin",
  "plugin-page-builder/src/builder-view.ts",
  "plugin-page-builder/src/shown-on-contract.ts",
  "plugin-seo/src/admin/PageBuilderSeoTab.tsx",
  "plugin-seo/src/admin/PageBuilderSearchResult.tsx",
  "plugin-seo/src/admin/SeoTab.tsx",
  "plugin-seo/src/admin/previews.tsx",
  "plugin-seo/src/tab/contributions.ts",
  "builder/src/editor-words.ts",
  "builder/src/block-style-words.ts",
  "builder/src/canvas/page-start-words.ts",
  "builder/src/shell",
];

/** The code's names that an author never reads on these screens. */
const BANNED: readonly RegExp[] = [
  /\bslugs?\b/i,
  /\bdocument[ -]views?\b/i,
  /\bfield[ -]types?\b/i,
  /\bblocks[ -]fields?\b/i,
];

/**
 * Each decided word, and the file that says it. A string is the whole text;
 * a pattern, a text that goes on (the count in "View all pins (3)").
 */
const DECIDED: readonly { word: string | RegExp; file: string }[] = [
  {
    word: "Open in builder",
    file: "plugin-page-builder/src/builder-view.ts",
  },
  {
    word: "Open in builder",
    file: "plugin-page-builder/src/admin/PageBuilderCard.tsx",
  },
  {
    word: "Open as form",
    file: "plugin-page-builder/src/admin/editor/editor-more-menu.tsx",
  },
  {
    word: "Edit details",
    file: "admin/src/lib/navigation/document-address.ts",
  },
  {
    word: "New {…}",
    file: "admin/src/components/features/entries/EntryList/EntryList.tsx",
  },
  {
    word: "New {…}",
    file: "admin/src/components/features/entries/EntryList/useListCreateDialog.tsx",
  },
  {
    word: "New {…}",
    file: "plugin-page-builder/src/admin/new-page/new-page-words.ts",
  },
  ...[
    "Create and open builder",
    "Start from",
    "Blank",
    "Address",
    "Header & footer",
  ].map(word => ({
    word,
    file: "plugin-page-builder/src/admin/new-page/new-page-words.ts",
  })),
  {
    word: "Page settings",
    file: "plugin-page-builder/src/admin/editor/document-settings-panel.tsx",
  },
  {
    word: /^Page settings · \{…\}$/,
    file: "plugin-page-builder/src/admin/editor/settings-dialog.tsx",
  },
  ...["General", "Fields", "Code", "Site settings"].map(word => ({
    word,
    file: "plugin-page-builder/src/admin/editor/settings-dialog.tsx",
  })),
  { word: "SEO", file: "plugin-seo/src/tab/contributions.ts" },
  {
    word: "Shown on (from the builder)",
    file: "plugin-page-builder/src/shown-on-contract.ts",
  },
  {
    word: "For developers",
    file: "admin/src/components/features/entries/EntryForm/panels/SinglePanelSections.tsx",
  },
  ...["Pinned", "Recent", /^View all pins \(\{…\}\)$/].map(word => ({
    word,
    file: "admin/src/components/features/dashboard/ContinueCard.tsx",
  })),
];

/**
 * Texts that match a banned word but are never read by an author as that
 * word, by file. Each says why.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // A template's collection, where the collections can't be listed: named as
  // the Schema Builder's own Slug field names it, the one name the person can
  // find and type then.
  "plugin-page-builder/src/admin/TemplateCollectionField.tsx": [
    '"{…}" isn\'t among the collections you can see, so it is shown by its slug.',
    "Couldn't list the collections. Type the collection's slug, or reload the page to try again.",
  ],
};

/** A lower-case code name: a slug, an id, a path, a CSS class. */
const CODE_NAME = /^[a-z0-9_\-:./#@*${}…[\]]*$/;

/**
 * Where a string is always shown, a lone lower-case word included: a value
 * under one of these keys, or one of these attributes on an element.
 */
const SHOWN_PLACE =
  /^(?:header|heading|label|title|placeholder|description|tooltip|hint|note|caption|message|alt|aria-label|aria-description|aria-valuetext)$/;

/** The name of a property's key or an element's attribute, when plain. */
function placeName(holder: AstNode): string | null {
  if (holder.type === "Property") {
    if (holder.key.type === "Identifier") return holder.key.name;
    if (holder.key.type === "Literal") return String(holder.key.value);
    return null;
  }
  if (holder.type === "JSXAttribute" && holder.name.type === "JSXIdentifier") {
    return holder.name.name;
  }
  return null;
}

/**
 * Whether a string sits where it is shown however it is spelled: the value
 * of a shown key (`header: "slug"`), or a shown attribute, given directly or
 * as an expression (`aria-label="slug"`, `aria-label={"slug"}`).
 */
function inShownPlace(node: AstNode, ancestors: readonly AstNode[]): boolean {
  const parent = ancestors.at(-1);
  const holder =
    parent?.type === "JSXExpressionContainer" ? ancestors.at(-2) : parent;
  if (holder === undefined) return false;
  if (holder.type === "Property" && holder.value !== node) return false;
  const name = placeName(holder);
  return name !== null && SHOWN_PLACE.test(name);
}

/** The attributes only code reads; anything else on an element may be shown. */
const CODE_ATTRIBUTE =
  /^(?:className|class|style|id|key|ref|role|type|name|value|href|to|src|htmlFor|form|method|target|rel|tabIndex|autoComplete|inputMode|pattern|side|align|variant|size|data-.*|aria-(?:controls|describedby|labelledby|owns|haspopup|live|current|expanded|selected|pressed|hidden|modal|atomic|relevant|orientation|sort))$/;

const TEST_FILE = /\.(?:test|spec|test-d|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

function sourceFilesIn(at: string): string[] {
  if (statSync(at).isFile()) return [at];
  return readdirSync(at, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "__tests__" || entry.name === "__fixtures__") return [];
    const path = join(at, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)
      ? [path]
      : [];
  });
}

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
      (above.type === "JSXAttribute" &&
        above.name.type === "JSXIdentifier" &&
        CODE_ATTRIBUTE.test(above.name.name)) ||
      (above.type === "JSXAttribute" &&
        above.name.type === "JSXNamespacedName") ||
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

/** One run of an element's children read as a line: text, `{…}` between. */
function elementText(children: readonly AstNode[]): string {
  return children
    .map(child => {
      if (child.type === "JSXText") return child.value;
      if (child.type === "JSXExpressionContainer") {
        return child.expression.type === "JSXEmptyExpression" ? "" : "{…}";
      }
      return " ";
    })
    .join("");
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The texts an author could read in one source file. */
export function shownTexts(source: string, fileName: string): string[] {
  const texts: string[] = [];
  walk(parseSource(source, fileName).program, (node, ancestors) => {
    let text: string | null = null;
    if (node.type === "Literal" && typeof node.value === "string") {
      text = node.value;
    } else if (node.type === "TemplateLiteral") {
      text = node.quasis.map(quasi => quasi.value.cooked ?? "").join("{…}");
    } else if (node.type === "JSXElement" || node.type === "JSXFragment") {
      const line = tidy(elementText(node.children));
      // An element whose children are only expressions says nothing itself.
      if (line.replace(/\{…\}/g, "").trim() !== "") texts.push(line);
      return;
    }
    if (text === null) return;
    const trimmed = tidy(text);
    if (trimmed === "") return;
    // A lower-case code name is skipped, unless it stands where it is shown.
    if (CODE_NAME.test(trimmed) && !inShownPlace(node, ancestors)) return;
    if (notShown(node, ancestors)) return;
    texts.push(trimmed);
  });
  return texts;
}

function readsAs(text: string, word: string | RegExp): boolean {
  return typeof word === "string" ? text === word : word.test(text);
}

describe("the entry and settings screens' words", () => {
  const files = SCREENS.flatMap(screen =>
    sourceFilesIn(join(PACKAGES, screen))
  );
  const shown = new Map(
    files.map(file => [
      relative(PACKAGES, file),
      shownTexts(readFileSync(file, "utf8"), file),
    ])
  );
  const findings = [...shown].flatMap(([file, texts]) =>
    texts
      .filter(text => BANNED.some(rule => rule.test(text)))
      .map(text => ({ file, text }))
  );

  it("reads the files it claims to", () => {
    expect([...shown.keys()]).toEqual(
      expect.arrayContaining([
        ...new Set(DECIDED.map(decided => decided.file)),
        "admin/src/components/features/entries/EntryForm/DocumentAddressChip.tsx",
        "plugin-page-builder/src/admin/new-page/new-page-dialog.tsx",
        "plugin-seo/src/admin/PageBuilderSeoTab.tsx",
      ])
    );
  });

  it.each(DECIDED.map(decided => [String(decided.word), decided] as const))(
    "says %s",
    (_name, { word, file }) => {
      expect(
        (shown.get(file) ?? []).filter(text => readsAs(text, word)),
        `${file} says ${String(word)}`
      ).not.toEqual([]);
    }
  );

  it('never says "slug", "document view", "field type" or "blocks field"', () => {
    expect(
      findings.filter(f => !(ALLOWED[f.file] ?? []).includes(f.text))
    ).toEqual([]);
  });

  it("allows nothing that no longer appears", () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, texts]) =>
      texts
        .filter(t => !findings.some(f => f.file === file && f.text === t))
        .map(t => `${file}: ${t}`)
    );
    expect(stale).toEqual([]);
  });

  it("reads strings, template text, element text and shown attributes, not code", () => {
    const texts = shownTexts(
      [
        "// The slug field",
        'type Kind = "blocks field";',
        'const ids = { "field type": 1, slug: "slug" };',
        'console.warn("a document view could not load");',
        'const a = "Change the slug";',
        "const b = `Every ${1} field type`;",
        'const C = () => <p className="slug field" data-x="a slug">Blocks field {n} here</p>;',
        'const D = () => <button aria-label="Copy the slug" title="Document view" />;',
        // A lone lower-case word is still read where it is shown: a column's
        // header, a label, an accessible name. Elsewhere it is a code name.
        'const column = { name: "slug", header: "slug", label: "slugs" };',
        'const E = () => <input aria-label="slug" name="slug" />;',
      ].join("\n"),
      "probe.tsx"
    );
    expect(texts.filter(text => BANNED.some(rule => rule.test(text)))).toEqual([
      "Change the slug",
      "Every {…} field type",
      "Blocks field {…} here",
      "Copy the slug",
      "Document view",
      "slug",
      "slugs",
      "slug",
    ]);
  });
});
