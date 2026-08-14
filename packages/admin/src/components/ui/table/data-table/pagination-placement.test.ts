/**
 * A list's pager belongs to its table, not beside it.
 *
 * `DataTableView` takes a `footer` for exactly this. Rendering the pager there
 * places it for whichever of the two views is showing — inside the card on
 * desktop, in the column's gap on mobile. `DataTableView` is the only component
 * that knows which view that is: a wrapper would have to ask a second container
 * query, and its box is wider by the card's border, so the two disagree across
 * a two-pixel band.
 *
 * Rendered as a SIBLING instead, the pager sits outside that decision entirely.
 * The rule is about PLACEMENT and only placement: a sibling pager is a single
 * element too, so moving it into `footer` changes where it lands, not how many
 * times it mounts. It looked fine because on desktop the difference is a few
 * pixels of padding, which is how surfaces drifted into it.
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

/**
 * The tag a JSX node names, whichever of the three node kinds it is.
 *
 * One extractor for one question. An element reached by walking DOWN the tree
 * is a `JsxElement` or a self-closing one; an element reached UP from an
 * attribute is the `JsxOpeningElement` inside it. Answering those with two
 * functions means a future change to aliases or qualified names can teach one
 * of them and not the other, and equivalent syntax then classifies differently
 * depending on which direction the walk arrived from.
 */
function tagNameOf(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    return node.tagName.getText(file);
  }
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(file);
  return undefined;
}

/**
 * Whether this node is one ELEMENT OCCURRENCE, for a walk going down the tree.
 *
 * Separate from `tagNameOf` because it answers a different question, and the
 * difference is load-bearing: `<Pagination></Pagination>` is a `JsxElement`
 * that CONTAINS a `JsxOpeningElement`, so a downward walk that counted every
 * node with a tag would count that pager twice, and an exemption naming it
 * once would then report a surplus that is not there.
 */
