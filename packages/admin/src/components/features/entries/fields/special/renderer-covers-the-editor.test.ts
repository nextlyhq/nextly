/**
 * The editor and the published renderer must know the same node types.
 *
 * This package registers the Lexical nodes an author can insert; `blocks-react`
 * draws the stored result on a page. Nothing connects the two lists, and the gap
 * is SILENT in the worst direction: a node the renderer does not know takes its
 * unknown-node fallback, which descends into `children` — and every media node
 * keeps its content in its own fields, so it draws as nothing at all. The author
 * sees the image in the editor, the visitor sees a blank space, and no test,
 * type or log reports a loss. It happened to four node types at once.
 *
 * ## Why the check lives HERE, in the editor's package
 *
 * Because this is the only place the editor's answer is authoritative. The
 * registration is `RICH_TEXT_NODES`, and most of its entries are Lexical's own
 * classes — `ListNode`, `TableCellNode`, `LinkNode` — whose type strings exist
 * only inside a dependency. A check that scanned local class definitions sees
 * eight of the twenty and reports complete coverage: deleting `tablecell` from
 * the renderer leaves it green, because `TableCellNode.getType()` is not in any
 * file it reads.
 *
 * Importing the registration and CALLING `getType()` has no such gap — it is the
 * same string Lexical serialises, from the same class the editor registers, so
 * there is nothing to keep in step. Those packages resolve here and nowhere
 * else, which is what decides the location.
 *
 * The renderer is read as SOURCE rather than imported, and that is deliberate
 * too: this package does not depend on `blocks-react` and must not start, so the
 * file is opened by path. A static read creates no dependency.
 *
 * @module special/renderer-covers-the-editor.test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RICH_TEXT_NODES } from "@admin/components/features/entries/fields/special/rich-text-kit";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the published page decides what a stored node draws as. */
const RENDERER = join(
  HERE,
  "../../../../../../..",
  "blocks-react/src/rich-text.tsx"
);

/**
 * Types the renderer knowingly does not draw, and why.
 *
 * An entry is a DECISION, not a todo: it records that someone looked at this
 * type and concluded the page should draw nothing for it. Adding one is how the
 * check is meant to be satisfied when rendering is genuinely not the answer.
 * Deleting the check, or narrowing what it reads until the type disappears, is
 * not.
 */
const DECLARED_UNRENDERED: Readonly<Record<string, string>> = {
  video:
    "Needs the provider-to-embed-URL derivation, which lives in this package " +
    "(getEmbedUrl) and cannot be reached from blocks-react: it is forbidden to " +
    "import the admin, and re-deriving it there would be a second " +
    "implementation of one question. Sharing it means giving this package a " +
    "dependency on blocks-engine, which it does not have today — worth taking " +
    "as its own decision rather than inside a rendering change.",
};

/** Every node type the editor can produce, from the classes it registers. */
function editorNodeTypes(): string[] {
  return RICH_TEXT_NODES.map(node =>
    (node as unknown as { getType(): string }).getType()
  );
}

/** One renderer table's entry keys, or nothing when the table is not there. */
function keysOfTable(source: string, table: string): string[] {
  const start = source.indexOf(`const ${table}`);
  if (start === -1) return [];
  // To the end of the object literal. The two tables close at DIFFERENT
  // indents — one at column zero, one nested inside a `Readonly<...>` type
  // argument — so both closers are looked for and the nearer one wins. A slice
  // running past the end would sweep in the next object's keys and report them
  // as rendered types.
  const closers = ["\n};", "\n  };"]
    .map(closer => ({ at: source.indexOf(closer, start), closer }))
    .filter(found => found.at !== -1)
    .sort((a, b) => a.at - b.at);
  const nearest = closers[0];
  if (nearest === undefined) return [];

  /*
   * The EXACT indent of a top-level entry, derived from the table's own closing
   * brace rather than guessed at as a range.
   *
   * A range accepts any key nested inside a dispatch callback — a local object
   * whose property happens to be named like a node type would then be recorded
   * as rendered while no handler for it exists, which is precisely the silent
   * loss this check is here to refuse.
   *
   * Counting braces instead does not work on this input: the callbacks are JSX,
   * and `<details open={node.open}>{children(node.children)}</details>` is full
   * of braces that no depth counter can attribute correctly without parsing the
   * language. Indentation is decidable from the text, and prettier makes it
   * reliable — the file it formats is the file this reads.
   */
  const closerIndent = nearest.closer.length - "\n};".length;
  const entryIndent = " ".repeat(closerIndent + 2);
  const keyAtTopLevel = new RegExp(
    `\n${entryIndent}(?:"([a-z0-9-]+)"|([a-z0-9-]+)):`,
    "g"
  );
  return [...source.slice(start, nearest.at).matchAll(keyAtTopLevel)].map(
    match => match[1] ?? match[2] ?? ""
  );
}

