// @vitest-environment jsdom

/**
 * Node kinds are asked through `dom-kind`, and this is what says so.
 *
 * `x instanceof HTMLElement` answers only for nodes the asking window built. A
 * canvas mounted into a same-origin iframe hands this package nodes and events
 * built by the frame's window, and every such check then returns early and
 * does nothing, with no error to show it. `dom-kind` asks the same questions
 * by node type and namespace, which hold in any realm; this refuses an
 * `instanceof` against a DOM constructor anywhere else in the shipped source,
 * including the realm-scoped `instanceof view.HTMLElement` spelling, which is
 * correct but is a second implementation of a question `dom-kind` answers.
 *
 * ⚠️ Bounded, and stated here because a scan reads as a guarantee otherwise.
 * It recognises `instanceof` whose right side NAMES a DOM constructor: a bare
 * identifier, or a property read by name off something else. A constructor
 * held in a variable of another name, a `Symbol.hasInstance` call and a
 * prototype comparison all walk past it, and a test below asserts one of them
 * does. It catches the spelling reached for without thinking, which is the one
 * that has been written here before.
 *
 * Read from the AST rather than as text, so comments explaining why
 * `instanceof` is wrong — this file's, `dom-kind`'s — are not findings, and
 * `x instanceof\n  HTMLElement` is.
 *
 * @module dom-kind-ban.test
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";
import type { Node as AstNode } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { TEST_MODULE, collectModules } from "./source-modules";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Files still carrying a realm-bound check, by exact path, with exactly the
 * constructors each names.
 *
 * Both are the inline-editing hooks, whose event-target checks move to
 * `dom-kind` together with the change that hands them the canvas's document
 * in place of the global one. An entry is compared for EQUALITY, not
 * containment: a new check added to one of these files fails like anywhere
 * else, and converting the listed one fails until its entry is removed, so the
 * list can only shrink.
 */
const PENDING: ReadonlyMap<string, readonly string[]> = new Map([
  ["use-inline-editing.ts", ["Element"]],
  ["use-inline-text.ts", ["Element"]],
]);

/**
 * The DOM constructors this realm defines, read off the realm rather than
 * listed: everything that is `Node`, `Event`, `EventTarget` or `Window`, or
 * inherits from one of them.
 *
 * Derived so it cannot fall behind the platform — `HTMLDialogElement`,
 * `CDATASection` and `FocusEvent` arrive without anyone writing them down. A
 * name this realm lacks is still caught by {@link DOM_NAME_SHAPE}.
 */
function realmConstructors(): Set<string> {
  const roots: readonly unknown[] = [Node, Event, EventTarget, Window];
  const isDom = (value: unknown): boolean =>
    typeof value === "function" &&
    (roots.includes(value) ||
      [Node, Event].some(root =>
        Object.prototype.isPrototypeOf.call(root.prototype, value.prototype)
      ));
  return new Set(
    Object.getOwnPropertyNames(globalThis).filter(name =>
      isDom(Reflect.get(globalThis, name))
    )
  );
}

const REALM_CONSTRUCTORS = realmConstructors();

/**
 * The shape of an element or event interface name, for the ones jsdom does not
 * implement — `PointerEvent` among them, which a drag is made of.
 */
const DOM_NAME_SHAPE =
  /^(?:(?:HTML|SVG|MathML)[A-Za-z]*Element|[A-Za-z]*Event)$/;

function isDomConstructor(name: string): boolean {
  return REALM_CONSTRUCTORS.has(name) || DOM_NAME_SHAPE.test(name);
}

/** The name the right side of an `instanceof` spells, if it spells one. */
function constructorNamed(node: AstNode): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return null;
  const property = node.computed
    ? literalText(node.property)
    : node.property.type === "Identifier"
      ? node.property.name
      : null;
  if (property === null) return null;
  const object = constructorNamed(node.object);
  return object === null ? property : `${object}.${property}`;
}

