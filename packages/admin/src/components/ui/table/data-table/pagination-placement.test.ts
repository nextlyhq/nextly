/**
 * A list's pager belongs to its table, not beside it.
 *
 * `DataTableView` takes a `footer` for exactly this. Rendering the pager there
 * mounts it ONCE, so a stateful control keeps stable ids, and places it
 * correctly for whichever of the two views is showing — inside the card on
 * desktop, in the column's gap on mobile. `DataTableView` is the only component
 * that knows which view that is: a wrapper would have to ask a second container
 * query, and its box is wider by the card's border, so the two disagree across
 * a two-pixel band.
 *
 * Rendered as a SIBLING instead, the pager sits outside that decision entirely.
 * It looked fine because on desktop the difference is a few pixels of padding,
 * which is why eight surfaces drifted into it while four used `footer`.
 *
 * A comment could not hold this. The correct call and the wrong one are the
 * same two components in the same file, a few lines apart, and the wrong one is
 * what you get by writing the markup in reading order. So it is asserted over
 * the source — and asserted by PARSING it, because the earlier generation of
 * source checks in this repo were regexes that each missed a valid spelling
 * until they were rewritten onto the compiler's own AST.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adminSrc = resolve(here, "../../../..");
const repo = resolve(adminSrc, "../../..");

const TABLE = "DataTableView";
const PAGER = "Pagination";

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (extname(full) === ".tsx") found.push(full);
  }
  return found;
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
}

function tagNameOf(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(file);
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(file);
  return undefined;
}

/**
 * Components that take a `footer` and hand it straight to a `DataTableView`.
 *
 * A short list rather than an open rule, because "some component has a prop
 * called footer" says nothing about where that prop lands. Each entry is
 * verified against its own source by the test below, so an entry that stops
 * forwarding fails rather than quietly continuing to excuse its callers.
 */
const FORWARDS_FOOTER = new Map<string, string>([
  [
    "MediaListView",
    "packages/admin/src/components/features/media-library/MediaListView/index.tsx",
  ],
]);

/**
 * Whether this element sits inside the `footer` of something that is, or feeds,
 * a `DataTableView`.
 *
 * The attribute NAME alone is not enough. `<Panel footer={<Pagination />}>` has
 * a footer attribute and puts the pager exactly where this check exists to
 * prevent — outside the table's responsive surface — so the owning ELEMENT is
 * what decides, and the name is only how the attribute is found.
 *
 * Walked up the parent chain rather than inferred from position, because a
 * pager inside `footer` and a pager rendered next to the table are siblings in
 * the source text and differ only in what encloses them.
 */
function insideTableFooter(node: ts.Node, file: ts.SourceFile): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isJsxAttribute(current)) continue;
    if (current.name.getText(file) !== "footer") continue;
    // JsxAttribute -> JsxAttributes -> the opening or self-closing element.
    const owner = current.parent?.parent;
    if (!owner) return false;
    const tag = tagNameOf(owner, file) ?? ownerTagName(owner, file);
    return tag === TABLE || (tag !== undefined && FORWARDS_FOOTER.has(tag));
  }
  return false;
}

/** The tag of an opening/self-closing element node reached from an attribute. */
function ownerTagName(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText(file);
  }
  return undefined;
}

