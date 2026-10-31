/**
 * The names a module's top-level statements declare, read from its syntax
 * tree: what an import or an export of the same name would collide with.
 *
 * A declaration of any kind counts, a type's among them: TypeScript refuses an
 * import that shares its name with a local declaration of either meaning, so
 * the safe answer to "is this name free" treats every one as taken.
 *
 * @module cli/commands/generate-widget/bindings
 */

/** A node of the parser's syntax tree, read field by field. */
type SyntaxNode = { type: string; [key: string]: unknown };

export const isNode = (value: unknown): value is SyntaxNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

const listed = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Only a declaration, never a reference: `export default openOrders` declares nothing. */
const declarationOnly = (value: unknown): unknown[] =>
  isNode(value) && value.type !== "Identifier" ? [value] : [];

/**
 * Where each kind of node keeps what it declares: a statement its declared
 * name or names, a binding pattern the names inside it. A kind missing here
 * (an expression, a string-named `declare module "x"`) declares nothing.
 */
const DECLARING_PARTS: Readonly<
  Record<string, (node: SyntaxNode) => unknown[]>
> = {
  VariableDeclaration: node =>
    listed(node.declarations).map(each => (isNode(each) ? each.id : null)),
  FunctionDeclaration: node => [node.id],
  TSDeclareFunction: node => [node.id],
  ClassDeclaration: node => [node.id],
  TSEnumDeclaration: node => [node.id],
  TSInterfaceDeclaration: node => [node.id],
  TSTypeAliasDeclaration: node => [node.id],
  TSModuleDeclaration: node => [node.id],
  TSImportEqualsDeclaration: node => [node.id],
  ExportNamedDeclaration: node => [node.declaration],
  ExportDefaultDeclaration: node => declarationOnly(node.declaration),
  ObjectPattern: node => listed(node.properties),
  ObjectProperty: node => [node.value],
  ArrayPattern: node => listed(node.elements),
  AssignmentPattern: node => [node.left],
  RestElement: node => [node.argument],
};

/**
 * Every name `node`, a top-level statement other than an import, declares:
 * `const a = 1`, `const { b, c: [d] } = x`, `export function e() {}`,
 * `type F = 1`.
 */
export function declaredNames(node: unknown): string[] {
  if (!isNode(node)) return [];
  if (node.type === "Identifier") {
    return typeof node.name === "string" ? [node.name] : [];
  }
  return (DECLARING_PARTS[node.type]?.(node) ?? []).flatMap(declaredNames);
}

/** A name as an import or export specifier writes it: `a`, or `"a"`. */
export const nameOf = (
  node:
    | { type: "Identifier"; name: string }
    | { type: "StringLiteral"; value: string }
): string => (node.type === "Identifier" ? node.name : node.value);
