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

import ts from "typescript";
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

/** The argument of the first `<name><...>` type reference under `node`. */
function argumentOf(
  node: ts.Node,
  name: string,
  sf: ts.SourceFile
): string | undefined {
  let found: string | undefined;
  const visit = (n: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isTypeReferenceNode(n) &&
      n.typeName.getText(sf).split(".").pop() === name &&
      n.typeArguments?.length === 1
    ) {
      found = n.typeArguments[0].getText(sf);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** A declaration with both a type annotation and a call as its value. */
type AnnotatedCall = ts.VariableDeclaration & {
  type: ts.TypeNode;
  initializer: ts.CallExpression;
};

/** An annotated `const X: ... = forwardRef<T, P>(...)`, or `undefined`. */
function annotatedForwardRef(
  n: ts.Node,
  sf: ts.SourceFile
): AnnotatedCall | undefined {
  if (!ts.isVariableDeclaration(n) || !n.type || !n.initializer)
    return undefined;
  if (!ts.isCallExpression(n.initializer)) return undefined;
  const callee = n.initializer.expression.getText(sf).split(".").pop();
  return callee === "forwardRef" ? (n as AnnotatedCall) : undefined;
}

/** Why the declaration breaks the rule, or `null` when it keeps it. */
function problemOf(decl: AnnotatedCall, sf: ts.SourceFile): string | null {
  const [ref, props] = decl.initializer.typeArguments ?? [];
  if (props === undefined || ref === undefined) {
    return "forwardRef has no <T, P> generic";
  }
  const P = props.getText(sf);
  const T = ref.getText(sf);
  if (!/^[\w.]+$/.test(P)) {
    return `props are written inline (${P.slice(0, 60)}…), not named once`;
  }
  const wrapped = argumentOf(decl.type, "PropsWithoutRef", sf);
  if (wrapped !== P)
    return `annotation wraps ${String(wrapped)}, generic says ${P}`;
  const refType = argumentOf(decl.type, "RefAttributes", sf);
  if (refType !== T)
    return `annotation's ref is ${String(refType)}, generic says ${T}`;
  return null;
}

function annotatedForwardRefs(file: string): Annotated[] {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out: Annotated[] = [];
  const visit = (n: ts.Node): void => {
    const decl = annotatedForwardRef(n, sf);
    if (decl)
      out.push({ name: decl.name.getText(sf), problem: problemOf(decl, sf) });
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
