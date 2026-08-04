/**
 * Namespacing the document-global names an author's custom CSS defines.
 *
 * `@keyframes` and `@font-face` are the two at-rules a page author actually
 * asks for, and both were dropped wholesale because of one property they share:
 * the name they define is resolved in a single flat space for the WHOLE
 * document, no matter how tightly the rules around them are scoped. Two page
 * builder documents on one page — or a document and the host site — that both
 * define `fade` do not get one each. The later definition wins for both, and
 * which one is later depends on the order stylesheets happened to load.
 *
 * For `@font-face` it is worse than a collision, because family names are
 * matched case-insensitively and the host's own text is on the other side of
 * it: an author writing `@font-face { font-family: Inter; src: url(/x.woff2) }`
 * would replace the font the host renders its entire site in, from inside a
 * region the host believed was scoped.
 *
 * Scoping cannot reach any of this — these names are not selectors. Namespacing
 * is the whole mechanism, so this module gives every defined name the scope's
 * namespace and then rewrites the author's own references to match. The author
 * writes `fade` and `MyFont`, sees them work, and never learns that the
 * document holds something longer.
 *
 * ## Read what CSS reads, not what was typed
 *
 * Every comparison here decodes escapes first. `font\2d family` IS the
 * `font-family` descriptor to a browser, and `@keyframes \66 ade` IS named
 * `fade` — so a check against the raw text is a check an author can walk
 * straight past. That is a bypass rather than a nuisance: the un-namespaced
 * descriptor keeps its global name, and the host's font goes with it.
 *
 * ## Rewriting a reference needs the shorthand's grammar
 *
 * Knowing which names this stylesheet defines is what makes a rewrite safe to
 * attempt, but it is not enough on its own, because the same token can be a
 * NAME in one place and a keyword in another. A stylesheet defining
 * `@keyframes infinite` must still leave the `infinite` in
 * `animation: pulse 1s infinite` alone — it is the iteration count there. So
 * the shorthands are read positionally: `animation` skips its own keywords, and
 * `font` rewrites nothing before the font size, where the tokens are style,
 * variant and weight rather than families.
 *
 * A reference to a name the author did NOT define is left exactly as written,
 * which also leaves the useful case working — custom CSS may still reference an
 * animation the page itself provides.
 *
 * @module core/css-global-names
 */
import {
  decodeIdentifier,
  namespacedGlobalName,
} from "@nextlyhq/blocks-engine";
import type * as csstree from "css-tree";

/**
 * Keywords `animation` may hold that are not the animation's name.
 *
 * Timing functions, direction, fill mode, play state, iteration count, and the
 * CSS-wide keywords. A token in this set is never rewritten, even when the
 * stylesheet defines a keyframes rule of the same name: in the shorthand it is
 * that component, and renaming it changes what the declaration says.
 *
 * Functional timing values — `cubic-bezier()`, `steps()`, `linear()` — arrive
 * as Function nodes rather than identifiers, so they never reach the check.
 */
