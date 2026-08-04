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
 * ## Only names this stylesheet defines are rewritten
 *
 * A reference to a name the author did NOT define is left exactly as written,
 * which is what makes the rewrite safe to do at all. Deciding whether a bare
 * ident inside `animation: fade 1s ease-in-out infinite` is the name or one of
 * the six other components means implementing the shorthand's grammar, and
 * getting it wrong renames a keyword. Matching against the set of names defined
 * in the same stylesheet needs no grammar: `ease-in-out` is only rewritten by
 * an author who defined `@keyframes ease-in-out`, and renaming that one is
 * correct anyway.
 *
 * It also leaves the useful case working — custom CSS may still reference an
 * animation the page itself defines, because that name is not in the map.
 *
 * @module core/css-global-names
 */
import { namespacedGlobalName } from "@nextlyhq/blocks-engine";
import type * as csstree from "css-tree";

/** Properties whose value may name a `@keyframes` rule. */
const ANIMATION_PROPERTIES = new Set(["animation", "animation-name"]);

/** Properties whose value may name a font family. */
const FONT_PROPERTIES = new Set(["font", "font-family"]);

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

/** The `font-family` descriptor inside a `@font-face` block, if it has one. */
export function fontFaceFamilyDeclaration(
  node: csstree.Atrule
): csstree.Declaration | undefined {
  const block = node.block;
  if (!block) return undefined;
  for (const child of block.children.toArray()) {
    if (child.type !== "Declaration") continue;
    if (child.property.toLowerCase() === "font-family") return child;
  }
  return undefined;
}

/** Whether a `@font-face` block still declares a `src` after sanitizing. */
export function fontFaceHasSrc(node: csstree.Atrule): boolean {
  const block = node.block;
  if (!block) return false;
  return block.children
    .toArray()
    .some(
      child =>
        child.type === "Declaration" && child.property.toLowerCase() === "src"
    );
}

/**
 * The single name a value denotes, or `undefined` if it is not a plain name.
 *
 * A keyframes name is a `<custom-ident>` or a string, so anything with more
 * than one meaningful token is not one — and a `@font-face` family that arrives
 * as several unquoted identifiers is joined, since `font-family: My Font` names
 * one family rather than two.
 */
function valueAsName(value: csstree.CssNode): string | undefined {
  if (value.type !== "Value") return undefined;
  const parts: string[] = [];
  for (const child of value.children.toArray()) {
    if (child.type === "Identifier") parts.push(child.name);
    else if (child.type === "String") parts.push(child.value);
    else return undefined;
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Namespace the names a stylesheet defines, recording what changed.
 *
 * Mutates the AST, because the alternative is serializing and reparsing to
 * apply a rename that the parser already located precisely.
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
      const name = atrule.name.toLowerCase();

      if (name === "keyframes") {
        // The name arrives as the single child of the prelude — an identifier,
        // or a string for a name that needs quoting. A `Raw` prelude is the
        // parser saying it could not read one, and renaming text it did not
        // understand is how a rename becomes a syntax error, so that is left
        // alone and the rule keeps whatever it had.
        const prelude = atrule.prelude;
        if (!prelude || prelude.type !== "AtrulePrelude") return;
        const first = prelude.children.first;
        if (!first) return;
        if (first.type === "Identifier") {
          if (first.name === "") return;
          const namespaced = namespacedGlobalName(first.name, scopeClass);
          map.keyframes.set(first.name, namespaced);
          first.name = namespaced;
        } else if (first.type === "String") {
          if (first.value === "") return;
          const namespaced = namespacedGlobalName(first.value, scopeClass);
          map.keyframes.set(first.value, namespaced);
          first.value = namespaced;
        }
        return;
      }

      if (name === "font-face") {
        const declaration = fontFaceFamilyDeclaration(atrule);
        if (!declaration) return;
        const original = valueAsName(declaration.value);
        if (original === undefined || original === "") return;
        const namespaced = namespacedGlobalName(original, scopeClass);
        map.fontFamilies.set(original.toLowerCase(), namespaced);
        // Written as a string rather than an identifier: a namespaced family
        // is one token, but quoting it keeps the value valid whatever
        // characters the author's original name contained.
        replaceValueWithString(declaration.value as csstree.Value, namespaced);
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
      if (this.atrule?.name.toLowerCase() === "font-face") return;
      const declaration = node as csstree.Declaration;
      const property = declaration.property.toLowerCase();
      const value = declaration.value;
      if (value.type !== "Value") return;

      if (map.keyframes.size > 0 && ANIMATION_PROPERTIES.has(property)) {
        for (const child of value.children.toArray()) {
          if (child.type !== "Identifier") continue;
          const namespaced = map.keyframes.get(child.name);
          if (namespaced !== undefined) child.name = namespaced;
        }
      }

      if (map.fontFamilies.size > 0 && FONT_PROPERTIES.has(property)) {
        rewriteFontFamilyRun(value, map.fontFamilies);
      }
    },
  });
}

/**
 * Replace each comma-separated family that the stylesheet defined.
 *
 * A family may arrive as one string, one identifier, or a run of identifiers
 * (`font-family: My Font`), so the run between commas is joined before it is
 * compared — and replaced as a whole, since the namespaced name is one token
 * where the original was several.
 */
function rewriteFontFamilyRun(
  value: csstree.Value,
  families: Map<string, string>
): void {
  const children = value.children;

  // Collected first, because the runs are decided by looking across items and
  // the list is mutated once that decision is made.
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

  for (const item of items) {
    const node = item.data;
    if (node.type === "Identifier") {
      run.push(item);
      parts.push(node.name);
    } else if (node.type === "String") {
      run.push(item);
      parts.push(node.value);
    } else {
      // A comma ends one family. Anything else — a size or a line-height in the
      // `font` shorthand — ends the run without matching, since a family name
      // is only ever identifiers and strings.
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
