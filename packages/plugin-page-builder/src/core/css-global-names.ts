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
  escapeIdentifier,
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
 * Font sizes that are words rather than numbers.
 *
 * The `font` shorthand is read positionally around its size, and a size is not
 * always a length: `font: italic small Brand` is as valid as `font: italic 12px
 * Brand`. Without these the shorthand looks sizeless, the family list is never
 * found, and a family the stylesheet defined keeps pointing at the global name.
 */
/**
 * Words a bare `@keyframes` prelude may not be.
 *
 * A `<custom-ident>` excludes the CSS-wide keywords and `default`; the
 * keyframes grammar excludes `none` on top of that. A rule named with one of
 * them is invalid and ignored, so it defines nothing to namespace.
 */
const KEYFRAMES_RESERVED_NAMES = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "default",
]);

const FONT_SIZE_KEYWORDS = new Set([
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
  "smaller",
  "larger",
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

/**
 * Write a name back onto the node it came from.
 *
 * An identifier is escaped on the way in, because the name being written was
 * DECODED on the way out: `@keyframes a\ b` is named `a b`, and putting `a b`
 * back bare emits two tokens where the stylesheet had one. The name would then
 * resolve to nothing, which is the same silent failure the namespacing exists
 * to prevent. A string carries its own delimiters and needs none of this.
 */
function setName(node: csstree.CssNode, name: string): void {
  if (node.type === "Identifier") node.name = escapeIdentifier(name);
  else if (node.type === "String") node.value = name;
}

/**
 * Family names that are not families.
 *
 * The generics resolve to whatever the reader has installed, and the CSS-wide
 * keywords are not names at all — but only while bare. A face may legitimately
 * be called `"serif"`, and CSS keeps the two apart by the quotes, so a stylesheet
 * defining one must still leave `font-family: serif` meaning the generic. Read
 * as a name, that declaration would be rewritten to the private face and the
 * author's fallback would be gone.
 */
const FONT_FAMILY_KEYWORDS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "default",
]);

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
        child.type === "Declaration" &&
        propertyName(child.property) === "src" &&
        srcNamesAFile(child.value)
    );
}

/**
 * Whether a `src` descriptor actually names somewhere to load a font from.
 *
 * Presence is not usability. `src: garbage` is a descriptor the browser reads
 * and discards, so no face is defined — and treating the rule as usable then
 * records its family and rewrites every reference to a private name nothing
 * defines. Where the family was one the reader already had, an installed font
 * or one the host provides, that replaces a working fallback with a missing
 * name.
 *
 * A `url()` or a `local()` is what counts. `format()` and `tech()` describe a
 * source rather than being one, so neither makes a descriptor usable alone.
 */
function srcNamesAFile(value: csstree.CssNode): boolean {
  if (value.type !== "Value") return false;
  return value.children
    .toArray()
    .some(
      child =>
        child.type === "Url" ||
        (child.type === "Function" &&
          decodeIdentifier(child.name).toLowerCase() === "local")
    );
}

/**
 * The css-tree entry points this module needs, passed in rather than imported.
 *
 * The parser is the sanitizer's, so there is one parse of one stylesheet and
 * this works on the tree that produced it — a second import would be a second
 * parser instance with its own lexer state.
 */
export interface CssTreeApi {
  walk: typeof csstree.walk;
  parse: typeof csstree.parse;
  generate: typeof csstree.generate;
}

/** A name a value denotes, and whether it was written as a quoted string. */
interface SingleName {
  name: string;
  quoted: boolean;
}

/**
 * The single family or keyframes name a value denotes, or `undefined`.
 *
 * The grammar is `<string> | <custom-ident>+`, and the alternation is exclusive:
 * one string names a family, and so does a run of identifiers
 * (`font-family: My Font` is one family, not two), but `"A" "B"` is neither. A
 * browser reading that descriptor discards it and keeps whichever earlier one
 * was valid, so treating it as a name would record a family the page never
 * uses — and leave the family it DOES use holding its global name.
 *
 * Whether the name was quoted is carried out with it, because writing a name
 * back in the other form can change what it means: `@keyframes "none"` is a
 * real animation, and `animation-name: none` is the keyword that cancels one.
 */
