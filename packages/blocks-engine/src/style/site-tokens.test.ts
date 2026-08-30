/**
 * What a site defines once, and what it is not allowed to define.
 *
 * Two rules carry real consequences and are asserted rather than described: a
 * token prefix that would reach outside the site, and a font file fetched from
 * somebody else's server.
 */
import { describe, expect, it } from "vitest";

import * as publicEntry from "../index";
import { compileStyleValues, safeTokenPrefix } from "./declarations";
import type { SiteToken, SiteTokenSet } from "./site-tokens";
import {
  checkTokenKind,
  DARK_MODE_ATTRIBUTE,
  defaultSiteTokens,
  resolveSiteTokens,
  emitFontFaces,
  emitTokenBlocks,
  isTokenName,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  MAX_TOKEN_SELECTOR_LENGTH,
  renameSiteToken,
  tokenIdentity,
  tokenValueFetches,
  resolveTokenPrefix,
  validateFontFace,
} from "./site-tokens";

const SCOPE = ".nx-pb-page-abc";

describe("resolveTokenPrefix", () => {
  it("takes the site's own prefix", () => {
    expect(resolveTokenPrefix("--brand-").prefix).toBe("--brand-");
    expect(resolveTokenPrefix("--brand-").issue).toBeUndefined();
  });

  it("defaults when none is set", () => {
    expect(resolveTokenPrefix(undefined).prefix).toBe("--site-");
  });

  it.each(["--nx-", "--tw-", "--nx-pb-"])(
    "refuses the reserved prefix %s and says what it would have changed",
    prefix => {
      // Reserved because the admin panel and Tailwind's internals read them: a
      // site taking either would restyle surfaces it does not own.
      const result = resolveTokenPrefix(prefix);
      expect(result.prefix).toBe("--site-");
      expect(result.issue?.message).toContain(prefix);
    }
  );

  it("refuses a prefix that is not a custom property, rather than emitting it", () => {
    for (const bad of ["site-", "--Brand-", "--brand_", ""]) {
      const result = resolveTokenPrefix(bad);
      expect(result.prefix, bad).toBe("--site-");
      expect(result.issue, bad).toBeDefined();
    }
  });

  it.each(["--nx-", "--tw-", "--brand_", "site-"])(
    "sends definitions and references to the same property for %s",
    prefix => {
      // The two sides of one decision. A prefix refused where the table is
      // written but accepted where `var()` is written is worse than either
      // verdict alone: the definitions land under the fallback, every
      // reference still reads the prefix that was asked for, and the tokens
      // resolve to nothing with no warning on the page to say why.
      const { css } = emitTokenBlocks(
        {
          prefix,
          tokens: [
            { name: "color.primary", kind: "color", values: { light: "#000" } },
          ],
        },
        SCOPE
      );
      const reference = compileStyleValues(
        { color: { $token: "color.primary" } },
        "/styles",
        prefix
      );

      const property = "--site-color-primary";
      expect(css).toContain(`${property}:`);
      expect(reference.declarations[0]?.value).toBe(`var(${property})`);
    }
  );
});

