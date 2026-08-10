/**
 * Parser-backed page-level custom-CSS sanitizer + scoper (spec §8/§14). React-free.
 *
 * Fails closed: on a fatal parse error returns nothing. Drops at-rules other
 * than @media/@supports, refuses any `url()` that leaves this origin, drops the
 * declarations a denylist still has to catch, prefixes every selector with the
 * page scope class so custom CSS cannot leak onto the host site, and escapes the
 * one sequence that could end the `<style>` element this is emitted into.
 *
 * Everything it removes is reported. A declaration that vanished without
 * explanation is the thing authors file bugs about, and the editor has nowhere
 * to say "your Google Fonts import went and here is why" unless this says so.
 */
import { asciiLower, decodeIdentifier } from "@nextlyhq/blocks-engine";
import * as csstree from "css-tree";
import type { CssNode, List, ListItem, Rule } from "css-tree";

import {
  fontFaceHasSrc,
  namespaceDefinedNames,
  rewriteNameReferences,
} from "./css-global-names";
import {
  attrFetchesFromDom,
  functionName,
  isRemoteUrl,
  MAX_VALUE_NESTING,
  SUBSTITUTION_FUNCTIONS,
  TEXT_ARGUMENT_FUNCTIONS,
} from "./url-policy";

/** Why one thing was removed, in a sentence the author can act on. */
export interface CssWarning {
  code: "remote-url" | "unsafe-value" | "unsupported-at-rule" | "unchecked";
  message: string;
}

/** Sanitized CSS, and everything that was taken out of it. */
export interface SanitizedCss {
  css: string;
  warnings: CssWarning[];
}

/**
 * Why custom CSS refuses an origin its block styles may be allowed.
 *
 * Custom CSS is the one place where an author controls the SELECTOR as well as
 * the URL. `input[value^="a"] { background: url(...) }` fires a request only
 * when the selector matches, so a page full of them reads a value out one
 * character at a time.
 *
 * Refusing it here is only half of the boundary, because the other half of the
 * pair need not be written here. A block's `backgroundImage` is compiled into
 * the same stylesheet as this output, so a remote image there plus a custom
 * selector that suppresses it conditionally leaks by the request's ABSENCE,
 * with no URL in the custom CSS for this to refuse. `style-compiler.ts`
 * therefore applies the same origin rule to structured style values, allowing
 * only hosts the site has declared. Neither half is a channel without the
 * other, and each is checked where it is written.
 *
 * Both read `url-policy.ts`: which strings can fetch, and how a URL normalises,
 * are answered once so the two surfaces cannot disagree about what
 * `image-set("https://…")` is.
 */

/**
 * What one scan concluded, which is not always "a URL" or "no URL".
 *
 * A scan can also run out of the depth it is willing to follow, and that is a
 * third answer rather than a shade of the second. Collapsing it into "found a
 * remote URL" removed valid CSS while telling the author it referred to a host
 * it never mentioned, which sends them looking for a URL that does not exist.
 * Both outcomes still remove the rule — unreadable is not the same as safe —
 * but they say different things, so they are different values.
 */
type CssFinding =
  | { kind: "remote"; url: string }
  | { kind: "unreadable"; reason: "depth" | "syntax" | "attr" };

/** The first `url()` in a declaration that leaves this origin, if any. */
function firstRemoteUrl(decl: csstree.Declaration): CssFinding | undefined {
  // A custom property's value is checked as though it could land anywhere,
  // because it can. `--probe: "https://evil"` is a bare string here and an
  // image URL the moment something writes `image-set(var(--probe) 1x)`, and
  // which of those it becomes is decided at the USE, in a declaration that
  // contains no string of its own to inspect. Nothing at this point knows,
  // so a remote-looking value in a custom property is refused.
  const anywhere = decl.property.startsWith("--");
  return remoteUrlInValue(decl.value, 0, [], anywhere);
}