/** The last segment of a dotted name: `view.HTMLElement` names `HTMLElement`. */
function lastSegment(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

/** Every `instanceof` in a source text whose right side names a DOM constructor. */
function domInstanceofChecks(text: string, file: string): string[] {
  const found: string[] = [];
  walk(parseSource(text, file).program, (node: AstNode) => {
    if (node.type !== "BinaryExpression" || node.operator !== "instanceof") {
      return;
    }
    const name = constructorNamed(node.right);
    if (name !== null && isDomConstructor(lastSegment(name))) found.push(name);
  });
  return found;
}

/** The package's shipped modules, by the shared rule: tests are not shipped. */
function productFiles(): string[] {
  return collectModules(
    SRC_DIR,
    at => readdirSync(at, { withFileTypes: true }),
    join
  ).filter(file => !TEST_MODULE.test(file));
}

describe("node kinds are asked through dom-kind", () => {
  const files = productFiles();
  const paths = files.map(file => relative(SRC_DIR, file));

  it("reads the files it claims to", () => {
    // By membership rather than by count: a scan reduced to a stray directory
    // still finds SOME files. These are where the checks lived.
    expect(paths).toEqual(
      expect.arrayContaining([
        "canvas.tsx",
        "canvas-escape.ts",
        "block-toolbar.tsx",
        "geometry-dom.ts",
        "dom-kind.ts",
        ...PENDING.keys(),
      ])
    );
  });

  it("finds no DOM-constructor instanceof outside the pending files", () => {
    const offenders = files
      .filter(file => !PENDING.has(relative(SRC_DIR, file)))
      .flatMap(file =>
        domInstanceofChecks(readFileSync(file, "utf8"), file).map(
          name => `${relative(SRC_DIR, file)}: instanceof ${name}`
        )
      );
    expect(offenders).toEqual([]);
  });

  it("finds exactly the pending checks in the pending files", () => {
    // Also the positive control on REAL files: these checks are on disk, so a
    // scan that read nothing, or matched nothing, fails here.
    for (const [path, expected] of PENDING) {
      const text = readFileSync(join(SRC_DIR, path), "utf8");
      expect(domInstanceofChecks(text, path), path).toEqual(expected);
    }
  });

  it("knows this realm's constructors", () => {
    // If the environment were not a DOM, the derived set would be empty and
    // only the name shape would be left standing.
    for (const name of [
      "Node",
      "Element",
      "HTMLElement",
      "HTMLTextAreaElement",
      "HTMLInputElement",
      "Text",
      "Document",
      "Window",
      "KeyboardEvent",
    ]) {
      expect(REALM_CONSTRUCTORS.has(name), name).toBe(true);
    }
  });

  it("sees a DOM-constructor check when there is one", () => {
    const probe = (source: string): string[] =>
      domInstanceofChecks(source, "probe.ts");

    expect(probe("if (x instanceof HTMLElement) {}")).toEqual(["HTMLElement"]);
    expect(probe("const t = x instanceof Node;")).toEqual(["Node"]);
    expect(probe("if (!(x instanceof HTMLInputElement)) {}")).toEqual([
      "HTMLInputElement",
    ]);
    // The realm-scoped spelling, both ways of reading the property.
    expect(probe("x instanceof view.HTMLElement")).toEqual([
      "view.HTMLElement",
    ]);
    expect(probe('x instanceof view["Element"]')).toEqual(["view.Element"]);
    // A name only the shape knows, whatever this realm implements.
    expect(probe("x instanceof PointerEvent")).toEqual(["PointerEvent"]);
    expect(probe("x instanceof SVGFooElement")).toEqual(["SVGFooElement"]);
  });

  it("leaves instanceof against anything else alone", () => {
    // The checks this package keeps, which are not about a DOM realm.
    expect(
      domInstanceofChecks(
        "a instanceof Error; b instanceof TypeError; c instanceof OpError; d instanceof Map;",
        "probe.ts"
      )
    ).toEqual([]);
    // Comments are not code.
    expect(
      domInstanceofChecks(
        "// x instanceof HTMLElement\nconst y = 1;",
        "probe.ts"
      )
    ).toEqual([]);
  });

  it("does not claim to see a constructor held under another name", () => {
    // The limit of the scan, asserted so the docblock cannot drift from it.
    expect(
      domInstanceofChecks(
        "const Kind = HTMLElement; const ok = x instanceof Kind;",
        "probe.ts"
      )
    ).toEqual([]);
  });
});
