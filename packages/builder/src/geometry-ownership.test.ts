/**
 * Rectangles are READ across the frame in one module, and this is what says so.
 *
 * ⚠️ Read the name carefully, because it is narrower than the invariant it
 * serves. This checks where a rectangle is READ. It does NOT check where the
 * mapping is COMPUTED: a module handed an origin and a scale can open-code
 * `origin.x + point.x * scale` without touching the DOM at all, and nothing
 * here would see it. A duplicate mapping added alongside this file passes every
 * assertion below.
 *
 * Nothing checks that half. Arithmetic on two numbers is indistinguishable
 * from any other arithmetic, so no scan can tell a second implementation from
 * ordinary code. What IS checkable is the DOM read a mapping needs its inputs
 * from, and this is narrowed to that.
 *
 * The editor's chrome is drawn in the host document over a canvas that lives in
 * an iframe, so anything positioning an overlay has to convert between the two
 * coordinate spaces. Two modules doing that conversion separately are correct
 * about their own question and disagree about the shared one — the indicator
 * lands a few pixels off the gap it names, and neither module's tests fail.
 *
 * So this scans for that read outside `geometry.ts`. Its detection is bounded:
 * it recognises a property access, a string element access, and a destructured
 * binding in either form. A name assembled at runtime, a `Reflect.get`, a
 * property descriptor and an `eval` all walk past it, and the last test in this
 * file asserts one of them does.
 *
 * Stated at the top because a scan reads as a guarantee otherwise. It catches
 * the spelling someone reaches for without thinking — a second implementation
 * looks reasonable in isolation and arrives when someone needs a rectangle and
 * has a DOM node to hand. It does not constrain one written deliberately.
 *
 * Read from the AST rather than by matching text, so a call written as
 * `el["getBoundingClientRect"]()` is seen as the same thing — the spelling that
 * would slip past a search for the dotted form.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectModules } from "./source-modules";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The one module allowed to convert between the frame and the host, matched by
 * its exact file name.
 *
 * By its RELATIVE PATH, not by any part of its name. A suffix test also exempts
 * `overlay-geometry.ts`; a basename test still exempts `overlays/geometry.ts`.
 * Both are names a second implementation would plausibly be given, and each
 * narrowing let exactly one more spelling through — so the allowance is the one
 * path itself, which no choice of filename can widen.
 */
const GEOMETRY_MODULE = "geometry.ts";

/** This file, which necessarily names the reads it is looking for. */
const OWN_TEST = "geometry-ownership.test.ts";

/** Whether a file IS the named module, by its path beneath `src`. */
function isModule(file: string, relativePath: string): boolean {
  return relative(SRC_DIR, file) === relativePath;
}

/**
 * Reads that cross the frame, and are therefore the ones to own in one place.
 *
 * `getBoundingClientRect` is the whole of it today. `getClientRects` is included
 * because it answers the same question for a wrapped element and would be the
 * natural way to write the second implementation.
 */
const CROSS_FRAME_READS = new Set(["getBoundingClientRect", "getClientRects"]);

/** The package's modules, by the shared rule; only the file reading is local. */
function sourceFiles(dir: string): string[] {
  return collectModules(
    dir,
    at => readdirSync(at, { withFileTypes: true }),
    join
  );
}