/**
 * How deep a nested rule may go before the scan stops following it.
 *
 * A bound is required, and the reason is cost rather than taste. Each level is
 * re-parsed from the text of the level above it, and that text is a substring
 * of its parent, so following d levels of a sheet of length n parses O(n·d)
 * characters — quadratic in the input, since d can itself grow with n. Measured
 * on this parser, a 23 KB sheet nested 3000 deep took 9.5 seconds to scan, and
 * custom CSS carries no length limit to make that impossible. The bound is what
 * keeps the work linear in the input.
 *
 * The value is set well past real CSS instead of at it. Style guides put hand
 * authored nesting at three levels; the deepest stylesheet in this repository,
 * the admin panel's compiled output, reaches five. Sixteen clears both several
 * times over while holding the worst case to sixteen passes over the sheet.
 *
 * Kept separate from {@link MAX_VALUE_NESTING} because the two bound different
 * things — rules inside rules against fallbacks inside values — and evidence
 * about one says nothing about the other.
 */
export const MAX_RULE_NESTING = 16;

// The value-nesting bound belongs with the rest of the origin policy, which
// walks the same fallbacks; re-exported so the published surface is unchanged.
export { MAX_VALUE_NESTING } from "./url-policy";

/**
 * The first remote URL reachable in one value, if any.
 *
 * Three shapes can hold one, and missing any of them reopens the channel:
 *
 * A `Url` node, which is the obvious case.
 *
 * A `String` node used as a function ARGUMENT, since `image-set("https://…")`
 * fetches while `content: "https://…"` is a caption. Which functions take text
 * is the allowlist above; anything unclassified is treated as able to fetch.
 *
 * A `Raw` node, which is where css-tree puts anything it does not parse into a
 * value — a custom property's whole value, and a `var()` fallback nested inside
 * an otherwise ordinary one. Both reach the network: the browser substitutes
 * the fallback in, and `var(--probe)` resolves the property. Re-parsing puts
 * them back within reach of the two checks above, so "remote" keeps ONE
 * definition rather than growing a second that reads text.
 */