function isElementOccurrence(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

/**
 * The local names a file binds `Pagination` to, including through an alias or a
 * namespace.
 *
 * A JSX tag is a BINDING, not a spelling. `import { Pagination as Pager }` still
 * puts the word `Pagination` in the file — so the file stays in `sources` and
 * looks scanned — while every tag reads `Pager` and matches nothing. An import
 * refactor would have disabled this guard silently, with the file counts
 * unchanged because the other surfaces are still there.
 */
function localNamesOf(exported: string, file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  let rebound = false;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.${exported}`);
      continue;
    }
    for (const element of bindings.elements) {
      // `propertyName` is set only when aliased, and then holds the EXPORTED
      // name while `name` holds the local one.
      if ((element.propertyName ?? element.name).text === exported) {
        names.add(element.name.text);
      }
      if (element.name.text === exported) rebound = true;
    }
  }
  // The component's own module declares rather than imports it, and a control
  // fixture may have no imports, so the bare name counts unless something has
  // bound that name to a different export.
  if (!rebound) names.add(exported);

  // A LOCAL alias binds the component too. `const Pager = Pagination` renders
  // `<Pager />`, and a set built only from imports does not contain it — so the
  // scan walked straight past a detached pager. Resolved transitively, because
  // `const A = Pagination; const B = A` is the same binding twice removed, and
  // it terminates: each pass can only add names already reachable, so the set
  // stops growing.
  for (let added = true; added; ) {
    added = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        !names.has(node.name.text) &&
        // An identifier OR a namespace access. `const Pager = Shared.Pagination`
        // binds the component exactly as `const Pager = Pagination` does, and
        // the namespace form is the one a barrel import produces — so reading
        // only bare identifiers missed the spelling this file already tracks
        // for tags.
        (ts.isIdentifier(node.initializer) ||
          ts.isPropertyAccessExpression(node.initializer)) &&
        names.has(node.initializer.getText(file))
      ) {
        names.add(node.name.text);
        added = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return names;
}

/**
 * Whether a tag names a component, resolved through this file's imports.
 *
 * Every tag this check reasons about goes through here — the pager, the table,
 * and the components that forward a footer. Resolving only the pager was an
 * asymmetry rather than a decision: an aliased `import { DataTableView as
 * Table }` left a correctly placed pager looking detached, because the owner
 * of its `footer` was matched by spelling while the pager itself was matched
 * by binding.
 */
function tagIs(
  tag: string | undefined,
  exported: string,
  file: ts.SourceFile
): boolean {
  return tag !== undefined && localNamesOf(exported, file).has(tag);
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
    if (!owner) continue;
    const tag = tagNameOf(owner, file);
    const forwards = [...FORWARDS_FOOTER.keys()].some(component =>
      tagIs(tag, component, file)
    );
    if (tagIs(tag, TABLE, file) || forwards) {
      return true;
    }
    // Keep climbing rather than answering on the FIRST footer found. A valid
    // composition can nest one inside another -- `<DataTableView footer={
    // <Panel footer={<Pagination />} />} />` reaches the panel's attribute
    // first -- and stopping there rejects a pager that is genuinely inside the
    // table's footer. Only running out of ancestors is a no.
  }
  return false;
}

/**
 * The `ariaLabel` a pager element carries, when it is a literal.
 *
 * This is how an exempt pager is IDENTIFIED. A position in a count is not an
 * identity: two pagers on one page can be prop-identical, so "the first
 * detached one is allowed" excuses whichever pager happens to come first, and
 * a change that deletes the exempt pager and detaches a different one leaves
 * the count unmoved and every assertion green.
 *
 * A label is not merely a convenient key either — a pager announces itself to
 * a screen reader with it, so two on one page need distinct ones regardless of
 * this check.
 */
function ariaLabelOf(node: ts.Node, file: ts.SourceFile): string | undefined {
  const attributes = ts.isJsxSelfClosingElement(node)
    ? node.attributes
    : ts.isJsxElement(node)
      ? node.openingElement.attributes
      : undefined;
  if (!attributes) return undefined;
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    if (property.name.getText(file) !== "ariaLabel") continue;
    const initializer = property.initializer;
    if (initializer === undefined) return undefined;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    // `ariaLabel={"..."}` is the same value with different punctuation, and a
    // reader that accepted only one spelling would report the other as
    // unlabelled -- which reads as a finding rather than as a missed one.
    if (
      ts.isJsxExpression(initializer) &&
      initializer.expression !== undefined &&
      ts.isStringLiteralLike(initializer.expression)
    ) {
      return initializer.expression.text;
    }
    return undefined;
  }
  return undefined;
}

/**
 * The variable a pager was extracted into, when it was.
 *
 * `const pager = <Pagination ... />` then `footer={pager}` is a behaviour-
 * preserving refactor, and a walk up from the DECLARATION finds no `footer`
 * ancestor — so judging it there rejects correct code. Judging it nowhere is
 * the other error: it blesses `const pager = ...` followed by a sibling
 * `{pager}`, which is the defect this suite exists for wearing a variable name.
 *
 * So the declaration is not the place to answer, and the answer is not
 * "unknown" either: the identifier's USES are where the pager actually lands,
 * and within one file they can be found exactly.
 */
function extractedName(node: ts.Node, file: ts.SourceFile): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    // A JSX ATTRIBUTE settles it: the pager is written into a prop, so it is
    // already at its destination and `insideTableFooter` can judge it there.
    if (ts.isJsxAttribute(current)) return undefined;

    // Enclosing markup does NOT settle it, whatever kind. `const footer =
    // <div><Pagination /></div>` and `const footer = <><Pagination /></>` are
    // the same composition refactor with different wrappers, and stopping at
    // either reports a correctly placed pager. Two rounds went on adding
    // wrapper kinds here; the walk simply continues now, so there is no list
    // of accepted wrappers to keep up with.
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      // What DOES settle it is whether the name is rendered somewhere this
      // file can see. `const footer = ...` passed as `footer={footer}` is
      // judged at that use; `const page = (<><DataTableView /><Pagination />
      // </>)` is a whole page's markup, returned rather than rendered, with no
      // use to judge — so it is judged where it stands.
      return jsxUsesOf(current.name.text, file, current).length > 0
        ? current.name.text
        : undefined;
    }
    // A pager assigned into a property rather than a plain variable travels
    // through the object, which this does not follow. Reported at the
    // declaration so it is visible rather than silently excused.
    if (ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current)) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Every place a name is rendered into JSX, as `{name}` or `prop={name}`.
 *
 * Scoped to the file on purpose. A value exported and rendered elsewhere is not
 * followed, and that boundary is real rather than convenient: these pagers are
 * local to their page, and resolving across modules is the unbounded surface
 * this repo's earlier source checks lost to.
 */