/** Every cross-frame read a source text performs, by the name it used. */
function crossFrameReads(text: string, file: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    // `el.getBoundingClientRect()`
    if (ts.isPropertyAccessExpression(node)) {
      if (CROSS_FRAME_READS.has(node.name.text)) found.push(node.name.text);
    }
    // `el["getBoundingClientRect"]()` — the same call, spelled so a text search
    // for the dotted form does not see it.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      CROSS_FRAME_READS.has(node.argumentExpression.text)
    ) {
      found.push(node.argumentExpression.text);
    }
    // `const { getBoundingClientRect: read } = el` — the method taken off the
    // element and called later through a name of the caller's choosing. Neither
    // branch above sees it: the access is a binding pattern, and the call site
    // is a bare identifier that could be anything.
    //
    // Both spellings count. A renamed binding carries `propertyName`, a
    // shorthand one carries only `name`, and the shorthand is the form someone
    // reaches for first.
    if (ts.isBindingElement(node)) {
      const read = node.propertyName ?? node.name;
      if (ts.isIdentifier(read) && CROSS_FRAME_READS.has(read.text)) {
        found.push(read.text);
      }
      if (ts.isStringLiteralLike(read) && CROSS_FRAME_READS.has(read.text)) {
        found.push(read.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("rectangles are read across the frame in one place", () => {
  const files = sourceFiles(SRC_DIR);

  it("has files to check", () => {
    // A guard that read nothing reports the same clean pass as one that read
    // everything and found nothing, and a renamed directory is all it takes.
    expect(files.length).toBeGreaterThan(0);
  });

  it("finds no cross-frame read outside the geometry module", () => {
    const offenders = files
      .filter(file => !isModule(file, GEOMETRY_MODULE))
      .filter(file => !isModule(file, OWN_TEST))
      .flatMap(file => {
        const reads = crossFrameReads(readFileSync(file, "utf8"), file);
        return reads.map(read => `${relative(SRC_DIR, file)} reads ${read}`);
      });

    expect(offenders).toEqual([]);
  });

  it("exempts one path, not a family of names", () => {
    // The allowance has to be exactly as wide as the thing allowed. A suffix
    // test also exempts `overlay-geometry.ts` and `nested/frame-geometry.ts`,
    // which are the names a second implementation would actually be given — so
    // the guard would wave through the duplicate it exists to catch.
    expect(isModule(join(SRC_DIR, "geometry.ts"), GEOMETRY_MODULE)).toBe(true);
    expect(
      isModule(join(SRC_DIR, "overlay-geometry.ts"), GEOMETRY_MODULE)
    ).toBe(false);
    // The spelling a basename test still admitted: a nested module whose file
    // name is identical. Each narrowing left one more open, which is why the
    // allowance is now the path rather than a shape of name.
    expect(
      isModule(join(SRC_DIR, "overlays", "geometry.ts"), GEOMETRY_MODULE)
    ).toBe(false);
  });

  it("can see a cross-frame read when there is one", () => {
    // The positive control. Without it the assertion above passes just as
    // happily against a visitor that never matches anything — which is the
    // failure it would take longest to notice, because it looks like success.
    const dotted = crossFrameReads(
      "const r = el.getBoundingClientRect();",
      "probe.ts"
    );
    const bracketed = crossFrameReads(
      'const r = el["getBoundingClientRect"]();',
      "probe.ts"
    );

    expect(dotted).toEqual(["getBoundingClientRect"]);
    expect(bracketed).toEqual(["getBoundingClientRect"]);
  });

  it("sees the method taken off the element and called through a new name", () => {
    // The spelling that walked past the two above: the access is a binding
    // pattern rather than a property access, and the call site is a bare
    // identifier indistinguishable from any other function.
    const renamed = crossFrameReads(
      "const { getBoundingClientRect: read } = el; read.call(el);",
      "probe.ts"
    );
    const shorthand = crossFrameReads(
      "const { getBoundingClientRect } = el; getBoundingClientRect.call(el);",
      "probe.ts"
    );

    expect(renamed).toEqual(["getBoundingClientRect"]);
    expect(shorthand).toEqual(["getBoundingClientRect"]);
  });

  it("does not claim to see a read routed through a computed name", () => {
    // The limit of the scan, asserted so it stays true.
    //
    // Detection is by syntax, and syntax has an unbounded surface: a name
    // assembled at runtime, a `Reflect.get`, a property descriptor, an `eval`.
    // Recognising one more spelling moves the edge without closing it, so the
    // set above is bounded on purpose rather than aspiring to completeness.
    //
    // Asserting the miss keeps the boundary honest: a sentence in a header can
    // drift from the code, and this cannot.
    const computed = crossFrameReads(
      'const name = "getBounding" + "ClientRect"; const r = el[name]();',
      "probe.ts"
    );

    expect(computed).toEqual([]);
  });
});