function remoteUrlInValue(
  value: csstree.CssNode,
  depth: number,
  outerPosition: readonly string[] = [],
  anyPositionIsUrl = false
): CssFinding | undefined {
  let found: string | undefined;
  // An `attr()` reading a URL out of the DOM, where there is no literal for
  // this walk to judge. Recorded rather than returned in place so a remote URL
  // found elsewhere in the same value still wins: it names a host, which is a
  // more useful thing to tell the author than "something was unreadable".
  let attrFetch = false;
  // One walk, maintaining the enclosing-function stack, because all three
  // shapes below depend on where in the value they sit.
  const functions: string[] = [];
  const raws: { text: string; position: string[] }[] = [];
  csstree.walk(value, {
    enter(node: csstree.CssNode) {
      if (node.type === "Function") functions.push(functionName(node.name));
      if (found !== undefined) return;
      // A custom property can land anywhere, so there every `attr()` is a
      // potential fetch; elsewhere the enclosing function decides.
      if (
        node.type === "Function" &&
        functionName(node.name) === "attr" &&
        (anyPositionIsUrl ||
          attrFetchesFromDom(node, positionOf(functions, outerPosition)))
      ) {
        attrFetch = true;
      }
      // `.value` is decoded on Url and String alike, so a scheme spelled with
      // CSS escapes is read the way a browser resolves it, not as written.
      if (node.type === "Url") {
        if (isRemoteUrl(node.value)) found = node.value;
        return;
      }
      if (node.type === "Raw") {
        // Carries its position with it: re-parsing loses the surrounding
        // functions otherwise, and `image-set(var(--x, "https://…") 1x)` is a
        // fetch precisely BECAUSE of the `image-set` the Raw sits inside.
        raws.push({
          text: node.value,
          position: positionOf(functions, outerPosition),
        });
        return;
      }
      if (node.type !== "String") return;
      if (anyPositionIsUrl) {
        if (isRemoteUrl(node.value)) found = node.value;
        return;
      }
      const position = positionOf(functions, outerPosition);
      const enclosing = position[position.length - 1];
      // No enclosing function once substitutions are ignored: the string sits
      // where a bare string sits, and a bare string is text. `background:
      // var(--x, "https://…")` is not a URL, because `background: "https://…"`
      // is not one either.
      if (enclosing === undefined) return;
      if (TEXT_ARGUMENT_FUNCTIONS.has(enclosing)) return;
      if (isRemoteUrl(node.value)) found = node.value;
    },
    leave(node: csstree.CssNode) {
      if (node.type === "Function") functions.pop();
    },
  });
  if (found !== undefined) return { kind: "remote", url: found };
  if (attrFetch) return { kind: "unreadable", reason: "attr" };

  for (const raw of raws) {
    if (raw.text.trim() === "") continue;
    // Unreadable is not the same as safe. This is the one place the check
    // cannot see what it is judging, so it refuses rather than waves it
    // through — but it refuses as itself, not disguised as a URL it never saw.
    if (depth >= MAX_VALUE_NESTING) {
      return { kind: "unreadable", reason: "depth" };
    }
    let reparsed: csstree.CssNode;
    try {
      reparsed = csstree.parse(raw.text, { context: "value" });
    } catch {
      return { kind: "unreadable", reason: "syntax" };
    }
    const nested = remoteUrlInValue(
      reparsed,
      depth + 1,
      raw.position,
      anyPositionIsUrl
    );
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * The enclosing functions that decide whether a string is a URL.
 *
 * Substitutions are dropped because they stand in for a value rather than
 * holding one, and the outer position is prepended so a re-parsed `Raw` is
 * judged where it actually sits rather than as though it stood alone.
 */
/**
 * The first remote URL inside a nested rule this parser left as `Raw`.
 *
 * Recursive for the same reason the value walk is: an inner rule's OWN nested
 * rule comes back as `Raw` again, so following one level finds
 * `.a { .b { url(…) } }` and misses `.a { .b { .c { url(…) } } }`. Bounded, and
 * a rule deeper than the bound is refused rather than followed.
 */
/**
 * Every `Raw` anywhere in a parsed fragment.
 *
 * Deliberately not "every `Raw` in a block", which is what this collected
 * before and what let two shapes through in turn. A rule nested in an at-rule
 * hangs off the at-rule's block rather than the enclosing rule's; and a
 * declaration WRITTEN AFTER a nested rule survives a stylesheet re-parse as a
 * top-level `Raw` belonging to no block at all, which is how
 * `.a { .child { } background: url(…) }` stayed whole.
 *
 * There is no property of a `Raw`'s parent that predicts whether it needs
 * reading, so the parent is not consulted. Anything the parser could not read
 * is anything the parser could not read.
 */
function allRawText(root: csstree.CssNode): string[] {
  const found: string[] = [];
  csstree.walk(root, {
    visit: "Raw",
    enter(node: csstree.Raw) {
      if (node.value.trim() !== "") found.push(node.value);
    },
  });
  return found;
}

/**
 * The first remote URL among declarations in a fragment that holds only them.
 *
 * The leftover after a nested rule is a declaration, not a rule, so re-parsing
 * it as a stylesheet yields nothing to walk. Parsed as the declaration list it
 * actually is, it becomes declarations the ordinary value check can read. A
 * fragment that is not a plain declaration list comes back as `Raw` again and
 * yields nothing here, which is correct — the rule path handles those.
 */
function remoteUrlInRawDeclarations(text: string): {
  read: boolean;
  finding?: CssFinding;
} {
  let parsed: csstree.CssNode;
  try {
    parsed = csstree.parse(text, { context: "declarationList" });
  } catch {
    return { read: false };
  }
  let read = false;
  let finding: CssFinding | undefined;
  csstree.walk(parsed, {
    visit: "Declaration",
    enter(decl: csstree.Declaration) {
      read = true;
      if (finding === undefined) finding = firstRemoteUrl(decl);
    },
  });
  return { read, finding };
}

/**
 * Remove the sources in a `src` descriptor that reach off this origin.
 *
 * Returns whether at least one usable source survived. A descriptor is a
 * comma-separated list, so each entry is judged on its own and the declaration
 * is only lost when nothing in it can be loaded.
 */
function dropRemoteSources(decl: csstree.Declaration): boolean {
  const value = decl.value;
  if (value.type !== "Value") return false;

  // Split into comma-separated entries, keeping the list items so the survivors
  // can be reassembled in place.
  const entries: ListItem<CssNode>[][] = [[]];
  const commas: ListItem<CssNode>[] = [];
  value.children.forEach((child: CssNode, item: ListItem<CssNode>) => {
    if (child.type === "Operator" && child.value === ",") {
      commas.push(item);
      entries.push([]);
      return;
    }
    entries[entries.length - 1]?.push(item);
  });

  const keep: ListItem<CssNode>[][] = [];
  const drop: ListItem<CssNode>[] = [];
  for (const entry of entries) {
    if (entry.length === 0) continue;
    const usable = entry.every(
      item => remoteUrlInValue(item.data, 0, [], false) === undefined
    );
    if (usable) keep.push(entry);
    else drop.push(...entry);
  }

  if (keep.length === 0) return false;

  for (const item of drop) value.children.remove(item);
  // Every separator is removed and the survivors re-joined, so a dropped entry
  // cannot leave a dangling or doubled comma behind.
  for (const item of commas) value.children.remove(item);
  keep.forEach((entry, index) => {
    if (index === 0) return;
    const first = entry[0];
    if (first !== undefined) {
      value.children.insertData({ type: "Operator", value: "," }, first);
    }
  });
  return true;
}

function remoteUrlInRawRule(
  text: string,
  depth: number
): CssFinding | undefined {
  if (depth >= MAX_RULE_NESTING) return { kind: "unreadable", reason: "depth" };
  let inner: csstree.CssNode;
  try {
    inner = csstree.parse(text, { context: "stylesheet" });
  } catch {
    return { kind: "unreadable", reason: "syntax" };
  }
  let remote: CssFinding | undefined;
  csstree.walk(inner, {
    visit: "Declaration",
    enter(decl: csstree.Declaration) {
      if (remote === undefined) remote = firstRemoteUrl(decl);
    },
  });
  if (remote !== undefined) return remote;
  for (const raw of allRawText(inner)) {
    // Two readings, because a `Raw` here is either a nested rule or the
    // declarations written beside one, and which it is cannot be told from
    // where it sits.
    const asDeclarations = remoteUrlInRawDeclarations(raw);
    if (asDeclarations.finding !== undefined) return asDeclarations.finding;
    // Whether the declaration reading UNDERSTOOD the text is also what says
    // there is nothing left to recurse into. A plain declaration re-parsed as a
    // stylesheet comes back as the identical `Raw`, so recursing on it would
    // descend forever and report the depth bound against perfectly ordinary
    // CSS — which it did, until this stopped at the point progress stops.
    if (asDeclarations.read) continue;
    const nested = remoteUrlInRawRule(raw, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function positionOf(
  functions: readonly string[],
  outerPosition: readonly string[]
): string[] {
  return [
    ...outerPosition,
    ...functions.filter(name => !SUBSTITUTION_FUNCTIONS.has(name)),
  ];
}

function isDangerousValue(val: string): boolean {
  const v = val.toLowerCase();
  return (
    v.includes("javascript:") ||
    v.includes("vbscript:") ||
    /expression\s*\(/.test(v) ||
    /url\(\s*['"]?\s*data:/.test(v)
  );
}

/**
 * Escape the sequences that would end the `<style>` element or open an HTML
 * comment inside it.
 *
 * This runs on the GENERATED text rather than the source, because the two differ
 * in exactly the way that matters: `csstree.generate` decodes CSS escapes into
 * literal characters, so `content: "\3c /style>"` — which contains no markup as
 * written — serializes to `content:"</style>"`, and the HTML parser ends the
 * stylesheet there. Filtering the input cannot see that coming, and the value
 * cannot be fixed in the AST either: css-tree re-encodes a backslash placed in a
 * string value, turning the escape into a literal backslash.
 *
 * Replacing `</` is safe because `</` cannot occur anywhere in valid CSS except
 * inside a string or a url, which is the only place this needs to reach. A
 * media range writes `<` followed by a space or a value, never a slash. `\3c` is
 * the same character to a CSS parser, so an author who wrote `content: "</div>"`
 * still gets `</div>` on the page; it is only the bytes the HTML parser sees
 * that change.
 */
function escapeMarkupSequences(css: string): string {
  return css.replaceAll("</", "\\3c /").replaceAll("<!", "\\3c !");
}

/**
 * The at-rules custom CSS may contain.
 *
 * `@media` and `@supports` wrap ordinary rules, so everything inside them is
 * already reached by the scoping and by the checks below. `@keyframes` and
 * `@font-face` are here on a condition rather than outright: each defines a
 * name CSS resolves for the whole document, so they are only safe once those
 * names carry the scope's namespace.
 *
 * Everything else is refused, and the list is short on purpose. `@import`
 * fetches a stylesheet this cannot see inside, `@layer` reorders the host's
 * cascade, `@page` reaches the printed document — none of them are things a
 * region of somebody's page should be able to do.
 */
const SUPPORTED_AT_RULES = new Set([
  "media",
  "supports",
  "keyframes",
  "font-face",
]);

/** The same list as prose, so a refusal can say what IS allowed. */
const SUPPORTED_AT_RULE_LIST = "@media, @supports, @keyframes and @font-face";

/** Whether the walker is currently inside a `@keyframes` block. */
function insideKeyframes(atrule: csstree.Atrule | null): boolean {
  return (
    atrule !== null && asciiLower(decodeIdentifier(atrule.name)) === "keyframes"
  );
}

export function sanitizeCustomCss(
  css: string,
  scopeClass: string,
  /**
   * A class nested OUTSIDE `scopeClass`, when the caller has one.
   *
   * Prepended as a second ancestor rather than replacing `scopeClass`, so both boundaries hold:
   * `.<outer> .<scope> sel`. Used to separate two documents that resolve to the same inner class —
   * a node class is a hash of a key, not of a document, so the same reusable block rendered on two
   * pages produces the same inner class and the later stylesheet would otherwise restyle both.
   */
  outerClass?: string
): SanitizedCss {
  if (!css) return { css: "", warnings: [] };

  const warnings: CssWarning[] = [];
  const seen = new Set<string>();
  /** Report once per distinct message: ten identical drops teach nothing. */
  const warn = (code: CssWarning["code"], message: string): void => {
    const key = `${code}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({ code, message });
  };

  let ast: CssNode;
  try {
    ast = csstree.parse(css);
  } catch {
    // The header promises everything removed is reported, and losing the whole
    // sheet in silence is the loudest possible contradiction of that: the
    // author sees their CSS gone with nothing to read.
    return {
      css: "",
      warnings: [
        {
          // Unreadable, not unsafe. Nothing here judged the CSS and found a
          // problem with it; the parser never got far enough to judge.
          code: "unchecked",
          message:
            "This CSS could not be parsed, so none of it was applied. Check for an unclosed brace, quote or comment.",
        },
      ],
    };
  }

  // Drop at-rules this cannot support. The four that survive split in two:
  // `@media` and `@supports` wrap ordinary rules, which the scoping and the
  // checks below already reach; `@keyframes` and `@font-face` define a
  // document-global NAME, and are allowed only because those names are
  // namespaced further down — see `core/css-global-names`.
  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      // Decoded first: `@\6d edia` IS `@media` to a browser, so a raw
      // comparison is one an author can write straight past.
      // ASCII folding, because that is what CSS applies to a keyword. U+212A
      // KELVIN SIGN lowercases to "k" in JavaScript and is its own character to
      // CSS, so `@\u212Aeyframes` would enter the allowlist here and then be
      // renamed into a valid private rule — turning an at-rule the browser
      // ignores into one that shadows an animation the host page provides.
      const name = asciiLower(decodeIdentifier((node as csstree.Atrule).name));
      if (SUPPORTED_AT_RULES.has(name)) return;
      warn(
        "unsupported-at-rule",
        `"@${name}" is not allowed in custom CSS, so that rule was removed. You can use ${SUPPORTED_AT_RULE_LIST} here.`
      );
      list.remove(item);
    },
  });

  // Drop declarations that reach off this origin, or that a denylist still has
  // to catch.
  csstree.walk(ast, {
    visit: "Declaration",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      const decl = node as csstree.Declaration;
      if (!list || !item) return;
      const finding = firstRemoteUrl(decl);
      if (finding !== undefined) {
        // A `src` descriptor is a LIST of places to try, and the whole point of
        // the list is that some of them fail. Removing the declaration because
        // one entry is remote takes the self-hosted font with it, and the face
        // then loses its only source and is dropped — so an author who added a
        // remote fallback to a font they uploaded correctly loses the upload.
        // Dropping just the offending entry keeps what the author is allowed to
        // load, and the warning still says the remote one went.
        if (
          asciiLower(decodeIdentifier(decl.property)) === "src" &&
          dropRemoteSources(decl)
        ) {
          warn(
            "remote-url",
            `A font source in "${decl.property}" is not on this site, so that source was removed and the others kept. Custom CSS may only load fonts from this site's own origin.`
          );
          return;
        }
        if (finding.kind === "remote") {
          warn(
            "remote-url",
            `"${decl.property}" refers to "${finding.url}", which is not on this site. Custom CSS may only load from this site's own origin; use a same-origin path, or set the image through the block's background control, which can load from the hosts your site allows.`
          );
        } else if (finding.reason === "depth") {
          warn(
            "unchecked",
            `"${decl.property}" nests values more than ${MAX_VALUE_NESTING} levels deep, so it could not be checked and was removed. Shorten the fallback chain.`
          );
        } else if (finding.reason === "attr") {
          warn(
            "unchecked",
            `"${decl.property}" builds a URL from an attr() value, whose destination is only known once the page renders, so it could not be checked and was removed. CSS cannot load a URL from an attribute in any case; set the image through the block's background control, which can load from the hosts your site allows.`
          );
        } else {
          warn(
            "unchecked",
            `"${decl.property}" could not be parsed, so it could not be checked and was removed.`
          );
        }
        list.remove(item);
        return;
      }
      const value = csstree.generate(decl.value);
      if (isDangerousValue(value)) {
        warn(
          "unsafe-value",
          `"${decl.property}" uses a value that is not allowed in custom CSS, so the declaration was removed.`
        );
        list.remove(item);
      }
    },
  });

  // A `@font-face` with no `src` left declares a family that can never load,
  // and CSS resolves it to nothing rather than falling back — so text asking
  // for that family renders in the browser's default instead of the author's
  // next choice. Dropping the rule restores the fallback and says why.
  //
  // BEFORE the names are namespaced, and that order is the whole point. A face
  // whose only `src` reached off this origin has just lost it above; if its
  // family were recorded first, every reference to that family would be
  // rewritten to a private name no surviving rule defines. For a family the
  // author never owned — an installed font, or one the host provides — that
  // turns a working fallback list into a missing name.
  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      const atrule = node as csstree.Atrule;
      if (asciiLower(decodeIdentifier(atrule.name)) !== "font-face") return;
      if (fontFaceHasSrc(atrule)) return;
      warn(
        "unsupported-at-rule",
        "A @font-face rule was removed because it has no font file this site can load. Custom CSS may only load fonts from this site's own origin, so upload the font file and point `src` at a path on this site."
      );
      list.remove(item);
    },
  });

  // Namespace what the author defined, and point their own references at it.
  const cssTree = {
    walk: csstree.walk,
    parse: csstree.parse,
    generate: csstree.generate,
  };
  const definedNames = namespaceDefinedNames(ast, scopeClass, cssTree);
  // The same bound the origin scan follows nested rules with, passed in rather
  // than restated there: both walk the same nesting for the same reason, and
  // two numbers would let one of them reach a level the other reports as too
  // deep to check.
  rewriteNameReferences(ast, definedNames, cssTree, MAX_RULE_NESTING);

  // A nested rule is a `Raw` child of its parent's block in css-tree 2.3, not a
  // Declaration, so the declaration walk above never sees inside it and
  // `.probe { background: url("https://evil") }` nested in a scoped rule
  // reached the page untouched. `Raw` is where the parser puts what it did not
  // read, and every level it appears at has to be followed: the value root, a
  // fallback nested in a value, and here.
  //
  // Both rules and at-rules are walked, because both have blocks and a rule
  // nested in either arrives as `Raw`. Reading only `Rule` blocks let
  // `.a { @media (…) { .probe { url(…) } } }` through untouched: its inner rule
  // is a `Raw` child of the `@media`, not of `.a`.
  csstree.walk(ast, {
    enter(node: CssNode) {
      if (node.type !== "Rule" && node.type !== "Atrule") return;
      const block = node.block;
      if (block == null) return;
      const items: ListItem<CssNode>[] = [];
      block.children.forEach((child: CssNode, item: ListItem<CssNode>) => {
        if (child.type === "Raw") items.push(item);
      });
      for (const item of items) {
        const raw = item.data;
        if (raw.type !== "Raw" || raw.value.trim() === "") continue;
        // Judged whole rather than edited: the text is a rule this parser could
        // not read, so there is no structure to remove a declaration from. If
        // anything inside it reaches another origin the nested rule goes, which
        // is the same trade the declaration path makes.
        // Counted from one, not zero: this `Raw` is the rule nested inside the
        // one being walked, so it already sits at the second level. Starting at
        // zero made the bound permit one level more than the warning claimed.
        const finding = remoteUrlInRawRule(raw.value, 1);
        if (finding === undefined) continue;
        if (finding.kind === "remote") {
          warn(
            "remote-url",
            `A nested rule refers to "${finding.url}", which is not on this site. Custom CSS may only load from this site's own origin; use a same-origin path, or set the image through the block's background control, which can load from the hosts your site allows.`
          );
        } else if (finding.reason === "depth") {
          warn(
            "unchecked",
            `A nested rule is more than ${MAX_RULE_NESTING} levels deep, so it could not be checked and was removed. Flatten the nesting.`
          );
        } else {
          warn(
            "unchecked",
            `A nested rule could not be parsed, so it could not be checked and was removed.`
          );
        }
        block.children.remove(item);
      }
    },
  });

  // Scope each rule's own selectors under the page root class.
  //
  // Walked from the Rule rather than by visiting every Selector, because a
  // Selector also appears inside `:not()`, `:is()`, `:where()` and `:has()`, and
  // prefixing those changes what the author wrote: `.a:has(> .b)` would become
  // `.a:has(.scope > .b)`, which asks a different question. The arguments of a
  // functional pseudo-class are already confined by the compound they hang off,
  // so scoping the outer selector is what confines the whole rule.
  csstree.walk(ast, {
    visit: "Rule",
    enter(node: Rule) {
      // A `@keyframes` step is parsed as a Rule with a SelectorList prelude,
      // but `from`, `to` and `50%` select no elements — they are positions in
      // the animation. Prefixing one produces `.scope from`, which matches
      // nothing, so the whole animation silently stops running. Scoping is
      // also unnecessary here: a step can only ever apply to whatever the
      // animation is attached to, and that selector is scoped already.
      if (insideKeyframes(this.atrule)) return;
      if (node.prelude.type !== "SelectorList") return;
      for (const sel of node.prelude.children) {
        if (sel.type !== "Selector") continue;
        const first = sel.children.first;
        const outer =
          outerClass === undefined || outerClass === ""
            ? undefined
            : outerClass;
        const firstClass =
          first != null && first.type === "ClassSelector"
            ? first.name
            : undefined;
        // Already under the outermost boundary: nothing to add.
        if (outer !== undefined && firstClass === outer) continue;
        // Anchored to the inner class but not the outer one. This is the shape the `selector`
        // keyword produces, since it is rewritten to the node class BEFORE this runs — so
        // treating it as fully scoped would silently skip the document boundary for exactly the
        // custom CSS most authors write.
        const needsInner = firstClass !== scopeClass;
        if (needsInner) {
          sel.children.prependData({ type: "Combinator", name: " " });
          sel.children.prependData({ type: "ClassSelector", name: scopeClass });
        }
        if (outer === undefined) {
          if (!needsInner) continue;
        } else {
          // Outermost prepended LAST, because each prepend goes to the front: this leaves
          // `.<outer> .<scope> sel` rather than the reverse.
          sel.children.prependData({ type: "Combinator", name: " " });
          sel.children.prependData({ type: "ClassSelector", name: outer });
        }
      }
    },
  });

  return { css: escapeMarkupSequences(csstree.generate(ast)), warnings };
}