const ANIMATION_KEYWORDS = new Set([
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "none",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "infinite",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * Keywords `animation-name` may hold that are not a name.
 *
 * Far shorter than the shorthand's list, because every other value of this
 * longhand IS a keyframes name — that is what the property is for.
 */
const ANIMATION_NAME_KEYWORDS = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * The names an author's stylesheet defines, mapped to their namespaced form.
 *
 * Two maps rather than one, because the two name spaces do not share a
 * comparison. A `<custom-ident>` — which is what a keyframe name is — is
 * case-SENSITIVE, so `Fade` and `fade` are two animations. A font family is
 * not, which is why `font-family: arial` finds a font installed as "Arial".
 * One shared map would resolve one of the two wrongly.
 */
export interface GlobalNameMap {
  /** Keyframe names, compared exactly. */
  keyframes: Map<string, string>;
  /** Font family names, keyed by their lowercased form. */
  fontFamilies: Map<string, string>;
}

export function emptyGlobalNameMap(): GlobalNameMap {
  return { keyframes: new Map(), fontFamilies: new Map() };
}

/** A property or descriptor name as CSS reads it: decoded, then case-folded. */
function propertyName(raw: string): string {
  return decodeIdentifier(raw).toLowerCase();
}

/** The text of a node that can carry a name, decoded, or `undefined`. */
function nameOf(node: csstree.CssNode): string | undefined {
  if (node.type === "Identifier") return decodeIdentifier(node.name);
  if (node.type === "String") return node.value;
  return undefined;
}

/** Write a name back onto the node it came from. */
function setName(node: csstree.CssNode, name: string): void {
  if (node.type === "Identifier") node.name = name;
  else if (node.type === "String") node.value = name;
}

/**
 * Every `font-family` descriptor in a `@font-face`, in source order.
 *
 * All of them, because CSS applies the LAST valid one, and namespacing only the
 * first leaves the effective family bare — the whole collision, still open,
 * behind a decoy that looks handled.
 */
export function fontFaceFamilyDeclarations(
  node: csstree.Atrule
): csstree.Declaration[] {
  const block = node.block;
  if (!block) return [];
  return block.children
    .toArray()
    .filter(
      (child): child is csstree.Declaration =>
        child.type === "Declaration" &&
        propertyName(child.property) === "font-family"
    );
}

/** Whether a `@font-face` block still declares a `src` after sanitizing. */
export function fontFaceHasSrc(node: csstree.Atrule): boolean {
  const block = node.block;
  if (!block) return false;
  return block.children
    .toArray()
    .some(
      child =>
        child.type === "Declaration" && propertyName(child.property) === "src"
    );
}

/**
 * The single name a value denotes, or `undefined` if it is not a plain name.
 *
 * A `@font-face` family that arrives as several unquoted identifiers is joined,
 * since `font-family: My Font` names one family rather than two.
 */
function valueAsName(value: csstree.CssNode): string | undefined {
  if (value.type !== "Value") return undefined;
  const parts: string[] = [];
  for (const child of value.children.toArray()) {
    const part = nameOf(child);
    if (part === undefined) return undefined;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Namespace the names a stylesheet defines, recording what changed.
 *
 * Mutates the AST, because the alternative is serializing and reparsing to
 * apply a rename the parser already located precisely.
 */
export function namespaceDefinedNames(
  ast: csstree.CssNode,
  scopeClass: string,
  walk: typeof csstree.walk
): GlobalNameMap {
  const map = emptyGlobalNameMap();

  walk(ast, {
    visit: "Atrule",
    enter(node: csstree.CssNode) {
      const atrule = node as csstree.Atrule;
      const name = propertyName(atrule.name);

      if (name === "keyframes") {
        // The name arrives as the single child of the prelude — an identifier,
        // or a string for a name that needs quoting. A `Raw` prelude is the
        // parser saying it could not read one, and renaming text it did not
        // understand is how a rename becomes a syntax error.
        const prelude = atrule.prelude;
        if (!prelude || prelude.type !== "AtrulePrelude") return;
        const first = prelude.children.first;
        if (!first) return;
        const original = nameOf(first);
        if (original === undefined || original === "") return;
        const namespaced = namespacedGlobalName(original, scopeClass);
        // Keyed by the DECODED name, because that is what a reference elsewhere
        // in the stylesheet reads as.
        map.keyframes.set(original, namespaced);
        setName(first, namespaced);
        return;
      }

      if (name === "font-face") {
        const declarations = fontFaceFamilyDeclarations(atrule);
        if (declarations.length === 0) return;
        // Every descriptor is namespaced so none is left holding a global
        // name; the LAST readable one is what the browser applies, so that is
        // the one a reference has to be pointed at.
        let effective: string | undefined;
        for (const declaration of declarations) {
          const original = valueAsName(declaration.value);
          if (original === undefined || original === "") continue;
          replaceValueWithString(
            declaration.value as csstree.Value,
            namespacedGlobalName(original, scopeClass)
          );
          effective = original;
        }
        if (effective !== undefined) {
          map.fontFamilies.set(
            effective.toLowerCase(),
            namespacedGlobalName(effective, scopeClass)
          );
        }
      }
    },
  });

  return map;
}

/**
 * Point the author's own references at the names they now have.
 *
 * Runs over every declaration, not only the ones outside at-rules: an
 * `animation` inside a `@media` block references the same keyframes.
 */
export function rewriteNameReferences(
  ast: csstree.CssNode,
  map: GlobalNameMap,
  walk: typeof csstree.walk
): void {
  if (map.keyframes.size === 0 && map.fontFamilies.size === 0) return;

  walk(ast, {
    visit: "Declaration",
    enter(node: csstree.CssNode) {
      // The `font-family` inside a `@font-face` is the DEFINITION, renamed
      // already by the pass above. Letting this pass reach it too would make
      // each of the two look unnecessary while both were running, and only one
      // of them is the rule that has to be right.
      if (propertyName(this.atrule?.name ?? "") === "font-face") return;
      const declaration = node as csstree.Declaration;
      const property = propertyName(declaration.property);
      const value = declaration.value;
      if (value.type !== "Value") return;

      if (map.keyframes.size > 0) {
        if (property === "animation-name") {
          rewriteKeyframeNames(
            value,
            map.keyframes,
            ANIMATION_NAME_KEYWORDS,
            0
          );
        } else if (property === "animation") {
          rewriteKeyframeNames(value, map.keyframes, ANIMATION_KEYWORDS, 0);
        }
      }

      if (map.fontFamilies.size > 0) {
        if (property === "font-family") {
          rewriteFontFamilies(value, map.fontFamilies, 0);
        } else if (property === "font") {
          // Everything before the font size is style, variant, weight or
          // stretch. A stylesheet defining a family called `italic` must not
          // turn the `italic` of `font: italic 16px Arial` into a family.
          const start = familyStartIndex(value);
          if (start !== undefined) {
            rewriteFontFamilies(value, map.fontFamilies, start);
          }
        }
      }
    },
  });
}

/**
 * Where the family list begins in a `font` shorthand, or `undefined`.
 *
 * The font size is the anchor: the shorthand requires it, everything before it
 * is a style/variant/weight/stretch token, and the families follow it — after
 * an optional `/ line-height`. Without a size there is no family list either;
 * `font: caption` is a system font and names nothing.
 */
function familyStartIndex(value: csstree.Value): number | undefined {
  const nodes = value.children.toArray();
  const sizeAt = nodes.findIndex(
    node =>
      node.type === "Dimension" ||
      node.type === "Percentage" ||
      node.type === "Number"
  );
  if (sizeAt === -1) return undefined;

  let index = sizeAt + 1;
  // `16px/1.5` — the line-height and its slash sit between size and family.
  const next = nodes[index];
  if (next?.type === "Operator" && next.value === "/") index += 2;
  return index < nodes.length ? index : undefined;
}

/**
 * Rewrite the keyframes names a value references, leaving keywords alone.
 *
 * `skip` holds the tokens that mean something else in this property, which is
 * what stops a stylesheet defining `@keyframes infinite` from rewriting the
 * iteration count of an unrelated declaration.
 */
function rewriteKeyframeNames(
  value: csstree.Value,
  names: Map<string, string>,
  skip: Set<string>,
  from: number
): void {
  const nodes = value.children.toArray();
  for (let index = from; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) continue;
    const original = nameOf(node);
    if (original === undefined) continue;
    // A keyword is compared case-insensitively, as CSS reads it; the name it
    // shadows is not, since a keyframes name is a case-sensitive custom-ident.
    if (skip.has(original.toLowerCase())) continue;
    const namespaced = names.get(original);
    if (namespaced !== undefined) setName(node, namespaced);
  }
}

/**
 * Replace each comma-separated family that the stylesheet defined.
 *
 * A family may arrive as one string, one identifier, or a run of identifiers
 * (`font-family: My Font`), so the run between commas is joined before it is
 * compared — and replaced as a whole, since the namespaced name is one token
 * where the original was several.
 */
function rewriteFontFamilies(
  value: csstree.Value,
  families: Map<string, string>,
  from: number
): void {
  const children = value.children;
  const items: csstree.ListItem<csstree.CssNode>[] = [];
  children.forEach(
    (_child: csstree.CssNode, item: csstree.ListItem<csstree.CssNode>) => {
      items.push(item);
    }
  );

  let run: csstree.ListItem<csstree.CssNode>[] = [];
  let parts: string[] = [];
  const replacements: Array<{
    run: csstree.ListItem<csstree.CssNode>[];
    name: string;
  }> = [];

  const closeRun = (): void => {
    if (run.length > 0 && parts.length > 0) {
      const namespaced = families.get(parts.join(" ").toLowerCase());
      if (namespaced !== undefined)
        replacements.push({ run, name: namespaced });
    }
    run = [];
    parts = [];
  };

  for (let index = from; index < items.length; index++) {
    const item = items[index];
    if (item === undefined) continue;
    const part = nameOf(item.data);
    if (part !== undefined) {
      run.push(item);
      parts.push(part);
    } else {
      // A comma ends one family. Anything else ends the run without matching,
      // since a family name is only ever identifiers and strings.
      closeRun();
    }
  }
  closeRun();

  for (const { run: matched, name } of replacements) {
    const first = matched[0];
    if (first === undefined) continue;
    children.insertData({ type: "String", value: name }, first);
    for (const item of matched) children.remove(item);
  }
}

/** Replace every child of a value with one quoted string. */
function replaceValueWithString(value: csstree.Value, text: string): void {
  const items: csstree.ListItem<csstree.CssNode>[] = [];
  value.children.forEach(
    (_child: csstree.CssNode, item: csstree.ListItem<csstree.CssNode>) => {
      items.push(item);
    }
  );
  for (const item of items) value.children.remove(item);
  value.children.appendData({ type: "String", value: text });
}
