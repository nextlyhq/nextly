/**
 * The editor and the published renderer must know the same node types.
 *
 * The admin registers Lexical nodes an author can insert; `blocks-react` draws
 * the stored result on a page. Nothing connects the two lists, and the gap is
 * SILENT in the worst possible direction: a node the renderer does not know
 * takes the unknown-node fallback, which descends into `children` — and every
 * media node keeps its content in its OWN fields, so it renders as nothing at
 * all. The author sees the image in the editor, the visitor sees a blank space,
 * and no test, type or log anywhere reports a loss.
 *
 * That happened to five node types at once. This exists so the sixth is a
 * failing check rather than a bug report from someone's live site.
 *
 * ## Why this lives in `scripts/`
 *
 * Neither package can see the other. `blocks-react`'s layering test forbids it
 * from importing the admin, and the admin does not depend on `blocks-react`, so
 * there is no package a test importing BOTH could live in. A static read of the
 * two source files is the only position from which the question is askable.
 *
 * It reads SOURCE rather than importing, for the same reason: importing the
 * admin's node modules would pull Lexical and React into a script test, and
 * importing the renderer's tables would need them exported for no other reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the admin defines the Lexical nodes an author can insert. */
const EDITOR_NODES = join(
  ROOT,
  "packages/admin/src/components/features/entries/fields/special"
);

/** Where the published page decides what a stored node draws as. */
const RENDERER = join(ROOT, "packages/blocks-react/src/rich-text.tsx");

/**
 * Types the renderer knowingly does not draw, and why.
 *
 * An entry here is a DECISION, not a todo: it says someone looked at this type
 * and concluded the page should render nothing for it. Adding one is how the
 * check is meant to be satisfied when rendering is genuinely not the answer —
 * deleting the check, or widening the parse until the type disappears, is not.
 */
const DECLARED_UNRENDERED = {
  video:
    "Needs the provider -> embed-URL derivation, which lives in the admin " +
    "(getEmbedUrl) and cannot be imported here: blocks-react is forbidden to " +
    "import the admin, and re-deriving it in the renderer would be a second " +
    "implementation of one question. Sharing it means giving the admin a " +
    "dependency on blocks-engine, which it does not have today — a decision " +
    "worth taking on its own rather than inside a rendering fix.",
};

/**
 * Every node type the editor can produce, read from `static getType()`.
 *
 * `getType()` is the authoritative answer rather than the class name or the
 * file name: it is the string Lexical serialises, so it is the string that
 * reaches storage and therefore the renderer. `ImageNode` reaching a page as
 * `"image"` is a fact only this method states.
 */