function singleName(value: csstree.CssNode): SingleName | undefined {
  if (value.type !== "Value") return undefined;
  const children = value.children.toArray();
  const first = children[0];
  if (first === undefined) return undefined;

  if (first.type === "String") {
    return children.length === 1
      ? { name: first.value, quoted: true }
      : undefined;
  }

  const parts: string[] = [];
  for (const child of children) {
    if (child.type !== "Identifier") return undefined;
    parts.push(decodeIdentifier(child.name));
  }
  return parts.length > 0
    ? { name: parts.join(" "), quoted: false }
    : undefined;
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
  css: CssTreeApi
): GlobalNameMap {
  const map = emptyGlobalNameMap();

  css.walk(ast, {
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
        // Exactly one, because that is the whole grammar: `@keyframes fade 1`
        // is malformed and a browser ignores the rule entirely. Renaming its
        // first token would record a name defined only by a rule nothing
        // applies, and every reference to it would be pointed at that — taking
        // an animation the host page provides and making it resolve to nothing.
        if (first !== prelude.children.last) return;
        const original = nameOf(first);
        if (original === undefined || original === "") return;
        // `<keyframes-name>` is `<custom-ident> | <string>`, and a custom-ident
        // excludes `none` and the CSS-wide keywords — so `@keyframes none` is
        // invalid and a browser ignores it. Renaming it would turn an invalid
        // rule into a valid private one and start an animation the source CSS
        // never defined. Quoted, the same text is a legal name.
        if (
          first.type === "Identifier" &&
          KEYFRAMES_RESERVED_NAMES.has(original.toLowerCase())
        ) {
          return;
        }
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
          const original = singleName(declaration.value);
          if (original === undefined || original.name === "") continue;
          replaceValueWithString(
            declaration.value as csstree.Value,
            namespacedGlobalName(original.name, scopeClass)
          );
          effective = original.name;
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
  css: CssTreeApi,
  nestingBudget = 0
): void {
  if (map.keyframes.size === 0 && map.fontFamilies.size === 0) return;

  rewriteNestedRules(ast, map, css, nestingBudget);

  css.walk(ast, {
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

      // A custom property can hold a name that only becomes a reference after
      // `var()` substitution — `--anim: fade` read by `animation: var(--anim)`.
      // Nothing here can see that use, so the value is matched directly: a
      // custom property whose WHOLE value is a name this stylesheet defines is
      // rewritten with it. The trade is a custom property holding that same
      // word as literal text, which would come back namespaced; against a
      // definition renamed out from under every var() reference to it, which
      // breaks silently and leaves nothing in the output to diagnose.
      //
      // Read from `Raw`, because that is what a custom property's value parses
      // as: it may hold arbitrary tokens, so the parser does not interpret it.
      // Parsed here rather than compared as text, since the text is a spelling
      // and the name is what the spelling denotes — `--f: "My Font"` holds the
      // family `My Font`, and matching the quotes along with it would find
      // nothing and leave the reference behind after the definition moved.
      if (property.startsWith("--")) {
        if (value.type !== "Raw") return;
        rewriteCustomProperty(value, map, css);
        return;
      }

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
 *
 * The LAST measurement is the size, not the first, because the tokens before it
 * can be measurements too: `font-stretch` takes a percentage, so the `87.5%` of
 * `font: 87.5% 16px Brand` is the stretch and reading it as the size would put
 * the family list one token early. Reading from the end lands on the size in
 * that case and on the line-height in `font: 16px/1.5 Brand`, and the family
 * follows both.
 *
 * A word size is consulted only when there is no measurement at all, which
 * keeps a family named after one — `font: 16px small` — being read as the size
 * of a declaration that has already given one.
 */
function familyStartIndex(value: csstree.Value): number | undefined {
  const nodes = value.children.toArray();
  // A comma only ever appears in the family list, so the size is somewhere
  // before the first one. Without that bound the search runs into the families
  // themselves, and `font: 16px Brand, var(--fallback)` picks the `var()` as
  // its size — leaving no family range at all and `Brand` unrewritten.
  const firstComma = nodes.findIndex(
    node => node.type === "Operator" && node.value === ","
  );
  const head = firstComma === -1 ? nodes : nodes.slice(0, firstComma);

  const measured = lastIndexWhere(
    head,
    node =>
      node.type === "Dimension" ||
      node.type === "Percentage" ||
      node.type === "Number" ||
      // `clamp()`, `calc()` and `var()` all stand in for a length here.
      node.type === "Function"
  );
  const sizeAt =
    measured !== -1
      ? measured
      : lastIndexWhere(
          head,
          node =>
            node.type === "Identifier" &&
            FONT_SIZE_KEYWORDS.has(decodeIdentifier(node.name).toLowerCase())
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
    //
    // Identifiers only: a keyword is a keyword only when written as one.
    // `animation-name: none` cancels the animation, while `animation-name:
    // "none"` names the keyframes rule `@keyframes "none"` — the quotes are
    // exactly what tells the two apart, so skipping the quoted form would leave
    // a reference pointing at a name that no longer exists.
    if (node.type === "Identifier" && skip.has(original.toLowerCase()))
      continue;
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
    if (run.length > 0 && parts.length > 0 && runIsFamilyName(run)) {
      const joined = parts.join(" ").toLowerCase();
      // A lone bare identifier that names a generic family or a CSS-wide
      // keyword is that keyword, not a family — even when the stylesheet
      // defines a face called `"serif"`, because the quotes are what tell the
      // two apart. A quoted reference reaches here as a String and is a name.
      const bareKeyword =
        run.length === 1 &&
        run[0]?.data.type === "Identifier" &&
        FONT_FAMILY_KEYWORDS.has(joined);
      const namespaced = bareKeyword ? undefined : families.get(joined);
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

/**
 * Follow this stylesheet's renamed names into a custom property.
 *
 * A custom property's value is not parsed by the stylesheet parser — it may
 * hold any token sequence — and where it ends up is decided by a `var()` this
 * cannot see. So the value is parsed here, as a value, and read for what it
 * would mean once something substitutes it.
 *
 * Read by exactly the readers the declarations use, with no shorter path for
 * the one-name case. A custom property holding a single name is not a simpler
 * problem than one holding a shorthand fragment — it is the same problem, and
 * every guard those readers carry applies to it: `--anim: none` is the keyword
 * that cancels an animation even where the stylesheet defines `@keyframes
 * "none"`, `--f: serif` is the generic family even where a face is called
 * `"serif"`, and a name compared decoded has to be escaped again on the way
 * out. A branch that matched the whole value directly kept acquiring those
 * three rules one at a time, each after the declarations already had it.
 *
 * The trade is the one this whole path already makes: a custom property holding
 * a defined name as literal text comes back namespaced. Against it is a
 * definition renamed out from under every `var()` that referenced it, which
 * breaks silently and leaves nothing in the output to diagnose.
 */
function rewriteCustomProperty(
  value: csstree.Raw,
  map: GlobalNameMap,
  css: CssTreeApi
): void {
  const text = value.value.trim();
  if (text === "") return;

  const parsed = parseValue(text, css.parse);
  if (parsed === undefined) return;

  const before = css.generate(parsed);
  if (map.keyframes.size > 0) {
    rewriteKeyframeNames(parsed, map.keyframes, ANIMATION_KEYWORDS, 0);
  }
  if (map.fontFamilies.size > 0) {
    // Which shorthand the fragment belongs to is decided the same way the
    // declarations decide it. A fragment carrying a font SIZE can only be a
    // `font` shorthand, so the family list starts after it — otherwise
    // `--font: italic 16px Arial` would have its style keyword rewritten as a
    // family by a stylesheet that happens to define a face called `italic`. A
    // fragment with no size cannot be that shorthand at all, so it is read as a
    // family list from the start.
    const start = familyStartIndex(parsed) ?? 0;
    rewriteFontFamilies(parsed, map.fontFamilies, start);
  }
  const after = css.generate(parsed);
  // Written only when a name actually moved, so a value this had no business
  // touching is not silently reformatted by the generator on its way out.
  if (after !== before) value.value = after;
}

/**
 * Follow the renamed names into rules nested inside other rules.
 *
 * A nested rule is a `Raw` child of its parent's block in this parser, not a
 * structure, so the declaration walk never sees inside it. Left alone, a
 * stylesheet's own `@keyframes` is renamed while `.a { .b { animation: fade } }`
 * still asks for `fade` — the animation resolves to nothing, and nothing in the
 * output says why. The same applies to a nested `font-family`.
 *
 * Each level is parsed, rewritten by the same pass, and written back only if a
 * name actually moved. The budget is the caller's, and it is the reason there
 * is one: every level is re-parsed from the text of the level above it, so
 * following them without a bound is work quadratic in the sheet's own size.
 */
function rewriteNestedRules(
  ast: csstree.CssNode,
  map: GlobalNameMap,
  css: CssTreeApi,
  budget: number
): void {
  if (budget <= 0) return;

  css.walk(ast, {
    enter(node: csstree.CssNode) {
      if (node.type !== "Rule" && node.type !== "Atrule") return;
      const block = node.block;
      if (block == null) return;
      block.children.forEach((child: csstree.CssNode) => {
        if (child.type !== "Raw" || child.value.trim() === "") return;
        let inner: csstree.CssNode;
        try {
          inner = css.parse(child.value, { context: "stylesheet" });
        } catch {
          // Unreadable to the parser is not this pass's problem to solve: the
          // origin scan judges the same text and removes it if it cannot be
          // checked.
          return;
        }
        const before = css.generate(inner);
        rewriteNameReferences(inner, map, css, budget - 1);
        const after = css.generate(inner);
        if (after !== before) child.value = after;
      });
    },
  });
}

/** A raw value parsed as a CSS value, or `undefined` if it is not one. */
function parseValue(
  text: string,
  parse: typeof csstree.parse
): csstree.Value | undefined {
  try {
    const node = parse(text, { context: "value" });
    return node.type === "Value" ? node : undefined;
  } catch {
    return undefined;
  }
}

/** The index of the last node a test accepts, or -1. */
function lastIndexWhere(
  nodes: readonly csstree.CssNode[],
  accepts: (node: csstree.CssNode) => boolean
): number {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (node !== undefined && accepts(node)) return index;
  }
  return -1;
}

/**
 * Whether a run of nodes spells one family the way CSS allows.
 *
 * `<family-name>` is one string OR a run of identifiers, and the alternation is
 * exclusive. `font-family: "My" Font, serif` is therefore invalid and the
 * browser drops the whole declaration — so joining the run and matching it
 * would make a private face apply exactly where the author's CSS applied
 * nothing.
 */
function runIsFamilyName(
  run: readonly csstree.ListItem<csstree.CssNode>[]
): boolean {
  const first = run[0];
  if (first === undefined) return false;
  if (first.data.type === "String") return run.length === 1;
  return run.every(item => item.data.type === "Identifier");
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