/** Every `<Pagination>` in a file that is NOT inside a `footer` attribute. */
function detachedPagers(file: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (tagNameOf(node, file) === PAGER && !insideTableFooter(node, file)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function rendersTable(file: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (tagNameOf(node, file) === TABLE) found = true;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function lineOf(node: ts.Node, file: ts.SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

const sources = walk(adminSrc).filter(
  path =>
    !/\.test\.tsx$/.test(path) && readFileSync(path, "utf8").includes(PAGER)
);

/**
 * Surfaces that render a pager for something other than a `DataTableView`.
 *
 * This list is the ONLY thing that excuses a pager from the rule. The tempting
 * alternative — skip any file with no `DataTableView` in it — is wrong for the
 * exact reason this list exists: "no table in this file" is also what a
 * detached pager looks like the moment someone extracts the table into a child
 * component and leaves the pager behind in the parent. That refactor is the
 * likeliest way the rule gets broken, and a table-presence gate is blind to
 * precisely it.
 *
 * So every pager outside this list is checked, whether or not a table is
 * visible beside it. Each entry states what it paginates instead.
 */
const NOT_A_TABLE_PAGER = new Map<string, string>([
  [
    "packages/admin/src/components/shared/pagination/index.tsx",
    "the Pagination component itself",
  ],
  [
    "packages/admin/src/components/features/media-library/index.tsx",
    "the GRID view's pager; a grid has no row-versus-card view to place one " +
      "for. The list view's pager goes into MediaListView as the table footer",
  ],
  [
    "packages/admin/src/pages/dashboard/users/fields/index.tsx",
    "a card list of user fields, with no table on the page",
  ],
]);

describe("list pagination", () => {
  it("finds the surfaces at all", () => {
    // Both assertions below are vacuously true over an empty scan, so a moved
    // directory has to fail here rather than reporting a clean run.
    expect(sources.length).toBeGreaterThan(5);
    expect(
      sources.filter(path =>
        rendersTable(parse(path, readFileSync(path, "utf8")))
      ).length
    ).toBeGreaterThan(5);
  });

  it("tells a footer pager from a detached one", () => {
    // The two forms are a few lines apart in the source and differ only in the
    // enclosing attribute, so the reader is exercised on both rather than
    // trusted. A check that reported zero because it recognised neither would
    // look identical to a clean run.
    const detached = parse(
      "control.tsx",
      "const x = (<><DataTableView columns={c} rows={r} /><Pagination page={1} /></>);"
    );
    expect(detachedPagers(detached)).toHaveLength(1);

    const inFooter = parse(
      "control.tsx",
      "const x = <DataTableView columns={c} rows={r} footer={<Pagination page={1} />} />;"
    );
    expect(detachedPagers(inFooter)).toHaveLength(0);

    // Nested inside a conditional within the footer, which is how every real
    // call site that gates on loaded data writes it.
    const gated = parse(
      "control.tsx",
      "const x = <DataTableView columns={c} rows={r} footer={data ? <Pagination page={1} /> : undefined} />;"
    );
    expect(detachedPagers(gated)).toHaveLength(0);

    // A `footer` on something that is NOT the table puts the pager exactly
    // where this check exists to prevent, so the attribute name alone must not
    // satisfy it.
    const wrongOwner = parse(
      "control.tsx",
      "const x = <Panel footer={<Pagination page={1} />}><DataTableView columns={c} rows={r} /></Panel>;"
    );
    expect(detachedPagers(wrongOwner)).toHaveLength(1);

    // A component that forwards `footer` straight to the table does satisfy it,
    // and the forwarding is verified against its own source below rather than
    // taken on the strength of the prop's name.
    const forwarded = parse(
      "control.tsx",
      "const x = <MediaListView media={m} footer={<Pagination page={1} />} />;"
    );
    expect(detachedPagers(forwarded)).toHaveLength(0);
  });

  it("renders every list pager inside its table", () => {
    // No table-presence gate. A pager whose table lives in a child component
    // is exactly the case worth catching, and it is indistinguishable from a
    // page that legitimately paginates something else -- which is why the
    // exemption list names those four rather than inferring them.
    const detached: string[] = [];
    for (const path of sources) {
      const relativePath = relative(repo, path);
      if (NOT_A_TABLE_PAGER.has(relativePath)) continue;
      const file = parse(path, readFileSync(path, "utf8"));
      for (const pager of detachedPagers(file)) {
        detached.push(`${relativePath}:${lineOf(pager, file)}`);
      }
    }

    expect(
      detached.sort(),
      `These render <Pagination> outside a \`footer\`. A detached pager is ` +
        `mounted per view rather than once, and sits outside the responsive ` +
        `decision only DataTableView can make, so it lands in the wrong place ` +
        `on one of the two layouts. Pass it as DataTableView's \`footer\`; if ` +
        `this page paginates something that is not a table, add it to ` +
        `NOT_A_TABLE_PAGER with what it paginates:\n${detached.join("\n")}`
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An entry that no longer exists is a standing permission for the thing
    // this check exists to prevent. Two of the original four entries carried
    // reasons that were simply untrue -- one claimed a component passed its
    // pager to `footer` when it rendered it as a sibling -- and a per-entry
    // escape hatch in this loop is what stopped that being caught here. There
    // is no escape hatch now: every exempt path is checked the same way.
    for (const [path, reason] of NOT_A_TABLE_PAGER) {
      const full = resolve(repo, path);
      expect(
        sources.includes(full),
        `exempt path no longer renders a pager: ${path}`
      ).toBe(true);
      const file = parse(full, readFileSync(full, "utf8"));
      expect(
        rendersTable(file),
        `${path} now renders a DataTableView, so "${reason}" no longer holds`
      ).toBe(false);
    }
  });

  it("verifies every forwarding component actually forwards", () => {
    // `FORWARDS_FOOTER` excuses a pager placed on something other than the
    // table, so an entry that stops forwarding would silently keep excusing
    // its callers. Checked against the component's own source: it must both
    // render a DataTableView and pass `footer` to it.
    for (const [component, path] of FORWARDS_FOOTER) {
      const file = parse(
        resolve(repo, path),
        readFileSync(resolve(repo, path), "utf8")
      );
      expect(
        rendersTable(file),
        `${component} no longer renders a DataTableView`
      ).toBe(true);

      let forwards = false;
      const visit = (node: ts.Node): void => {
        if (
          tagNameOf(node, file) === TABLE &&
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        ) {
          for (const property of node.attributes.properties) {
            if (
              ts.isJsxAttribute(property) &&
              property.name.getText(file) === "footer"
            ) {
              forwards = true;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);

      expect(
        forwards,
        `${component} takes a footer but no longer passes one to DataTableView`
      ).toBe(true);
    }
  });
});
