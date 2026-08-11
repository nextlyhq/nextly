/**
 * Geometry crosses the frame in ONE module, and this is what says so.
 *
 * The editor's chrome is drawn in the host document over a canvas that lives in
 * an iframe, so anything positioning an overlay has to convert between the two
 * coordinate spaces. Two modules doing that conversion separately are correct
 * about their own question and disagree about the shared one — the indicator
 * lands a few pixels off the gap it names, and neither module's tests fail.
 *
 * A convention cannot hold that, because the second implementation looks
 * reasonable in isolation and arrives when someone needs a rectangle and has a
 * DOM node to hand. So it is checked: `getBoundingClientRect` may be read in
 * `geometry.ts` and nowhere else in this package.
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

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Extensions the bundler follows, and therefore the ones this guard must read. */
const BUNDLED_MODULE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/** The one module allowed to convert between the frame and the host. */
const GEOMETRY_MODULE = "geometry.ts";

/**
 * Reads that cross the frame, and are therefore the ones to own in one place.
 *
 * `getBoundingClientRect` is the whole of it today. `getClientRects` is included
 * because it answers the same question for a wrapped element and would be the
 * natural way to write the second implementation.
 */
const CROSS_FRAME_READS = new Set(["getBoundingClientRect", "getClientRects"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (BUNDLED_MODULE.test(entry.name)) out.push(full);
  }
  return out;
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
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("geometry crosses the frame in one place", () => {
  const files = sourceFiles(SRC_DIR);

  it("has files to check", () => {
    // A guard that read nothing reports the same clean pass as one that read
    // everything and found nothing, and a renamed directory is all it takes.
    expect(files.length).toBeGreaterThan(0);
  });

  it("finds no cross-frame read outside the geometry module", () => {
    const offenders = files
      .filter(file => !file.endsWith(GEOMETRY_MODULE))
      .filter(file => !file.endsWith("geometry-ownership.test.ts"))
      .flatMap(file => {
        const reads = crossFrameReads(readFileSync(file, "utf8"), file);
        return reads.map(read => `${relative(SRC_DIR, file)} reads ${read}`);
      });

    expect(offenders).toEqual([]);
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
});