export function typesDeclaredIn(source) {
  // The return may sit on the method's own line or the line below it, so the
  // match spans both rather than assuming a formatter's choice.
  return [
    ...source.matchAll(
      /static\s+getType\s*\(\s*\)[^{]*\{\s*return\s+"([a-z0-9-]+)"/g
    ),
  ].map(match => match[1]);
}

/** The same question over a directory of node files. */
export function editorNodeTypes(directory) {
  return readdirSync(directory)
    .filter(entry => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .flatMap(entry =>
      typesDeclaredIn(readFileSync(join(directory, entry), "utf8")).map(
        type => ({ type, file: entry })
      )
    );
}

/**
 * Every node type the renderer draws, read from its two dispatch tables.
 *
 * Both tables, because they are two halves of one answer: `SIMPLE_ELEMENTS` is
 * the types that are an element around their children and `NODE_VIEWS` the ones
 * that are more, and a type in either is drawn. Reading one would report the
 * other's types as missing.
 */
/** One table's entry keys, or nothing when the table is not there. */
function keysOfTable(source, table) {
  const start = source.indexOf(`const ${table}`);
  if (start === -1) return [];
  // To the end of the object literal. The two tables close at DIFFERENT
  // indents — one at column zero, one nested inside a `Readonly<...>` type
  // argument — so both closers are looked for and the nearer one wins.
  const closers = ["\n};", "\n  };"]
    .map(closer => source.indexOf(closer, start))
    .filter(at => at !== -1);
  const end = closers.length === 0 ? source.length : Math.min(...closers);
  // Two to six spaces: entry indentation differs between the tables, and a
  // fixed width silently reads one of them as empty.
  return [
    ...source
      .slice(start, end)
      .matchAll(/\n\s{2,6}(?:"([a-z0-9-]+)"|([a-z0-9-]+)):/g),
  ].map(match => match[1] ?? match[2]);
}

export function renderedTypes(source) {
  return new Set(
    ["SIMPLE_ELEMENTS", "NODE_VIEWS"].flatMap(table =>
      keysOfTable(source, table)
    )
  );
}

describe("the parsers this check is built from", () => {
  /*
   * The check above compares two lists it PARSED, so these two functions ARE
   * the check: a regex that reads a form its subject does not use reports an
   * empty list, and an empty list satisfies every coverage assertion by having
   * nothing to contradict. The population guard catches that at the real
   * sources; these cover the readers themselves, on inputs whose answer is
   * known, including the shapes that have already been got wrong once.
   */
  it("reads a type whether the return shares the brace's line or not", () => {
    const inline = `class A { static getType(): string { return "image"; } }`;
    const wrapped = [
      "class B {",
      "  static getType(): string {",
      '    return "button-link";',
      "  }",
      "}",
    ].join("\n");
    expect(typesDeclaredIn(inline)).toEqual(["image"]);
    expect(typesDeclaredIn(wrapped)).toEqual(["button-link"]);
  });

  it("reads every class in one file, not just the first", () => {
    // Three of the editor's node types share a single file, so stopping at the
    // first match would report the other two as unhandled — or, once declared,
    // as declarations for types the editor cannot produce.
    const source = [
      'class C { static getType() { return "collapsible-container"; } }',
      'class T { static getType() { return "collapsible-title"; } }',
      'class N { static getType() { return "collapsible-content"; } }',
    ].join("\n");
    expect(typesDeclaredIn(source)).toEqual([
      "collapsible-container",
      "collapsible-title",
      "collapsible-content",
    ]);
  });

  it("finds nothing in a file that declares no node", () => {
    // The negative half. A reader that matched something here would report
    // phantom types and send the check hunting for renderers that need not
    // exist.
    expect(typesDeclaredIn("export const x = 1;\n")).toEqual([]);
  });

  it("reads BOTH renderer tables, which are indented differently", () => {
    /*
     * The failure this had when it was written: a fixed four-space match read
     * `SIMPLE_ELEMENTS` — indented two — as empty, so every type it holds
     * looked unhandled. Both indents are asserted here because that is the
     * property, not the number of spaces.
     */
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

  it("stops at the table's own closing brace", () => {
    // A slice running past the end would sweep in whatever object came next and
    // report its keys as rendered types — a coverage claim for a table that
    // never mentioned them.
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
    // population guard reports it as a parse failure rather than the run dying
    // with a stack trace nobody attributes to a rename.
    expect([...renderedTypes("const OTHER = { a: 1 };\n")]).toEqual([]);
  });
});

describe("the published renderer covers the editor's node types", () => {
  const editor = editorNodeTypes(EDITOR_NODES);
  const drawn = renderedTypes(readFileSync(RENDERER, "utf8"));

  it("reads both sides, so a silent parse failure cannot pass this", () => {
    /*
     * The population before the property, and it is the whole risk here: this
     * check compares two lists it PARSED, and a regex that matched nothing
     * yields an empty editor list which satisfies every coverage assertion
     * below by having nothing to contradict. A renamed directory, a formatter
     * changing where `return` sits, or a table renamed all produce exactly
     * that.
     *
     * Named identities rather than counts, because a count agrees with a parse
     * that dropped one type and invented another.
     */
    const types = editor.map(entry => entry.type);
    expect(types).toContain("image");
    expect(types).toContain("button-link");
    expect(types.length).toBeGreaterThanOrEqual(5);

    expect(drawn.has("paragraph")).toBe(true);
    expect(drawn.has("heading")).toBe(true);
    expect(drawn.size).toBeGreaterThan(10);
  });

  it("draws every type the editor can produce, or declares why not", () => {
    const missing = editor
      .filter(entry => !drawn.has(entry.type))
      .filter(entry => !Object.hasOwn(DECLARED_UNRENDERED, entry.type))
      .map(entry => `${entry.type} (${entry.file})`);

    expect(missing).toEqual([]);
  });

  it("keeps no declaration for a type that is now drawn", () => {
    /*
     * The other direction. A declaration left behind after its type started
     * rendering is a standing note that the page drops something it does not,
     * and the next reader takes it at face value — the same drift as a comment
     * describing code that has moved on.
     */
    const stale = Object.keys(DECLARED_UNRENDERED).filter(type =>
      drawn.has(type)
    );
    expect(stale).toEqual([]);
  });

  it("keeps no declaration for a type the editor cannot produce", () => {
    // And a declaration naming a type that no longer exists is a reason nobody
    // can check, kept alive by nothing looking at it.
    const types = new Set(editor.map(entry => entry.type));
    const orphaned = Object.keys(DECLARED_UNRENDERED).filter(
      type => !types.has(type)
    );
    expect(orphaned).toEqual([]);
  });
});