function jsxUsesOf(
  name: string,
  file: ts.SourceFile,
  declaration?: ts.Node
): ts.Node[] {
  // Searched within the declaration's own SCOPE, not the whole file. A name
  // like `pager` occurs in more than one component in a real page, and a
  // file-wide text match attributes every occurrence to this declaration — so
  // a correctly placed `footer={pager}` was reported as detached because some
  // unrelated child rendered its own `pager` prop as a sibling.
  //
  // The enclosing function is the scope that matters here: these are consts
  // inside a component body, and a name declared in one component body is not
  // visible in another. A declaration at module level falls back to the file,
  // which is its scope.
  const root = declaration ? (enclosingScope(declaration) ?? file) : file;
  const uses: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    // A nested function that binds the same name SHADOWS this declaration, so
    // its uses belong to that one. Descending into it attributed a helper's own
    // `pager` to the outer const and reported a correctly placed footer.
    if (node !== root && isScope(node) && declaresName(node, name)) return;
    if (ts.isIdentifier(node) && node.text === name && inJsxExpression(node)) {
      uses.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return uses;
}

function isScope(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Whether a function binds `name` itself, as a parameter or as a local. */
function declaresName(scope: ts.Node, name: string): boolean {
  for (const parameter of (scope as ts.SignatureDeclaration).parameters ?? []) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
      return true;
    }
    // A destructured prop binds too: `({ pager }) => ...` declares it.
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        if (ts.isIdentifier(element.name) && element.name.text === name) {
          return true;
        }
      }
    }
  }
  let declares = false;
  const look = (node: ts.Node): void => {
    if (node !== scope && isScope(node)) return; // deeper scopes own their names
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      declares = true;
    }
    ts.forEachChild(node, look);
  };
  look(scope);
  return declares;
}

/**
 * The function body a node sits in, or undefined at module level.
 *
 * Asks `isScope` rather than restating its list, so "what counts as a scope"
 * has one answer. Two copies would drift the moment a node kind is added to
 * one of them, and the drift is silent: uses would be collected from a scope
 * that shadowing no longer skips.
 */
function enclosingScope(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (isScope(current)) {
      return current;
    }
  }
  return undefined;
}

/**
 * Whether an identifier is rendered from inside a JSX expression, at any depth.
 *
 * The IMMEDIATE parent is not enough. `{show && pager}` puts a binary
 * expression between the name and the `{...}`, `{cond ? pager : null}` puts a
 * conditional there, and both render the pager exactly as `{pager}` does — so
 * matching only the direct parent finds the plain spelling and misses every
 * gated one, which is how most call sites actually write it.
 */
function inJsxExpression(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxExpression(current)) return true;
    // Stop at the element boundary: past it, any match belongs to a different
    // expression rather than to this one.
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) return false;
  }
  return false;
}

/**
 * A detached pager: WHERE it renders, and WHICH pager it is.
 *
 * Two nodes, because for an extracted pager they are different ones — the use
 * is where it lands and the element is what carries its `ariaLabel`. Returning
 * only the use lost the label, so an exempt pager that someone extracted for
 * readability stopped matching its exemption and was reported. Returning only
 * the element would report the wrong line. Both travel together rather than
 * being recovered from each other later.
 */
interface DetachedPager {
  /** The node to report: the use for an extracted pager, else the element. */
  at: ts.Node;
  /** The `<Pagination>` element itself, wherever it was written. */
  element: ts.Node;
}