/**
 * Every node type the renderer draws, from its two dispatch tables.
 *
 * Both, because they are two halves of one answer: one table holds the types
 * that are an element around their children and the other the types that are
 * more. Reading one reports the other's types as missing.
 */
export function renderedTypes(source: string): Set<string> {
  return new Set(
    ["SIMPLE_ELEMENTS", "NODE_VIEWS"].flatMap(table =>
      keysOfTable(source, table)
    )
  );
}

describe("the parser this check is built from", () => {
  /*
   * `renderedTypes` IS the check on the renderer side: a reader that sees too
   * little reports handled types as missing, and one that sees too much records
   * a type as handled when no handler exists — which is the silent loss the
   * whole file is here to refuse. These cover it on inputs whose answers are
   * known, including the shapes it has already been got wrong on.
   */
  it("reads BOTH tables, which are indented differently", () => {
    // `SIMPLE_ELEMENTS` closes at column zero and `NODE_VIEWS` inside a
    // `Readonly<...>` type argument, so their entries sit at different indents.
    // A single fixed width silently reads one of them as empty.
    const source = [
      "const SIMPLE_ELEMENTS: Readonly<Record<string, string>> = {",
      '  paragraph: "p",',
      '  "collapsible-title": "summary",',
      "};",
      "",
      "const NODE_VIEWS: Readonly<",
      "  Record<string, (node: N) => R>",
      "> = {",
      "    heading: node => null,",
      '    "button-group": node => null,',
      "  };",
    ].join("\n");
    expect([...renderedTypes(source)].sort()).toEqual([
      "button-group",
      "collapsible-title",
      "heading",
      "paragraph",
    ]);
  });

  it("ignores a key NESTED inside a dispatch callback", () => {
    /*
     * The dangerous direction. A local object inside a handler — a style, a
     * lookup, an attribute map — carries properties, and one named like a node
     * type would be recorded as rendered while no top-level handler for it
     * exists. The check would then certify exactly the gap it was built to
     * catch.
     *
     * Population first: the top-level key in the SAME fixture must still be
     * found, or a parser that reads nothing at all passes this.
     */
    const source = [
      "const NODE_VIEWS: Readonly<Record<string, F>> = {",
      "  heading: node => {",
      "    const style = {",
      '      image: "not a handler",',
      '      gallery: "also not a handler",',
      "    };",
      "    return style;",
      "  },",
      "};",
    ].join("\n");
    const found = renderedTypes(source);
    expect(found.has("heading")).toBe(true);
    expect(found.has("image")).toBe(false);
    expect(found.has("gallery")).toBe(false);
  });

  it("stops at the table's own closing brace", () => {
    // A slice running past the end sweeps in the next object's keys and reports
    // them as rendered types.
    const source = [
      "const NODE_VIEWS: Readonly<Record<string, F>> = {",
      "  heading: node => null,",
      "};",
      "",
      "const SOMETHING_ELSE = {",
      "  notatype: 1,",
      "};",
    ].join("\n");
    expect([...renderedTypes(source)]).toEqual(["heading"]);
  });

  it("reports nothing for a table that is not there", () => {
    // A renamed table must read as EMPTY rather than throwing, so the
    // population guard reports it as a read failure rather than the run dying
    // with a stack trace nobody attributes to a rename.
    expect([...renderedTypes("const OTHER = { a: 1 };\n")]).toEqual([]);
  });
});

