/**
 * What a site defines once, and what it is not allowed to define.
 *
 * Two rules carry real consequences and are asserted rather than described: a
 * token prefix that would reach outside the site, and a font file fetched from
 * somebody else's server.
 */
import { describe, expect, it } from "vitest";

import {
  DARK_MODE_ATTRIBUTE,
  defaultSiteTokens,
  emitFontFaces,
  emitTokenBlocks,
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
    expect(css).toContain(
      `[${DARK_MODE_ATTRIBUTE}="dark"] ${SCOPE}{--site-color-text:#eee}`
    );
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