describe("a token value may not fetch", () => {
  it.each([
    "url(https://evil.example/a.png)",
    "url(/local.png)",
    'image-set("https://evil.example/a.png" 1x)',
    "cross-fade(url(/a.png), url(/b.png))",
    "attr(data-probe)",
  ])("refuses %s outright", value => {
    // A token is read back by a `var()` somewhere this cannot see, so custom
    // CSS can write `background: var(--site-x)` with no URL in it for the
    // origin policy to inspect. That is the selector-gated request channel the
    // whole layer exists to close, reopened through stored data.
    const { css, issues } = emitTokenBlocks(
      { tokens: [{ name: "x", kind: "custom", values: { light: value } }] },
      SCOPE
    );
    expect(css).toBe("");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("load a file");
  });

  it.each([
    '"https://evil.example/a.png"',
    "https://evil.example/a.png",
    "//evil.example/a.png",
    "data:image/svg+xml,<svg/>",
  ])("refuses the remote destination %s written as text", value => {
    // The FUNCTION need not be in the token. A token holding just the string is
    // inert until custom CSS writes `background-image: image-set(var(--site-x)
    // 1x)` — and that declaration has no URL in it for the origin policy to
    // inspect, only a substitution. The two halves are written in different
    // places by different people, which is why neither can be judged alone.
    expect(tokenValueFetches(value)).toBe(true);
    const { css } = emitTokenBlocks(
      { tokens: [{ name: "x", kind: "custom", values: { light: value } }] },
      SCOPE
    );
    expect(css).toBe("");
  });

  it.each(["/logo.svg", '"/logo.svg"', "#2563eb", "1rem", '"My Font", serif'])(
    "still writes the same-origin or ordinary value %s",
    value => {
      // Refusing remote destinations must not refuse a path on this site: it
      // resolves against the page's own origin and needs no allowlisting, which
      // is the line a font file is already held to.
      expect(tokenValueFetches(value)).toBe(false);
    }
  );

  it("reads an escaped spelling as the function it is", () => {
    // `\\75 rl(` IS `url(` to a browser, so a check against the raw text is one
    // an author writes straight past. Asserted on the check itself rather than
    // through `emitTokenBlocks`, because the general value guard happens to
    // refuse this spelling too — which would let this pass with the decoding
    // removed entirely.
    expect(tokenValueFetches("\\75 rl(https://evil.example/a.png)")).toBe(true);
    expect(tokenValueFetches("URL(/a.png)")).toBe(true);
    expect(tokenValueFetches("Image-Set('/a.png' 1x)")).toBe(true);
    expect(tokenValueFetches("var(--other)")).toBe(false);
    expect(tokenValueFetches("Urbanist, serif")).toBe(false);
  });

  it("checks the dark value too", () => {
    const { css } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "x",
            kind: "custom",
            values: { light: "red", dark: "url(/a.png)" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
  });

  it("still writes the values a token is actually for", () => {
    // Refusing a whole shape only works if the shape is not one tokens use.
    // None of the kinds denotes a URL, so nothing legitimate is lost — but a
    // value merely containing those letters must still pass.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          { name: "a", kind: "color", values: { light: "#2563eb" } },
          {
            name: "b",
            kind: "dimension",
            values: { light: "clamp(1rem, 2vw, 3rem)" },
          },
          { name: "c", kind: "custom", values: { light: "var(--other)" } },
          {
            name: "d",
            kind: "fontFamily",
            values: { light: "Urbanist, serif" },
          },
        ],
      },
      SCOPE
    );
    expect(issues).toEqual([]);
    expect(css).toContain("--site-a:#2563eb");
    expect(css).toContain("--site-d:Urbanist, serif");
  });
});

describe("a value that cannot be its kind", () => {
  it("says so, and writes it anyway", () => {
    // The kind decides which properties may reference the token, so a colour
    // holding a length compiles to `color:var(--site-…)` and the browser drops
    // it at use time — nothing on the page says why. Writing it regardless
    // keeps the verdict cheap: this is a warning, not a gate.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "1rem" } },
        ],
      },
      SCOPE
    );
    expect(css).toContain("--site-color-brand:1rem");
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("not a colour");
  });

  it("checks the dark value too, not only the light one", () => {
    // The half-fixed set: a rule applied to `light` and not to the `dark`
    // sitting beside it passes every test written about light.
    const { issues } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "space.gap",
            kind: "dimension",
            values: { light: "1rem", dark: "#ff0000" },
          },
        ],
      },
      SCOPE
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("dark");
    expect(issues[0]?.message).toContain("not a length");
  });

  it.each([
    ["color", "#2563eb"],
    ["color", "oklch(0.6 0.1 250)"],
    ["color", "rebeccapurple"],
    ["color", "var(--brand)"],
    ["color", "color-mix(in srgb, red, blue)"],
    ["dimension", "0"],
    ["dimension", "1.5rem"],
    ["dimension", "clamp(20rem, 80vw, 72rem)"],
    ["dimension", "50%"],
    ["dimension", "2em"],
    ["dimension", "10vmin"],
    ["fontWeight", "lighter"],
    ["duration", "150ms"],
    ["duration", "0"],
    ["number", "1.5"],
    ["fontWeight", "700"],
    ["fontWeight", "bold"],
    ["fontFamily", "system-ui"],
    ["shadow", "0 1px 2px rgba(0,0,0,.2)"],
    ["custom", "anything at all"],
  ] as const)("stays quiet about a valid %s value %s", (kind, value) => {
    // The check is one-sided on purpose. A false positive here would tell an
    // author their perfectly good `oklch()` is wrong, which is worse than the
    // silence it replaced.
    expect(checkTokenKind(kind, value), `${kind}: ${value}`).toBeUndefined();
  });

  it.each([
    ["color", "16px"],
    ["color", "3"],
    ["dimension", "#fff"],
    ["dimension", "16"],
    ["duration", "16px"],
    ["number", "16px"],
    ["fontWeight", "1200"],
    ["fontWeight", "700px"],
    // Exponent spellings the rest of the token code accepts: without the
    // exponent branch these match nothing, the check reaches no verdict, and it
    // stays silent about a value the browser will drop.
    ["duration", "1e3px"],
    // A measurement in the wrong quantity: valid CSS, dropped where the token
    // is used, and previously passed because it merely had SOME unit.
    ["dimension", "150ms"],
    ["dimension", "20deg"],
    ["duration", "16px"],
    // A word `font-weight` does not take.
    ["fontWeight", "heavy"],
    // `1.px` is not a CSS number followed by a unit, and `1m\\73` IS `1ms` — the
    // pattern has to read both the way CSS does or it stays silent about a
    // value the browser drops.
    ["dimension", "1.px"],
    ["dimension", "1m\\73"],
    // A percentage is its own token: `1\\%` and `1\\25` decode to a unit reading
    // `%` but CSS drops the declaration, so the check must not be reassured.
    ["dimension", "1\\%"],
    ["dimension", "1\\25"],
    // The unit is resolved once. `1\\5c s` is a dimension whose unit decodes to
    // the two characters `\s`, which measures nothing; decoded a second time on
    // the way to the category it reads `s` and passes as a time.
    ["duration", "1\\5c s"],
    ["dimension", "1\\5c px"],
    // Malformed numeric text is not a colour either; tightening the
    // measurement pattern had moved this out of every branch.
    ["color", "1.px"],
    // A zero with a unit is still that unit's quantity: `0px` is a length, and
    // only an UNITLESS zero is a time.
    ["duration", "0px"],
    ["duration", "0deg"],
    ["number", "1e3px"],
    ["fontWeight", "2e3"],
  ] as const)("names what is wrong with %s value %s", (kind, value) => {
    expect(checkTokenKind(kind, value), `${kind}: ${value}`).toBeDefined();
  });
});