describe("the published renderer covers the editor's node types", () => {
  const editor = editorNodeTypes();
  const drawn = renderedTypes(readFileSync(RENDERER, "utf8"));

  it("reads both sides, so a silent failure cannot pass this", () => {
    /*
     * The population before the property, and it is the whole risk: this
     * compares two lists it OBTAINED, and an empty one satisfies every coverage
     * assertion below by having nothing to contradict. A renamed table, a moved
     * renderer file, or a registration that stopped exporting all produce
     * exactly that.
     *
     * Named identities rather than counts, because a count agrees with a read
     * that dropped one type and gained another. `tablecell` is named
     * deliberately: it comes from Lexical rather than from a class defined
     * here, and it is the case a source-scanning version of this check could
     * not see at all.
     */
    expect(editor).toContain("image");
    expect(editor).toContain("tablecell");
    expect(editor).toContain("list");
    expect(editor.length).toBeGreaterThanOrEqual(15);

    expect(drawn.has("paragraph")).toBe(true);
    expect(drawn.has("tablecell")).toBe(true);
    expect(drawn.size).toBeGreaterThan(10);
  });

  it("draws every type the editor can produce, or declares why not", () => {
    const missing = editor
      .filter(type => !drawn.has(type))
      .filter(type => !Object.hasOwn(DECLARED_UNRENDERED, type));

    expect(missing).toEqual([]);
  });

  it("keeps no declaration for a type that is now drawn", () => {
    // A declaration left behind after its type started rendering is a standing
    // note that the page drops something it does not, and the next reader takes
    // it at face value.
    expect(Object.keys(DECLARED_UNRENDERED).filter(t => drawn.has(t))).toEqual(
      []
    );
  });

  it("keeps no declaration for a type the editor cannot produce", () => {
    // And a declaration naming a type that no longer exists is a reason nobody
    // can check, kept alive by nothing looking at it.
    const types = new Set(editor);
    expect(
      Object.keys(DECLARED_UNRENDERED).filter(type => !types.has(type))
    ).toEqual([]);
  });
});

/**
 * A `"a" | "b"` union's members, from the type this package declares.
 *
 * Read from SOURCE because a union has no runtime form to ask. That is the
 * whole reason a check is needed rather than a shared import: the renderer
 * cannot reach these types at build time either.
 */
function unionMembers(source: string, name: string): string[] {
  const match = new RegExp(`export type ${name} =([^;]+);`).exec(source);
  if (match?.[1] === undefined) return [];
  return [...match[1].matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1] ?? "");
}

/** A `const X = ["a", "b"] as const;` array's members, from the renderer. */
function constMembers(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source);
  if (match?.[1] === undefined) return [];
  return [...match[1].matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1] ?? "");
}

describe("richTextValueVocabulariesAgree", () => {
  const renderer = readFileSync(RENDERER, "utf8");
  const buttonSource = readFileSync(join(HERE, "ButtonLinkNode.tsx"), "utf8");

  it("reads both sides, so an empty parse cannot pass this", () => {
    // The population, and the risk: a renamed type or a reformatted array
    // yields an empty list, and two empty lists agree perfectly.
    expect(unionMembers(buttonSource, "ButtonLinkVariant")).toContain("filled");
    expect(constMembers(renderer, "BUTTON_VARIANTS").length).toBeGreaterThan(1);
  });

  it.each([
    ["ButtonLinkVariant", "BUTTON_VARIANTS", ["ButtonLinkNode.tsx"]],
    ["ButtonLinkSize", "BUTTON_SIZES", ["ButtonLinkNode.tsx"]],
    // BOTH files, because both DECLARE this union independently and both
    // serialise it. Read from one only, a group vocabulary that gained a value
    // the single-button type never did would leave this green while the
    // renderer quietly fell back to `center` for every node carrying it.
    [
      "ButtonAlignment",
      "BUTTON_ALIGNMENTS",
      ["ButtonLinkNode.tsx", "ButtonGroupNode.tsx"],
    ],
  ])(
    "the renderer's %s allowlist is the editor's own",
    (type, constant, files) => {
      /*
       * The renderer restates these because it may not import this package. A
       * restatement that drifts does not fail loudly: the value passes `oneOf`,
       * takes the fallback, and the page draws an appearance the author never
       * chose — which is exactly what a `primary | secondary | outline | ghost`
       * list did to every default `filled` button.
       */
      // Every declaring file's members, unioned: a value either file offers is
      // one the renderer can be handed.
      const declared = new Set(
        files.flatMap(file =>
          unionMembers(readFileSync(join(HERE, file), "utf8"), type)
        )
      );
      // The population, per pair rather than once: a file that stopped
      // declaring this union yields an empty set, and two empty sets agree.
      expect(declared.size).toBeGreaterThan(1);
      expect([...constMembers(renderer, constant)].sort()).toEqual(
        [...declared].sort()
      );
    }
  );
});