/** Every pager in a file that is NOT inside a table's `footer`, found by binding. */
function detachedPagers(file: ts.SourceFile): DetachedPager[] {
  const names = localNamesOf(PAGER, file);
  const found: DetachedPager[] = [];
  const visit = (node: ts.Node): void => {
    const tag = isElementOccurrence(node) ? tagNameOf(node, file) : undefined;
    if (tag !== undefined && names.has(tag)) {
      const name = extractedName(node, file);
      if (name === undefined) {
        // Written in place: judged where it stands.
        if (!insideTableFooter(node, file))
          found.push({ at: node, element: node });
      } else {
        // Extracted: judged at every place the name is rendered. A pager whose
        // uses are all inside a table footer is correctly placed however it was
        // spelled; one used as a sibling is detached however it was spelled.
        // An unused declaration renders nowhere and is reported by neither.
        for (const use of jsxUsesOf(name, file, node)) {
          if (!insideTableFooter(use, file)) {
            found.push({ at: use, element: node });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function rendersTable(file: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      isElementOccurrence(node) &&
      tagIs(tagNameOf(node, file), TABLE, file)
    ) {
      found = true;
    }
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
 * visible beside it. Each entry NAMES the pagers it excuses, by their
 * `ariaLabel`, and states what they paginate instead.
 */
const NOT_A_TABLE_PAGER = new Map<string, { pagers: string[]; reason: string }>(
  [
    [
      "packages/admin/src/components/shared/pagination/index.tsx",
      {
        // Listed as empty rather than omitted: this file is in the scan because
        // it mentions Pagination, and saying it renders none is what stops a
        // future reader adding a permission it never needed.
        pagers: [],
        reason: "the Pagination component's own definition, which renders none",
      },
    ],
    [
      "packages/admin/src/components/features/media-library/index.tsx",
      {
        pagers: ["Media grid pagination"],
        reason:
          "the GRID view's pager; a grid has no row-versus-card view to place " +
          "one for. The list view's pager goes into MediaListView as the table " +
          "footer, and is NOT covered by this entry",
      },
    ],
    [
      "packages/admin/src/pages/dashboard/users/fields/index.tsx",
      {
        pagers: ["User fields pagination"],
        // This page DOES render a table -- a hand-built `<Table>` with its own
        // drag-and-drop reordering, not a DataTableView. The exemption is from
        // the RESPONSIVE rule specifically: there is no row-versus-card view
        // here for a footer to be placed against. It is not licence to detach
        // the pager, which `ENCLOSED_WITH` below pins to its table's wrapper.
        reason:
          "a legacy Table rather than a DataTableView, so there is no " +
          "row-versus-card view to place a pager for",
      },
    ],
  ]
);

/**
 * Exempt pagers that must nonetheless stay inside their table's container.
 *
 * Exemption from the responsive rule is not licence to detach. The user-fields
 * page renders a hand-built `<Table>` inside a `table-wrapper` div that draws
 * the card, with its pager inside the same div — so moving the pager out would
 * put it outside the card, which is the visual defect this suite exists for,
 * on a page the exemption would otherwise excuse entirely.
 *
 * Matched on OUR OWN class name rather than a structural relationship, and the
 * distinction matters: identifying by someone else's spelling is the thing to
 * avoid, but this class is written in this repository, in the file under test.
 * Renaming it fails this assertion loudly rather than silently widening it.
 */
const ENCLOSED_BY = new Map<string, string>([
  [
    "packages/admin/src/pages/dashboard/users/fields/index.tsx",
    "table-wrapper",
  ],
]);

/** Whether some ancestor element of `node` carries `className` containing `marker`. */
function enclosedBy(
  node: ts.Node,
  marker: string,
  file: ts.SourceFile
): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isJsxElement(current)) continue;
    for (const property of current.openingElement.attributes.properties) {
      if (!ts.isJsxAttribute(property)) continue;
      if (property.name.getText(file) !== "className") continue;
      const initializer = property.initializer;
      const text =
        initializer && ts.isStringLiteral(initializer)
          ? initializer.text
          : (initializer?.getText(file) ?? "");
      // Matched as a whitespace-separated TOKEN, never as a substring. Class
      // names nest as prefixes of one another, so `table-wrapper-footer`
      // contains `table-wrapper` and a substring check cannot tell the wrapper
      // that draws the card from something merely named after it — which would
      // pass this assertion for a pager moved out of the card entirely.
      if (text.split(/\s+/).includes(marker)) return true;
    }
  }
  return false;
}

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

    // A tag is a BINDING, not a spelling. An aliased import leaves the word
    // `Pagination` in the file, so it stays in `sources` and looks scanned,
    // while every tag reads `Pager` and matches nothing.
    const aliased = parse(
      "aliased.tsx",
      'import { Pagination as Pager } from "@admin/components/shared/pagination";\n' +
        "const x = (<><DataTableView columns={c} rows={r} /><Pager page={1} /></>);"
    );
    expect(detachedPagers(aliased), "aliased pager").toHaveLength(1);

    const namespaced = parse(
      "namespaced.tsx",
      'import * as Shared from "@admin/components/shared";\n' +
        "const x = (<><DataTableView columns={c} rows={r} /><Shared.Pagination page={1} /></>);"
    );
    expect(detachedPagers(namespaced), "namespaced pager").toHaveLength(1);

    // One pager written with a closing tag is ONE pager. The node carrying the
    // tag and the element containing it are different nodes, and counting both
    // would report a surplus over any exemption naming it once.
    const withChildren = parse(
      "control.tsx",
      "const x = (<><DataTableView columns={c} rows={r} /><Pagination page={1}>{null}</Pagination></>);"
    );
    expect(detachedPagers(withChildren), "paired tags").toHaveLength(1);

    // Extracted for readability and passed as the footer. A walk from the
    // declaration finds no `footer` ancestor, so judging it there would reject
    // a behaviour-preserving refactor.
    const extracted = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = <DataTableView columns={c} rows={r} footer={pager} />;"
    );
    expect(detachedPagers(extracted), "extracted footer").toHaveLength(0);

    // The same shape used as a real sibling IS caught. Judging the declaration
    // would reject the correct form above; judging nothing would bless this
    // one. The uses are what decide, so both come out right.
    const extractedSibling = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = (<><DataTableView columns={c} rows={r} />{pager}</>);"
    );
    expect(
      detachedPagers(extractedSibling),
      "extracted sibling is still detached"
    ).toHaveLength(1);

    // Rendered in both places: the sibling use is reported and the footer use
    // is not, so one declaration yields exactly one finding.
    const extractedBoth = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = (<><DataTableView columns={c} rows={r} footer={pager} />{pager}</>);"
    );
    expect(
      detachedPagers(extractedBoth),
      "only the detached use is reported"
    ).toHaveLength(1);

    // Gated renders. The identifier sits under a binary or conditional
    // expression rather than directly under `{...}`, which is how most real
    // call sites write it -- so matching only the immediate parent would find
    // the plain spelling and miss every one of these.
    const gatedSibling = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = (<><DataTableView columns={c} rows={r} />{show && pager}</>);"
    );
    expect(detachedPagers(gatedSibling), "gated sibling").toHaveLength(1);

    const ternarySibling = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = (<><DataTableView columns={c} rows={r} />{ready ? pager : null}</>);"
    );
    expect(detachedPagers(ternarySibling), "ternary sibling").toHaveLength(1);

    // The same gating inside the footer is correct and stays silent, so the
    // fix cannot have been "report every gated use".
    const gatedFooter = parse(
      "control.tsx",
      "const pager = <Pagination page={1} />;\n" +
        "const x = <DataTableView columns={c} rows={r} footer={show && pager} />;"
    );
    expect(detachedPagers(gatedFooter), "gated footer").toHaveLength(0);

    // Extracted through a FRAGMENT wrapper and passed as the footer. Same
    // composition refactor as the plain variable, one wrapper deeper.
    const fragmentFooter = parse(
      "control.tsx",
      "const footer = <><Pagination page={1} /></>;\n" +
        "const x = <DataTableView columns={c} rows={r} footer={footer} />;"
    );
    expect(detachedPagers(fragmentFooter), "fragment footer").toHaveLength(0);

    // The same fragment shape rendered as a sibling is still caught, so the
    // fix is not "anything in a fragment is excused".
    const fragmentSibling = parse(
      "control.tsx",
      "const footer = <><Pagination page={1} /></>;\n" +
        "const x = (<><DataTableView columns={c} rows={r} />{footer}</>);"
    );
    expect(detachedPagers(fragmentSibling), "fragment sibling").toHaveLength(1);

    // Extracted inside an ORDINARY element wrapper, not a fragment. Same
    // refactor again; the walk no longer stops at any wrapper kind, so there
    // is no list of accepted wrappers to fall behind.
    const divFooter = parse(
      "control.tsx",
      "const footer = <div><Pagination page={1} /></div>;\n" +
        "const x = <DataTableView columns={c} rows={r} footer={footer} />;"
    );
    expect(detachedPagers(divFooter), "element-wrapped footer").toHaveLength(0);

    const divSibling = parse(
      "control.tsx",
      "const footer = <div><Pagination page={1} /></div>;\n" +
        "const x = (<><DataTableView columns={c} rows={r} />{footer}</>);"
    );
    expect(detachedPagers(divSibling), "element-wrapped sibling").toHaveLength(
      1
    );

    // An extracted pager keeps its LABEL. The reported node is the use, which
    // carries no attributes, so reading the label off it returns undefined and
    // an exempt pager stops matching its exemption the moment someone extracts
    // it for readability.
    const labelled = parse(
      "control.tsx",
      'const pager = <Pagination page={1} ariaLabel="Media grid pagination" />;\n' +
        "const x = (<><DataTableView columns={c} rows={r} />{pager}</>);"
    );
    const [extractedLabelled] = detachedPagers(labelled);
    expect(extractedLabelled).toBeDefined();
    expect(
      extractedLabelled && ariaLabelOf(extractedLabelled.element, labelled),
      "label survives extraction"
    ).toBe("Media grid pagination");

    // A LOCAL alias, not an import one. `const Pager = Pagination` binds the
    // component just as an aliased import does, and a set built only from
    // import statements walks straight past it.
    const localAlias = parse(
      "local-alias.tsx",
      'import { Pagination } from "@admin/components/shared/pagination";\n' +
        "const Pager = Pagination;\n" +
        "const x = (<><DataTableView columns={c} rows={r} /><Pager page={1} /></>);"
    );
    expect(detachedPagers(localAlias), "local alias").toHaveLength(1);

    // Two hops. Resolved transitively so a chain does not need a new case.
    const chained = parse(
      "chained-alias.tsx",
      'import { Pagination } from "@admin/components/shared/pagination";\n' +
        "const A = Pagination;\nconst B = A;\n" +
        "const x = (<><DataTableView columns={c} rows={r} /><B page={1} /></>);"
    );
    expect(detachedPagers(chained), "chained alias").toHaveLength(1);

    // A name declared in ANOTHER component's scope is a different binding.
    // Matching uses across the whole file reported this correctly placed pager
    // because an unrelated child renders its own `pager` beside a table.
    const twoScopes = parse(
      "two-scopes.tsx",
      "function List() {\n" +
        "  const pager = <Pagination page={1} />;\n" +
        "  return <DataTableView columns={c} rows={r} footer={pager} />;\n" +
        "}\n" +
        "function Other({ pager }) {\n" +
        "  return (<><DataTableView columns={c} rows={r} />{pager}</>);\n" +
        "}"
    );
    expect(
      detachedPagers(twoScopes),
      "name reused in another scope"
    ).toHaveLength(0);

    // A namespace access aliased locally. `const Pager = Shared.Pagination` is
    // the spelling a barrel import produces, and reading only bare identifiers
    // walked past it.
    const namespaceAlias = parse(
      "ns-alias.tsx",
      'import * as Shared from "@admin/components/shared";\n' +
        "const Pager = Shared.Pagination;\n" +
        "const x = (<><DataTableView columns={c} rows={r} /><Pager page={1} /></>);"
    );
    expect(detachedPagers(namespaceAlias), "namespace alias").toHaveLength(1);

    // A NESTED scope that binds the same name owns its own uses. Attributing a
    // helper's `pager` to the outer declaration reported a correctly placed
    // footer as detached.
    const shadowed = parse(
      "shadowed.tsx",
      "function List() {\n" +
        "  const pager = <Pagination page={1} />;\n" +
        "  const Row = ({ pager }) => (<><DataTableView columns={c} rows={r} />{pager}</>);\n" +
        "  return <DataTableView columns={c} rows={r} footer={pager} />;\n" +
        "}"
    );
    expect(detachedPagers(shadowed), "shadowed in a nested scope").toHaveLength(
      0
    );

    // An ALIASED table import. The pager is matched by binding, so the owner of
    // its footer must be too -- otherwise an import refactor makes a correctly
    // placed pager look detached.
    const aliasedTable = parse(
      "aliased-table.tsx",
      'import { DataTableView as Table } from "@admin/components/ui/table/data-table";\n' +
        "const x = <Table columns={c} rows={r} footer={<Pagination page={1} />} />;"
    );
    expect(detachedPagers(aliasedTable), "aliased table tag").toHaveLength(0);

    // A pager nested inside another component's footer, itself inside the
    // table's footer, is correctly placed. Answering on the FIRST footer found
    // would reject it.
    const nestedFooter = parse(
      "control.tsx",
      "const x = <DataTableView columns={c} rows={r} footer={<Panel footer={<Pagination page={1} />} />} />;"
    );
    expect(
      detachedPagers(nestedFooter),
      "nested inside the table footer"
    ).toHaveLength(0);
  });

  it("reads a pager's label, and reports when there is none", () => {
    // The exemption list matches on this value, so a reader that returned
    // undefined for a spelling in use would report a labelled pager as
    // unlabelled -- a finding against correct code, which is the failure mode
    // that gets a guard deleted rather than fixed.
    const bare = parse(
      "c.tsx",
      '<Pagination ariaLabel="Media grid pagination" />'
    );
    const braced = parse(
      "c.tsx",
      '<Pagination ariaLabel={"Media grid pagination"} />'
    );
    const none = parse("c.tsx", "<Pagination page={1} />");

    for (const [file, expected] of [
      [bare, "Media grid pagination"],
      [braced, "Media grid pagination"],
      [none, undefined],
    ] as const) {
      const [pager] = detachedPagers(file);
      expect(pager).toBeDefined();
      expect(pager && ariaLabelOf(pager.element, file)).toBe(expected);
    }

    // A computed label cannot be matched against the list, so it reads as
    // absent rather than as some string that might accidentally match.
    const computed = parse("c.tsx", "<Pagination ariaLabel={label} />");
    const [dynamic] = detachedPagers(computed);
    expect(dynamic && ariaLabelOf(dynamic.element, computed)).toBeUndefined();
  });

  it("renders every list pager inside its table", () => {
    // No table-presence gate. A pager whose table lives in a child component
    // is exactly the case worth catching, and it is indistinguishable from a
    // page that legitimately paginates something else, so NOT_A_TABLE_PAGER
    // names each exempt surface instead of inferring it.
    const detached: string[] = [];
    for (const path of sources) {
      const relativePath = relative(repo, path);
      const file = parse(path, readFileSync(path, "utf8"));
      // An exemption names PAGERS, not a file and not a count. The media
      // library holds two -- a grid's, which is exempt, and a list's, which
      // belongs in the table's footer -- so excusing the file would excuse the
      // second along with the first, and excusing "one of them" would excuse
      // whichever came first even after the exempt one was deleted.
      const exempt = new Set(NOT_A_TABLE_PAGER.get(relativePath)?.pagers ?? []);
      for (const pager of detachedPagers(file)) {
        // The LABEL comes from the element and the LINE from where it renders.
        // Reading both off the reported node lost the label whenever a pager
        // was extracted, so an exempt one stopped matching its exemption.
        const label = ariaLabelOf(pager.element, file);
        if (label !== undefined && exempt.has(label)) continue;
        detached.push(
          `${relativePath}:${lineOf(pager.at, file)} (${label ?? "no ariaLabel"})`
        );
      }
    }

    expect(
      detached.sort(),
      `These render <Pagination> outside a \`footer\`. A detached pager sits ` +
        `outside the responsive decision only DataTableView can make, so it ` +
        `lands in the wrong place on one of the two layouts. Pass it as ` +
        `DataTableView's \`footer\`; if this page paginates something that is ` +
        `not a table, give the pager an ariaLabel and add it to ` +
        `NOT_A_TABLE_PAGER with what it paginates:\n${detached.join("\n")}`
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An entry that no longer exists is a standing permission for the thing
    // this check exists to prevent, and a stated reason can stop being true.
    // Every exempt path is therefore checked the same way: it must still
    // render a pager, must not render a DataTableView, and its detached pagers
    // must be EXACTLY the ones the entry names.
    for (const [path, { pagers, reason }] of NOT_A_TABLE_PAGER) {
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
      // Matched by name and asserted as a SET, not counted. A file that drops
      // its exempt pager and detaches a different one holds the count still,
      // so a count would go on excusing the replacement; the names do not.
      const found = detachedPagers(file)
        .map(pager => ariaLabelOf(pager.element, file) ?? "no ariaLabel")
        .sort();
      expect(
        found,
        `${path} renders detached pagers [${found.join(", ")}] but is ` +
          `exempted for [${pagers.join(", ")}] (${reason})`
      ).toEqual([...pagers].sort());
    }
  });

  it("reads the enclosing class as a token, not a substring", () => {
    // Class names nest as prefixes of one another, so a substring check cannot
    // tell the wrapper that draws the card from something merely named after
    // it -- and would pass for a pager moved out of the card entirely.
    const inside = parse(
      "c.tsx",
      '<div className="table-wrapper rounded-md"><Pagination page={1} /></div>'
    );
    const [ok] = detachedPagers(inside);
    expect(ok && enclosedBy(ok.at, "table-wrapper", inside)).toBe(true);

    const lookalike = parse(
      "c.tsx",
      '<div className="table-wrapper-footer"><Pagination page={1} /></div>'
    );
    const [moved] = detachedPagers(lookalike);
    expect(moved && enclosedBy(moved.at, "table-wrapper", lookalike)).toBe(
      false
    );
  });

  it("keeps an exempt pager inside its table's container", () => {
    // Without this, the exemption covers placement too: the whole file is
    // excused from the responsive rule, so moving its pager out of the card
    // would leave every other assertion green.
    for (const [path, marker] of ENCLOSED_BY) {
      const full = resolve(repo, path);
      const file = parse(full, readFileSync(full, "utf8"));
      const pagers = detachedPagers(file);
      // Reaching the mechanism is asserted, not assumed: a file whose pagers
      // stopped being found would satisfy the loop below by being empty.
      expect(
        pagers.length,
        `${path} renders no pager to check`
      ).toBeGreaterThan(0);
      for (const pager of pagers) {
        expect(
          enclosedBy(pager.at, marker, file),
          `${path}:${lineOf(pager.at, file)} sits outside the "${marker}" that ` +
            `draws the card around its table, so it renders outside the card`
        ).toBe(true);
      }
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
          tagIs(tagNameOf(node, file), TABLE, file) &&
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        ) {
          for (const property of node.attributes.properties) {
            if (
              !ts.isJsxAttribute(property) ||
              property.name.getText(file) !== "footer"
            ) {
              continue;
            }
            // The attribute must pass the component's OWN `footer` prop, not
            // merely exist. `footer={undefined}` still has the attribute while
            // dropping the caller's pager on the floor, and every caller would
            // stay excused through FORWARDS_FOOTER.
            const initializer = property.initializer;
            forwards =
              initializer !== undefined &&
              ts.isJsxExpression(initializer) &&
              initializer.expression !== undefined &&
              ts.isIdentifier(initializer.expression) &&
              initializer.expression.text === "footer";
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