/**
 * Per-block custom CSS (spec §4.4). Authors write CSS using the Elementor-style
 * `selector` keyword to mean "this block's root". We replace `selector` with the
 * block's scope class, then run every other selector through the same scoping +
 * declaration sanitize as page CSS so nothing can escape the block.
 */
export function sanitizeBlockCss(
  css: string,
  scopeClass: string,
  /**
   * The document's own class, nested outside the block's.
   *
   * A node class is a hash of a key rather than of a document, so two pages holding the same
   * reusable block resolve to the same node class — and without this the later stylesheet restyles
   * both. Nested rather than substituted for the reason the comment below gives.
   */
  documentScope?: string
): SanitizedCss {
  if (!css) return { css: "", warnings: [] };
  // Replace the `selector` keyword (word-boundary, not part of .foo-selector).
  const withScope = css.replace(/(^|[^\w.#-])selector\b/g, `$1.${scopeClass}`);
  // The NODE class, and only it. Anchoring to a document scope instead would
  // swap one boundary for the other rather than nesting them: `p { color: red }`
  // would emit `.<document> p` and restyle every matching element in every other
  // block. Separating two documents that hold the same node id is the node
  // class's own job, not this one's.
  return sanitizeCustomCss(withScope, scopeClass, documentScope);
}