describe("the token name grammar", () => {
  it("holds the table to what a reference can name", () => {
    // An uppercase name is legal as a custom property, so nothing stops the
    // table writing `--site-Color-Primary`. What stops it is that the compiler
    // refuses `{ $token: "Color.Primary" }`, and a token nothing can reference
    // is a token that exists, resolves to nothing, and reports no reason.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          { name: "Color.Primary", kind: "color", values: { light: "#000" } },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
    expect(issues[0]?.message).toContain("Color.Primary");

    const reference = compileStyleValues(
      { color: { $token: "Color.Primary" } },
      "/styles"
    );
    expect(reference.declarations).toEqual([]);
  });

  it("refuses a name longer than the cap, on both sides of the reference", () => {
    // The grammar bounds the ALPHABET and not the length, so without a cap a
    // name of megabytes of valid characters is scanned in full on every compile
    // and copied into a `var()` on every rule referencing it.
    //
    // Both sides are asserted because the whole value of one grammar is that the
    // table and the reference agree: a table that refused an overlong name while
    // a reference still emitted it would write `var(--site-...)` against a custom
    // property nothing defines, and report nothing.
    const overlong = "a".repeat(MAX_TOKEN_NAME_LENGTH + 1);
    expect(isTokenName(overlong)).toBe(false);

    const { css } = emitTokenBlocks(
      {
        tokens: [{ name: overlong, kind: "color", values: { light: "#000" } }],
      },
      SCOPE
    );
    expect(css).toBe("");

    const reference = compileStyleValues(
      { color: { $token: overlong } },
      "/styles"
    );
    expect(reference.declarations).toEqual([]);
  });

  it("emits nothing for two different overlong names, so they cannot compile apart", () => {
    // This is the property the page-artifact stamp depends on. That stamp keeps
    // at most `MAX_VALUE_LENGTH` characters of any string it reads, which is
    // sound only while no string the compiler EMITS can be longer. A token name
    // is the one that could: it reaches CSS in full through `tokenCustomProperty`.
    //
    // So the pair matters, not the single case. Two names agreeing to the
    // stamp's truncation point and differing after it once produced different
    // CSS under one identifier, and the stored sheet was then reused for the
    // wrong one indefinitely. Under the cap both emit nothing, so identical
    // output is the honest answer rather than a collision.
    const shared = "a".repeat(MAX_TOKEN_NAME_LENGTH + 1);
    const first = `${shared}b`;
    const second = `${shared}c`;

    const cssFor = (name: string) =>
      emitTokenBlocks(
        { tokens: [{ name, kind: "color", values: { light: "#000" } }] },
        SCOPE
      ).css;

    expect(cssFor(first)).toBe(cssFor(second));
    expect(cssFor(first)).toBe("");
  });

  it("still writes a renamed token whose DISPLAY name is past the cap", () => {
    // A token's identity is `id ?? name`, so a renamed one emits under its id
    // and its display name reaches no stylesheet. Holding that name to the
    // emission cap would delete a working token from the sheet the moment an
    // author gave it a long label — a rename is supposed to cost nothing, which
    // is the whole reason identity is pinned separately from the name.
    const longLabel = "a".repeat(MAX_TOKEN_NAME_LENGTH + 1);
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            id: "color.primary",
            name: longLabel,
            kind: "color",
            values: { light: "#000" },
          },
        ],
      },
      SCOPE
    );
    expect(issues).toEqual([]);
    expect(css).toContain("color-primary");
  });

  it("refuses a token whose IDENTITY is past the cap", () => {
    // The other side, and the one that reaches CSS: with no id the name IS the
    // identity, so the cap applies to it here and to nothing else.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "a".repeat(MAX_TOKEN_NAME_LENGTH + 1),
            kind: "color",
            values: { light: "#000" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a name exactly at the cap", () => {
    // A cap that took the boundary with it would be a different rule from the
    // one documented, and the off-by-one is invisible in any test that only
    // supplies a name well clear of it.
    const atCap = "a".repeat(MAX_TOKEN_NAME_LENGTH);
    expect(atCap.length).toBe(MAX_TOKEN_NAME_LENGTH);
    expect(isTokenName(atCap)).toBe(true);

    const reference = compileStyleValues(
      { color: { $token: atCap } },
      "/styles"
    );
    expect(reference.declarations).not.toEqual([]);
  });

  it("keeps accepting the names the default set uses", () => {
    // The refusal above has to be narrow: `space.4` and `content.width` are
    // shipped defaults, and a grammar that took them out with the uppercase
    // names would empty the table it was tightening.
    for (const token of defaultSiteTokens()) {
      expect(isTokenName(token.name), token.name).toBe(true);
    }
  });
});

