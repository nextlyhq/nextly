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
import * as csstree from "css-tree";
import type { CssNode, List, ListItem, Rule } from "css-tree";

/** Why one thing was removed, in a sentence the author can act on. */
export interface CssWarning {
  code: "remote-url" | "unsafe-value" | "unsupported-at-rule";
  message: string;
}

/** Sanitized CSS, and everything that was taken out of it. */
export interface SanitizedCss {
  css: string;
  warnings: CssWarning[];
}

/** Any `scheme:` prefix, tolerating the whitespace a value may carry. */
const URL_SCHEME = /^\s*[a-z][a-z0-9+.-]*:/i;

/**
 * Whether a `url()` target leaves this origin.
 *
 * An allowlist by absence: a URL that carries no scheme and no host resolves
 * against the page's own origin, and everything else is refused. That covers
 * `javascript:` and `data:` without naming them, which is the point — a
 * denylist has to predict the next dangerous scheme and this does not.
 *
 * The reason for refusing plain `https:` here, which is safe in a block's own
 * style value, is that custom CSS is the one place where an author controls the
 * SELECTOR as well as the URL. `input[value^="a"] { background: url(...) }`
 * fires a request only when the selector matches, so a page full of them reads
 * a value out one character at a time. Structured style values cannot express a
 * selector, so the same URL is harmless there; it is the combination that
 * leaks, and this is where the combination is possible.
 */
/**
 * The leading and trailing run the URL parser discards.
 *
 * "Remove any leading and trailing C0 control or space from input." C0 is
 * U+0000 to U+001F, which `trim()` does not cover — U+0001 is not whitespace,
 * so a scheme hidden behind one survived a trim while resolving to the same
 * host. Scanned by code point rather than matched, because a regexp holding
 * literal control characters is its own hazard to read and to lint.
 */
function trimControlsAndSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

function isRemoteUrl(value: string): boolean {
  // Normalised the way the URL parser normalises, because that is what decides
  // where the request goes rather than how the value was spelled. The two
  // removals below are the first two steps of the WHATWG basic URL parser,
  // quoted beside each. Guessing at this twice produced two bypasses — a tab
  // inside a scheme, then a U+0001 in front of one — so it follows the
  // algorithm now instead of the cases anyone happened to think of.
  //
  // Backslashes are read as slashes for http and https, so
  // `/\\evil.example/a` reaches another host while beginning with neither `//`
  // nor a scheme.
  const withoutBreaks = value
    // "Remove all ASCII tab or newline from input."
    .replace(/[\t\n\r]/g, "")
    .replaceAll("\\", "/");
  const trimmed = trimControlsAndSpace(withoutBreaks);
  if (URL_SCHEME.test(trimmed)) return true;
  // No scheme, but still another host: `//evil.example/x.png` inherits the
  // page's protocol and nothing else.
  return trimmed.startsWith("//");
}

/**
 * Functions whose string arguments are text rather than something to fetch.
 *
 * An allowlist of the SAFE ones, deliberately, and the asymmetry is the reason.
 * Listing the URL-taking functions instead means an unlisted one is a MISS — a
 * leak — and that list is already hard to keep: `image()` and
 * `-webkit-image-set()` were both found only by probing. Listing the text-taking
 * ones means an unlisted function is refused, which costs a false positive and
 * a message. A security control should fail toward the annoyance.
 *
 * `attr()` is the case that matters in practice: `content: attr(x, "https://…")`
 * is a caption's fallback, not a request.
 */
const TEXT_ARGUMENT_FUNCTIONS = new Set([
  "counter",
  "counters",
  "format",
  "local",
  "symbols",
]);

/**
 * Functions that stand in for a value rather than holding one.
 *
 * These are transparent to the question "is this string a URL": what a `var()`
 * or `attr()` fallback becomes depends entirely on where it sits, so it
 * inherits the position rather than defining one. `attr()` looked like a
 * text-taking function because its fallback usually IS text, but
 * `image-set(attr(x, "https://…") 1x)` consumes that fallback as an image. Treating `var` as text-taking hid a
 * fetch inside `image-set(var(--x, "https://…") 1x)`; treating it as
 * URL-taking would refuse `content: var(--label, "https://…")`, which is a
 * caption. Neither is right, because it is neither.
 */
const SUBSTITUTION_FUNCTIONS = new Set(["var", "env", "attr"]);

