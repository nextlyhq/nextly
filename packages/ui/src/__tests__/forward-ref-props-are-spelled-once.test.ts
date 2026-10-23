/**
 * Every annotated `forwardRef` component names its props once.
 *
 * `isolatedDeclarations` makes each exported component state its type, so the
 * props appear twice: in the annotation
 * (`ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>`) and in
 * the `forwardRef<T, P>` generic. Written out twice, they can part: a prop
 * added to the generic alone still type-checks, because a component accepting
 * more is assignable to a type that promises less, and the published type then
 * leaves out a prop the component accepts.
 *
 * Asserted on the source, because once the annotation exists the generic is
 * not observable as a type: `ComponentProps<typeof X>` reads the annotation
 * back, so a type test comparing it with the props alias passes whatever the
 * generic says. The rule checked is the one that keeps the two from parting.
 * `P` is a single name (an alias declared once), and the annotation wraps
 * exactly that name and the generic's `T`.
 *
 * Verified by probe: widening one generic to `TabsListOwnProps & { extra?:
 * boolean }` still passes `check-types`, and fails here naming `TabsList`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node, TSType, VariableDeclarator } from "oxc-parser";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) && !/\.(test|test-d|spec)\./.test(entry)
      ? [path]
      : [];
  });
}

interface Annotated {
  name: string;
  /** Why it breaks the rule, or `null` when it keeps it. */
  problem: string | null;
}

/** The source text a node spans. Every oxc node carries its `start` and `end`. */
type Spelled = (node: Node) => string;

/** The argument of the first `<name><...>` type reference under `node`. */
function argumentOf(node: Node, name: string, of: Spelled): string | undefined {
  let found: string | undefined;
  walk(node, n => {
    if (found !== undefined) return false;
    if (
      n.type === "TSTypeReference" &&
      of(n.typeName).split(".").pop() === name &&
      n.typeArguments?.params.length === 1
    ) {
      found = of(n.typeArguments.params[0]);
      return false;
    }
    return undefined;
  });
  return found;
}

/** An annotated `const X: ... = forwardRef<T, P>(...)`: its name, annotation and generic. */
interface AnnotatedCall {
  name: string;
  annotation: TSType;
  generic: TSType[];
}

/** An annotated `const X: ... = forwardRef<T, P>(...)`, or `undefined`. */
function annotatedForwardRef(
  n: VariableDeclarator,
  of: Spelled
): AnnotatedCall | undefined {
  const { id, init } = n;
  if (id.type !== "Identifier" || !id.typeAnnotation) return undefined;
  if (init?.type !== "CallExpression") return undefined;
  if (of(init.callee).split(".").pop() !== "forwardRef") return undefined;
  return {
    name: id.name,
    annotation: id.typeAnnotation.typeAnnotation,
    generic: init.typeArguments?.params ?? [],
  };
}

/** Why the declaration breaks the rule, or `null` when it keeps it. */
function problemOf(decl: AnnotatedCall, of: Spelled): string | null {
  const [ref, props] = decl.generic;
  if (props === undefined || ref === undefined) {
    return "forwardRef has no <T, P> generic";
  }
  const P = of(props);
  const T = of(ref);
  if (!/^[\w.]+$/.test(P)) {
    return `props are written inline (${P.slice(0, 60)}…), not named once`;
  }
  const wrapped = argumentOf(decl.annotation, "PropsWithoutRef", of);
  if (wrapped !== P)
    return `annotation wraps ${String(wrapped)}, generic says ${P}`;
  const refType = argumentOf(decl.annotation, "RefAttributes", of);
  if (refType !== T)
    return `annotation's ref is ${String(refType)}, generic says ${T}`;
  return null;
}

function annotatedForwardRefs(file: string): Annotated[] {
  const text = readFileSync(file, "utf8");
  // oxc, through the parse every source-reading check shares: it refuses a
  // file it could not read rather than handing back an empty one.
  const { program } = parseSource(text, file);
  const of: Spelled = node => text.slice(node.start, node.end);
  const out: Annotated[] = [];
  walk(program, n => {
    if (n.type !== "VariableDeclarator") return undefined;
    const decl = annotatedForwardRef(n, of);
    if (decl) out.push({ name: decl.name, problem: problemOf(decl, of) });
    return undefined;
  });
  return out;
}

const found = sourceFiles(SRC).flatMap(file =>
  annotatedForwardRefs(file).map(entry => ({
    ...entry,
    file: relative(SRC, file),
  }))
);

describe("forwardRef components name their props once", () => {
  it("is exercised: there are annotated forwardRef components to check", () => {
    // Without this the assertion below passes against an empty list.
    expect(found.length).toBeGreaterThan(80);
  });

  it("uses one props name in the annotation and in the generic", () => {
    expect(
      found
        .filter(entry => entry.problem !== null)
        .map(entry => `${entry.file} ${entry.name}: ${entry.problem}`)
    ).toEqual([]);
  });
});