describe("emitTokenBlocks", () => {
  it("writes the values under the page's own selector, not :root", () => {
    // At the document root a site's values would apply to the host's markup
    // too, which is the collision everything else here works to avoid.
    const { css } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#2563eb" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toBe(`${SCOPE}{--site-color-primary:#2563eb}`);
    expect(css).not.toContain(":root");
  });

  it("applies the site's prefix to every property", () => {
    const { css } = emitTokenBlocks(
      {
        prefix: "--brand-",
        tokens: [
          { name: "space.4", kind: "dimension", values: { light: "1rem" } },
        ],
      },
      SCOPE
    );
    expect(css).toContain("--brand-space-4:1rem");
  });

  it("writes a dark block behind an attribute the host controls", () => {
    // The host owns the document and may already have a toggle, so the values
    // are emitted under a switch rather than under a decision about when to
    // flip it.
    const { css } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.text",
            kind: "color",
            values: { light: "#111", dark: "#eee" },
          },
        ],
      },
      SCOPE
    );
    // BOTH forms, because the selector decides which one can match and this
    // function serves two. A scoped selector is matched by the ancestor form,
    // which is the flexible one — a host may carry the switch anywhere above
    // it. A site sheet declares on `:root`, which IS the document element and
    // has no ancestor, so only the attached form can reach it.
    expect(css).toContain(`[${DARK_MODE_ATTRIBUTE}="dark"] ${SCOPE}`);
    expect(css).toContain(`${SCOPE}[${DARK_MODE_ATTRIBUTE}="dark"]`);
    expect(css).toContain("--site-color-text:#eee");
  });

  it("declares root-scoped dark values on whichever element carries the switch", () => {
    // `:root` IS `<html>`, so no rule describing an ancestor can reach it — and
    // a rule ATTACHED to it reaches only the case where the host put the
    // attribute on `<html>`. Custom properties inherit, so declaring them on
    // the attribute-bearing element covers `<html>`, `<body>` and a wrapper
    // alike. Measured in a browser across all three placements.
    const { css } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.text",
            kind: "color",
            values: { light: "#111", dark: "#eee" },
          },
        ],
      },
      ":root"
    );
    expect(css).toContain(
      `[${DARK_MODE_ATTRIBUTE}="dark"]{--site-color-text:#eee}`
    );
    // Not anchored to the root, which is the form that only works on `<html>`.
    expect(css).not.toContain(`:root[${DARK_MODE_ATTRIBUTE}="dark"]`);
    // And the light block still declares on the root itself.
    expect(css).toContain(":root{--site-color-text:#111}");
  });

  it("follows the operating system when the site asks for that instead", () => {
    const { css } = emitTokenBlocks(
      {
        darkMode: "media",
        tokens: [
          {
            name: "color.text",
            kind: "color",
            values: { light: "#111", dark: "#eee" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toContain("@media (prefers-color-scheme:dark)");
    expect(css).not.toContain(DARK_MODE_ATTRIBUTE);
  });

  it("writes no dark block when nothing differs in dark", () => {
    // An empty selector is not free: it is something a host reads in devtools
    // and takes for a place where something should be happening.
    const { css } = emitTokenBlocks(
      {
        tokens: [
          { name: "space.4", kind: "dimension", values: { light: "1rem" } },
        ],
      },
      SCOPE
    );
    expect(css).not.toContain(DARK_MODE_ATTRIBUTE);
    expect(css).not.toContain("@media");
  });

  it("refuses the second of two names that become one property", () => {
    // `color.primary-dark` and `color-primary.dark` both give
    // `--site-color-primary-dark`. Emitted together, one would silently
    // resolve to the other's value.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.primary-dark",
            kind: "color",
            values: { light: "#111" },
          },
          {
            name: "color-primary.dark",
            kind: "color",
            values: { light: "#222" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toContain("#111");
    expect(css).not.toContain("#222");
    expect(issues[0]?.message).toContain("--site-color-primary-dark");
  });
});

describe("the default token set", () => {
  it("ships the content width the Container preset reads", () => {
    // The token that earns its place loudest: editing it re-widths every
    // container on the site, which is the system demonstrating its own value.
    const width = defaultSiteTokens().find(t => t.name === "content.width");
    expect(width?.kind).toBe("dimension");
    expect(width?.values.light).toBeTruthy();
  });

  it("emits without complaint", () => {
    const { css, issues } = emitTokenBlocks(
      { tokens: defaultSiteTokens() },
      SCOPE
    );
    expect(issues).toEqual([]);
    expect(css).toContain("--site-content-width");
  });
});

describe("font faces", () => {
  const local = { url: "/fonts/x.woff2", format: "woff2" };

  it("emits a self-hosted face, defaulting to a readable fallback", () => {
    const { css, issues } = emitFontFaces([{ family: "Brand", src: [local] }]);
    expect(issues).toEqual([]);
    expect(css).toContain('font-family:"Brand"');
    expect(css).toContain('url("/fonts/x.woff2") format("woff2")');
    // `swap` rather than the browser default: text stays readable while the
    // file loads instead of being invisible.
    expect(css).toContain("font-display:swap");
  });

  it.each([
    "https://fonts.gstatic.com/s/x.woff2",
    "//fonts.gstatic.com/s/x.woff2",
    "http://example.com/x.woff2",
  ])("refuses %s and says to upload the file instead", url => {
    // A font fetched from another server announces every visitor's IP address
    // to it before the page is readable — the arrangement a German court found
    // unlawful for Google Fonts.
    const issues = validateFontFace(
      { family: "B", src: [{ url }] },
      "fonts[0]"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("Upload the font file");
  });

  it("emits nothing for a face it refused", () => {
    // Half a `@font-face` is worse than none: a family whose file never loads
    // renders as the browser default rather than as the next family listed.
    const { css, issues } = emitFontFaces([
      { family: "Brand", src: [{ url: "https://fonts.example/x.woff2" }] },
    ]);
    expect(css).toBe("");
    expect(issues).toHaveLength(1);
  });

  it("keeps the faces that passed when one alongside them failed", () => {
    const { css } = emitFontFaces([
      { family: "Good", src: [local] },
      { family: "Bad", src: [{ url: "https://fonts.example/x.woff2" }] },
    ]);
    expect(css).toContain('font-family:"Good"');
    expect(css).not.toContain('font-family:"Bad"');
  });

  it("refuses a face with no file at all", () => {
    expect(validateFontFace({ family: "B", src: [] }, "f")).toHaveLength(1);
  });
});

describe("stored data reaching the stylesheet", () => {
  // Tokens and fonts are admin data, so every field here is attacker-shaped
  // input to a text emitter. Each of these escaped the page's own rule before
  // it was checked.

  it("refuses a token name that would close the rule", () => {
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          { name: "x:1}body{color", kind: "color", values: { light: "red" } },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
    expect(css).not.toContain("body{");
    expect(issues[0]?.message).toContain("is not a token name");
  });

  it("refuses a token value that would end the custom property", () => {
    // The semicolon ends `--site-color-primary` and what follows becomes a
    // declaration on the page root — including a URL-bearing one.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#fff;color:red" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
    expect(issues[0]?.message).toContain("cannot be used");
  });

  it("refuses a dark value that would inject, not only the light one", () => {
    const { css } = emitTokenBlocks(
      {
        tokens: [
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#fff", dark: "#000}body{display:none" },
          },
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
  });

  it("refuses a family name carrying structural characters", () => {
    // `Brand";src:url(/ok)}body{display:none}/*` would end the quoted
    // descriptor, then the rule, then write another. Escaping the quote alone
    // would leave the braces and the comment opener inside a stylesheet that
    // is written into a `<style>` element, where `</style>` ends the element
    // whatever the CSS parser thinks of the quotes.
    const { css, issues } = emitFontFaces([
      {
        family: 'Brand";src:url(/ok)}body{display:none}/*',
        src: [{ url: "/f.woff2" }],
      },
    ]);
    expect(css).toBe("");
    expect(issues[0]?.message).toContain("not a usable font family name");
  });

  it("escapes a quote in a family name it does allow", () => {
    // A quote alone is legal in a family name and is what the CSS escape
    // exists for, so this one is carried through rather than refused.
    const { css } = emitFontFaces([
      { family: 'Say "Hi"', src: [{ url: "/f.woff2" }] },
    ]);
    expect(css).toContain('font-family:"Say \\"Hi\\""');
    expect(css.match(/@font-face/g)?.length).toBe(1);
  });

  it("refuses an unquoted descriptor that would inject", () => {
    for (const face of [
      { family: "B", src: [{ url: "/f.woff2" }], weight: "400;color:red" },
      { family: "B", src: [{ url: "/f.woff2" }], style: "normal}body{x:y" },
      { family: "B", src: [{ url: "/f.woff2" }], display: "swap;a:b" },
      { family: "B", src: [{ url: "/f.woff2" }], unicodeRange: "U+0-7F}a{b:c" },
    ]) {
      const { css } = emitFontFaces([face]);
      expect(css, JSON.stringify(face)).toBe("");
    }
  });

  it("refuses a format hint that is not a plain keyword", () => {
    const { css } = emitFontFaces([
      { family: "B", src: [{ url: "/f.woff2", format: 'woff2");}body{x:y' }] },
    ]);
    expect(css).toBe("");
  });
});

describe("resolveSiteTokens", () => {
  it("returns the defaults when a site defines nothing", () => {
    expect(
      resolveSiteTokens()
        .tokens.map(t => t.name)
        .sort()
    ).toEqual(
      defaultSiteTokens()
        .map(t => t.name)
        .sort()
    );
  });

  it("lets a site override a default BY NAME without losing the others", () => {
    // The defect this exists to make unreachable. A site that REPLACES the set
    // to change one colour loses `content.width` and `space.4`, and every block
    // reading those falls back to its initial value — silently, because an
    // unresolved custom property invalidates the declaration rather than
    // reporting anything.
    const resolved = resolveSiteTokens({
      tokens: [
        { name: "color.primary", kind: "color", values: { light: "#ff0000" } },
      ],
    });

    expect(
      resolved.tokens.find(t => t.name === "color.primary")?.values.light
    ).toBe("#ff0000");
    // The SURVIVORS are the assertion, not the override.
    const names = resolved.tokens.map(t => t.name);
    expect(names).toContain("content.width");
    expect(names).toContain("space.4");
    expect(names).toContain("color.text");
  });

  it("adds a token the defaults do not define", () => {
    const resolved = resolveSiteTokens({
      tokens: [
        { name: "color.accent", kind: "color", values: { light: "#f6f6f6" } },
      ],
    });

    expect(resolved.tokens.map(t => t.name)).toContain("color.accent");
    expect(resolved.tokens.length).toBe(defaultSiteTokens().length + 1);
  });

  it("takes the LAST duplicate within the override, not the first", () => {
    // An imported DTCG file can carry a duplicate name; taking the first would
    // apply the value the author replaced.
    const resolved = resolveSiteTokens({
      tokens: [
        { name: "color.primary", kind: "color", values: { light: "#111111" } },
        { name: "color.primary", kind: "color", values: { light: "#222222" } },
      ],
    });

    expect(
      resolved.tokens.find(t => t.name === "color.primary")?.values.light
    ).toBe("#222222");
  });

  it("carries prefix and darkMode from the override, and omits them otherwise", () => {
    // Site-wide decisions rather than per-token values. A prefix set in two
    // places is how a site declares `--brand-x` while its pages ask for
    // `--site-x`; `compileSiteSheet` derives ONE prefix for that reason.
    expect(resolveSiteTokens().prefix).toBeUndefined();
    expect(
      resolveSiteTokens({ tokens: [], prefix: "brand", darkMode: "media" })
    ).toMatchObject({ prefix: "brand", darkMode: "media" });
  });
});

describe("the surface, border and muted tokens", () => {
  const NEW = ["color.surface", "color.border", "color.muted"];

  it("are in the guaranteed set", () => {
    // Their absence made four blocks compromise — card shipped with no
    // background or border, badge was unbuildable, the accordion had no divider
    // and the table no border colour — and it is what made six blocks across
    // three lanes reach for the ADMIN `--nx-*` namespace, which no published
    // page emits.
    const names = defaultSiteTokens().map(t => t.name);

    for (const name of NEW) expect(names).toContain(name);
  });

  it("define BOTH modes, so none of them vanishes in dark", () => {
    // `values.dark` is optional on the type, and a colour defined only for light
    // is a colour that silently keeps its light value on a dark page. Asserted
    // for every colour token, not only the new ones, so the next addition is
    // held to it too.
    const colours = defaultSiteTokens().filter(t => t.kind === "color");

    expect(colours.length).toBeGreaterThan(3);
    for (const token of colours) {
      expect(
        token.values.dark,
        `${token.name} has no dark value`
      ).toBeDefined();
    }
  });

  it("distinguishes a surface from the page background", () => {
    // A surface equal to the background is not a surface: a card would be
    // invisible without a border, which is the compromise these tokens exist to
    // remove. Asserted per mode, because equal-in-dark-only is the easy miss.
    const find = (name: string) =>
      defaultSiteTokens().find(t => t.name === name)?.values;
    const surface = find("color.surface");
    const background = find("color.background");

    expect(surface?.light).not.toBe(background?.light);
    expect(surface?.dark).not.toBe(background?.dark);
  });
});

describe("a token's stable identity", () => {
  // `color.primary` under a name an author has since moved away from. Written
  // once because every case below is about what does NOT move with the label.
  const renamed = (): SiteToken =>
    renameSiteToken(
      { name: "color.primary", kind: "color", values: { light: "#2563eb" } },
      "brand.main"
    );

  it("is the name while a token carries no id", () => {
    // The continuity case, and the one that decides whether any of this can
    // reach an existing site: every token stored before the field existed has
    // no id, so the identity has to fall back to the thing those sites already
    // reference. A separate default here — anything but the name — would move
    // the custom property under every already-compiled page at once.
    const stored: SiteToken = {
      name: "color.primary",
      kind: "color",
      values: { light: "#2563eb" },
    };

    expect(tokenIdentity(stored)).toBe("color.primary");
    const { css } = emitTokenBlocks({ tokens: [stored] }, SCOPE);
    expect(css).toContain("--site-color-primary:#2563eb");
  });

  it("keeps the custom property and the stored reference in step across a rename", () => {
    // The whole point of the field, asserted from BOTH sides at once. A page
    // compiled before the rename holds `var(--site-color-primary)` in its CSS,
    // and a stored document holds `{ $token: "color.primary" }`. Neither is
    // rewritten by a rename, so both have to keep meaning what they meant —
    // and an unresolved custom property invalidates the declaration rather
    // than reporting, so the failure this guards has no symptom on the page.
    const token = renamed();
    expect(token.name).toBe("brand.main");

    const { css } = emitTokenBlocks({ tokens: [token] }, SCOPE);
    expect(css).toContain("--site-color-primary:#2563eb");
    expect(css).not.toContain("--site-brand-main");

    const reference = compileStyleValues(
      { color: { $token: "color.primary" } },
      "/styles",
      undefined
    );
    expect(reference.declarations[0]?.value).toBe("var(--site-color-primary)");
  });

  it("pins the identity ONCE, so a second rename does not move it either", () => {
    // A rename that read the CURRENT name each time would pin the identity to
    // whatever the token was called just before the latest edit, which moves
    // the custom property on every rename after the first — the same defect,
    // one rename later, and no louder.
    const twice = renameSiteToken(renamed(), "palette.hero");

    expect(twice.name).toBe("palette.hero");
    expect(tokenIdentity(twice)).toBe("color.primary");
    expect(emitTokenBlocks({ tokens: [twice] }, SCOPE).css).toContain(
      "--site-color-primary:"
    );
  });

  it("lets a renamed override replace the default it came from, rather than joining it", () => {
    // A tier merge keyed on the NAME stops matching the moment an author
    // renames a default, so the default survives beside the override — two
    // entries where the author edited one, both keying off the single custom
    // property they share. The COUNT is the assertion: a set one larger than
    // the defaults is that failure.
    const override = renameSiteToken(
      { name: "color.primary", kind: "color", values: { light: "#ff0000" } },
      "brand.main"
    );
    const resolved = resolveSiteTokens({ tokens: [override] });

    expect(resolved.tokens.length).toBe(defaultSiteTokens().length);
    const matches = resolved.tokens.filter(
      t => tokenIdentity(t) === "color.primary"
    );
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("brand.main");
    expect(matches[0]?.values.light).toBe("#ff0000");
  });

  it("refuses a new token claiming the name a renamed one still holds as its id", () => {
    // Renaming frees the LABEL and not the custom property behind it, because
    // ids and names share that one space. Writing both would let a page that
    // still references the old name resolve to the new token's value, which is
    // a wrong colour rather than a missing one — so the second is refused and
    // named instead.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          renamed(),
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#ff0000" },
          },
        ],
      },
      SCOPE
    );

    expect(css).toContain("--site-color-primary:#2563eb");
    expect(css).not.toContain("#ff0000");
    expect(issues.some(i => i.message.includes("--site-color-primary"))).toBe(
      true
    );
  });

  it("reaches an editor through the package's public entry", () => {
    // Imported from `../index` rather than from `./site-tokens`, because the
    // module resolving is not the surface a consumer resolves: `packages/builder`
    // sees only the `.` export, and a helper absent from it is a helper the
    // rename UI cannot call. Left unexported, the pinning rule gets reimplemented
    // or `name` is written directly — which moves the custom property every
    // compiled page references, which is the defect the rule exists to prevent.
    //
    // Identity rather than mere presence: a re-declaration at the entry would
    // satisfy a `toBeDefined`, and would be the second implementation this is
    // asserting does not exist.
    expect(publicEntry.tokenIdentity).toBe(tokenIdentity);
    expect(publicEntry.renameSiteToken).toBe(renameSiteToken);
  });

  it("refuses an id that cannot be written as a custom property", () => {
    // An id reaches the selector by the same route a name does, so it is held
    // to the same grammar: one holding `}` would close the rule this opened and
    // everything after it becomes CSS the site never wrote.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            id: "color}primary;color:red",
            name: "brand.main",
            kind: "color",
            values: { light: "#2563eb" },
          },
        ],
      },
      SCOPE
    );

    expect(css).toBe("");
    expect(issues.some(i => i.message.includes("id"))).toBe(true);
  });
});

