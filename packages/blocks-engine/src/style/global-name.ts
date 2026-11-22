/**
 * The one spelling of a document-global CSS name that wears its document's
 * namespace, and the scope token it is built from.
 *
 * Apart from `isolation.ts`, which checks the names a sheet defines, because
 * that module loads a CSS parser and the compiler must not: it names the
 * keyframes it emits with the same rule the check reads, and a second copy of
 * the rule would let the two disagree.
 *
 * @module style/global-name
 */
import { hashId } from "./node-class";

/**
 * A name that CSS resolves globally, wearing the document's namespace.
 *
 * `@keyframes`, `@property`, `@counter-style` and `@font-palette-values` all
 * define names in one flat per-document space, no matter where the rule sits or
 * how tightly its selectors are scoped. Two documents on one page — or a
 * document and its host — that both define `fade` do not get one each: the
 * later definition wins for BOTH, silently, and which one is later depends on
 * the order stylesheets happened to load.
 *
 * Anchoring cannot help, because these names are not selectors. Namespacing is
 * the whole mechanism, which is why the invariant below exists before anything
 * emits one: the moment tokens or animations start defining names, an
 * un-namespaced one has to be a test failure rather than a rendering mystery
 * somebody debugs six months later.
 */
export function namespacedGlobalName(name: string, scopeClass: string): string {
  // A custom-property name keeps its leading dashes, since `@property` only
  // accepts a dashed ident and moving them would produce a name CSS refuses.
  const custom = name.startsWith("--");
  const bare = custom ? name.slice(2) : name;
  return `${custom ? "--" : ""}${scopeToken(scopeClass)}-${bare}`;
}

/**
 * The scope as a fixed-shape token: a letter prefix and a hash, nothing else.
 *
 * Carrying the scope's own text into the name is what three separate collisions
 * came from, and each fix left the next one intact. Doubling the scope's dashes
 * made `a` + `b-c` and `a-b` + `c` distinct but not `a` + `-b-c` and `a-b` + `c`,
 * because the NAME's leading dashes merge with the separator just as the
 * scope's trailing ones do. Escaping both sides does not close it either: two
 * adjacent runs of variable length cannot be told apart by one separator, so
 * `a-` + `b` and `a` + `-b` collide however carefully each side is escaped.
 *
 * A hash removes the boundary problem instead of encoding around it. The token
 * contains no dash, so the FIRST dash is unambiguously the separator whatever
 * the name does, and the name needs no escaping at all. It is also immune to the
 * other two hazards this encoding met: base36 is unchanged by case folding, so
 * scopes differing only in case — or only by U+212A against "K" — stay apart,
 * and the token always begins with a letter, so a scope like `7f3a` cannot
 * produce a name that tokenizes as a dimension.
 *
 * The cost is that the scope is no longer legible in the name. That is a real
 * loss and it is the right trade: the scope is an internal detail, the author's
 * own name is still there to recognise, and the readable spelling bought three
 * rounds of collisions.
 *
 * Reuses the document's existing hash, whose collision analysis lives with it.
 * Two distinct scopes hashing together would share a namespace — the very thing
 * this prevents — but at 53 bits, with a handful of documents on a page, that
 * sits far below the rate at which anything else here fails.
 */
export function scopeToken(scopeClass: string): string {
  return `nx${hashId(scopeClass)}`;
}