/** The first `url()` in a declaration that leaves this origin, if any. */
function firstRemoteUrl(decl: csstree.Declaration): string | undefined {
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
 * How many times a `Raw` value may be re-parsed before the search gives up.
 *
 * Re-parsing can yield another `Raw`, so the walk is bounded rather than
 * trusting the input to be shallow. Three is past anything CSS nests in
 * practice — a fallback inside a fallback inside a fallback — and a value
 * deeper than that is refused rather than followed, because refusing costs one
 * declaration and following forever costs the request.
 */
const MAX_RAW_DEPTH = 3;

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
): string | undefined {
  let found: string | undefined;
  // One walk, maintaining the enclosing-function stack, because all three
  // shapes below depend on where in the value they sit.
  const functions: string[] = [];
  const raws: { text: string; position: string[] }[] = [];
  csstree.walk(value, {
    enter(node: csstree.CssNode) {
      if (node.type === "Function") functions.push(node.name.toLowerCase());
      if (found !== undefined) return;
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
  if (found !== undefined) return found;

  for (const raw of raws) {
    if (raw.text.trim() === "") continue;
    // Unreadable is not the same as safe. This is the one place the check
    // cannot see what it is judging, so it refuses rather than waves it
    // through, and reports the raw text so the author knows which line went.
    if (depth >= MAX_RAW_DEPTH) return raw.text.trim();
    let reparsed: csstree.CssNode;
    try {
      reparsed = csstree.parse(raw.text, { context: "value" });
    } catch {
      return raw.text.trim();
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
function remoteUrlInRawRule(text: string, depth: number): string | undefined {
  if (depth >= MAX_RAW_DEPTH) return text.trim();
  let inner: csstree.CssNode;
  try {
    inner = csstree.parse(text, { context: "stylesheet" });
  } catch {
    return text.trim();
  }
  let remote: string | undefined;
  csstree.walk(inner, {
    visit: "Declaration",
    enter(decl: csstree.Declaration) {
      if (remote === undefined) remote = firstRemoteUrl(decl);
    },
  });
  if (remote !== undefined) return remote;
  const deeper: string[] = [];
  csstree.walk(inner, {
    visit: "Rule",
    enter(rule: Rule) {
      if (rule.block === null) return;
      for (const child of rule.block.children) {
        if (child.type === "Raw") deeper.push(child.value);
      }
    },
  });
  for (const raw of deeper) {
    if (raw.trim() === "") continue;
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

export function sanitizeCustomCss(
  css: string,
  scopeClass: string
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
          code: "unsafe-value",
          message:
            "This CSS could not be parsed, so none of it was applied. Check for an unclosed brace, quote or comment.",
        },
      ],
    };
  }

  // Drop at-rules other than @media / @supports.
  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      const name = (node as csstree.Atrule).name.toLowerCase();
      if (name === "media" || name === "supports") return;
      warn(
        "unsupported-at-rule",
        `"@${name}" is not allowed in custom CSS, so that rule was removed. Only @media and @supports are supported here.`
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
      const remote = firstRemoteUrl(decl);
      if (remote !== undefined) {
        warn(
          "remote-url",
          `"${decl.property}" refers to "${remote}", which is not on this site. Upload the file to the media library and use its path instead.`
        );
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

  // A nested rule is a `Raw` child of its parent's block in css-tree 2.3, not a
  // Declaration, so the declaration walk above never sees inside it and
  // `.probe { background: url("https://evil") }` nested in a scoped rule
  // reached the page untouched. `Raw` is where the parser puts what it did not
  // read, and every level it appears at has to be followed: the value root, a
  // fallback nested in a value, and here.
  csstree.walk(ast, {
    visit: "Rule",
    enter(node: Rule) {
      const block = node.block;
      if (block === null) return;
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
        const remote = remoteUrlInRawRule(raw.value, 0);
        if (remote === undefined) continue;
        warn(
          "remote-url",
          `A nested rule refers to "${remote}", which is not on this site. Upload the file to the media library and use its path instead.`
        );
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
      if (node.prelude.type !== "SelectorList") return;
      for (const sel of node.prelude.children) {
        if (sel.type !== "Selector") continue;
        const first = sel.children.first;
        const alreadyScoped =
          first != null &&
          first.type === "ClassSelector" &&
          first.name === scopeClass;
        if (alreadyScoped) continue;
        sel.children.prependData({ type: "Combinator", name: " " });
        sel.children.prependData({ type: "ClassSelector", name: scopeClass });
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
  scopeClass: string
): SanitizedCss {
  if (!css) return { css: "", warnings: [] };
  // Replace the `selector` keyword (word-boundary, not part of .foo-selector).
  const withScope = css.replace(/(^|[^\w.#-])selector\b/g, `$1.${scopeClass}`);
  return sanitizeCustomCss(withScope, scopeClass);
}