describe("renaming a token whose identity the rules have made unusable", () => {
  // The upgrade path. A site stored before the cap existed can hold a token
  // with no id and an overlong name, so its identity is now unemittable and the
  // token has stopped rendering. Carrying that identity through a rename pins
  // it forever: the editor accepts the new label and the token still emits
  // nothing, with no remaining way to repair it from the UI.
  const overlong = "a".repeat(MAX_TOKEN_NAME_LENGTH + 1);

  it("re-pins the identity to the new name, so the token can be repaired", () => {
    const renamed = renameSiteToken(
      { name: overlong, kind: "color", values: { light: "#000" } },
      "color.primary"
    );
    expect(renamed.id).toBeUndefined();

    const { css, issues } = emitTokenBlocks({ tokens: [renamed] }, SCOPE);
    expect(issues).toEqual([]);
    expect(css).toContain("color-primary");
  });

  it("keeps a working DEEP identity pinned, because depth is a label rule", () => {
    // An identity never becomes DTCG groups — only a label does — so the depth
    // bound does not reach it. A legacy id with more parts than a label may
    // carry is still emittable, and clearing it on rename would move an
    // identity every stored reference reads.
    const deepId = Array.from(
      { length: MAX_TOKEN_NAME_SEGMENTS + 1 },
      () => "a"
    ).join(".");
    expect(deepId.length).toBeLessThanOrEqual(MAX_TOKEN_NAME_LENGTH);

    const renamed = renameSiteToken(
      {
        id: deepId,
        name: "old.label",
        kind: "color",
        values: { light: "#000" },
      },
      "color.primary"
    );
    expect(renamed.id).toBe(deepId);
  });

  it("refuses a token whose id is not a string, rather than throwing", () => {
    // Persisted settings arrive unvalidated and `RegExp.test` coerces, so a
    // stored number satisfies the grammar and then travels on as a number —
    // reaching a place that assumes a string and taking the whole compile with
    // it. One malformed settings entry must cost its own token, not the page.
    // The ID specifically, because that is what becomes the custom property: a
    // non-string name travels only into a message, while a non-string id
    // reaches the composer and throws there. A fixture with both wrong is
    // caught by the identity guard and says nothing about which one ran.
    const { css, issues } = emitTokenBlocks(
      {
        tokens: [
          {
            id: 123,
            name: "color.primary",
            kind: "color",
            values: { light: "#000" },
          } as never,
        ],
      },
      SCOPE
    );
    expect(css).toBe("");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("still never moves a WORKING identity, which is what rename protects", () => {
    // The control, and the property that matters more than the repair: every
    // stored `$token` reads the identity, so moving one that resolves is the
    // defect this function exists to prevent. Without this, a rename that
    // always re-pinned would satisfy the case above and silently break renames.
    const renamed = renameSiteToken(
      { name: "color.brand", kind: "color", values: { light: "#000" } },
      "color.primary"
    );
    expect(renamed.id).toBe("color.brand");
  });
});

describe("a stored prefix that is not a string", () => {
  it("falls back with a warning rather than aborting the compile", () => {
    // Persisted settings are JSON, so `null` reaches here as a value rather
    // than as the absence the signature suggests — and this function's whole
    // purpose is that one bad setting costs the tokens, not the page.
    expect(safeTokenPrefix(null as never).prefix).toBe("--site-");
    expect(safeTokenPrefix(null as never).warning).toBeDefined();
  });

  it("still returns the default for an ABSENT prefix, with no warning", () => {
    // The control: absence is not a malformed setting, so it must not report
    // one. Without this, a build that warned on everything would satisfy the
    // case above.
    expect(safeTokenPrefix(undefined).prefix).toBe("--site-");
    expect(safeTokenPrefix(undefined).warning).toBeUndefined();
  });
});

describe("the selector token blocks are written under", () => {
  const oneToken: SiteTokenSet = {
    tokens: [
      { name: "color.primary", kind: "color", values: { light: "#000" } },
    ],
  };

  it("refuses an oversized selector rather than writing under a cut one", () => {
    // The selector is the caller's and goes into the sheet verbatim, once per
    // block. Truncating it would be worse than refusing: a selector cut in half
    // is a different selector, so the site's values would land on whatever it
    // happens to match.
    const { css, issues } = emitTokenBlocks(
      oneToken,
      `.${"s".repeat(MAX_TOKEN_SELECTOR_LENGTH)}`
    );
    expect(css).toBe("");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("still writes under a selector at the bound", () => {
    // The control. A guard refusing every selector would satisfy the case above
    // and emit no tokens at all, anywhere.
    const atBound = "s".repeat(MAX_TOKEN_SELECTOR_LENGTH);
    const { css, issues } = emitTokenBlocks(oneToken, atBound);
    expect(issues).toEqual([]);
    expect(css).toContain(atBound);
  });
});
