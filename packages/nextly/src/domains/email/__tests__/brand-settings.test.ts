/**
 * Brand settings: how they are checked, how they resolve, and how a layout
 * reads them.
 *
 * Every render here goes through `renderTemplate`, the one composition sends
 * and previews share, so what is asserted is what a recipient receives. That
 * the starting values render every built-in exactly as before is pinned
 * separately, against output produced before brand settings existed
 * (`render-golden.test.ts`); the first block below holds the layout core kept
 * as its earlier version to the same output, since a stored row holding it is
 * what an upgrading site has.
 */
import { describe, expect, it } from "vitest";

import {
  brandSettingsUpdateSchema,
  resolveBrand,
  STARTING_BRAND,
  type BrandSettings,
} from "../brand-settings";
import { oldEngineReasons } from "../services/liquid-compat";
import { readsVariable } from "../services/liquid-engine";
import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_BEFORE_BRAND,
  defaultLayoutTemplate,
} from "../services/templates";

const body = (htmlContent: string): TemplateFields => ({
  subject: "Hi",
  htmlContent,
  plainTextContent: null,
  preheader: null,
  useLayout: true,
  kind: "template",
});

const brand = (change: Partial<BrandSettings>): BrandSettings => ({
  ...resolveBrand(null),
  ...change,
});

/** A layout that is the site's own, reading the settings as any layout can. */
const SITE_LAYOUT = {
  htmlContent: [
    `<div style="background: {{ brand.backgroundColor }}; font-family: {{ brand.fontFamily }};">`,
    `{% if brand.logoUrl %}<img src="{{ brand.logoUrl }}" width="{{ brand.logoWidth }}">{% endif %}`,
    `{{content}}`,
    `<a style="color: {{ brand.accentColor }}">{{ brand.font }}</a>`,
    `{% for link in brand.footerLinks %}[{{ link.label }}|{{ link.url }}]{% endfor %}`,
    `</div>`,
  ].join(""),
};

describe("core's default layout before and after brand settings", () => {
  const data = {
    appName: `Shop <b>&</b> 'Co' "Ltd"`,
    year: "2026",
    userName: "Priya",
    resetLink: "https://example.com/reset?a=1&b=2",
  };

  it.each(BUILT_IN_TEMPLATES.map(t => [t.slug, t] as const))(
    "renders %s exactly as the layout before brand settings did",
    (_slug, template) => {
      const fields: TemplateFields = {
        subject: template.subject,
        htmlContent: template.htmlContent,
        plainTextContent: template.plainTextContent ?? null,
        preheader: template.preheader ?? null,
        useLayout: template.useLayout ?? true,
        kind: template.kind ?? "template",
      };
      const before = renderTemplate(
        fields,
        fields.useLayout ? DEFAULT_LAYOUT_BEFORE_BRAND : null,
        data,
        { appName: "Nextly" }
      );
      const after = renderTemplate(
        fields,
        fields.useLayout ? defaultLayoutTemplate : null,
        data,
        { appName: "Nextly", brand: brand({}) }
      );
      expect(after).toEqual(before);
    }
  );

  it("is the layout core shipped before, rendered as itself", () => {
    const asLayout = (htmlContent: string): TemplateFields => ({
      ...body(htmlContent),
      kind: "layout",
      useLayout: false,
    });
    expect(
      renderTemplate(asLayout(defaultLayoutTemplate.htmlContent), null, data, {
        appName: "Nextly",
      })
    ).toEqual(
      renderTemplate(
        asLayout(DEFAULT_LAYOUT_BEFORE_BRAND.htmlContent),
        null,
        data,
        { appName: "Nextly" }
      )
    );
  });

  it("reads the same on the engine before Liquid, so it is never kept on it", () => {
    // A layout either engine could read differently would be kept on the
    // old one by the switch to Liquid, which writes `{%` and filters as text.
    expect(oldEngineReasons(defaultLayoutTemplate)).toEqual([]);
  });
});

describe("core's default layout with changed settings", () => {
  const render = (settings: BrandSettings, data = {}) =>
    renderTemplate(body("<p>Body</p>"), defaultLayoutTemplate, data, {
      appName: "Acme",
      brand: settings,
    }).html;

  it("writes the colours and the font where the starting ones were", () => {
    const html = render(
      brand({
        backgroundColor: "#102030",
        contentColor: "#fefefe",
        fontFamily: "georgia",
      })
    );
    expect(html).toContain(
      `class="email-bg" style="background-color: #102030;"`
    );
    expect(html).toContain(
      `class="email-card" style="background-color: #fefefe;`
    );
    // The stack is written as it is, quotes and all.
    expect(html).toContain(
      `font-family: Georgia, 'Times New Roman', Times, serif; background-color: #102030;`
    );
    expect(html).not.toContain("#f4f4f5;");
    expect(html).not.toContain("Segoe UI");
  });

  it("places the logo above the content, its URL escaped", () => {
    const html = render(
      brand({
        logoUrl: "https://cdn.example.com/logo.png?a=1&b=2",
        logoWidth: 180,
      })
    );
    expect(html).toContain(
      `<img src="https://cdn.example.com/logo.png?a=1&amp;b=2" width="180" alt="Acme"`
    );
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<p>Body</p>"));
  });

  it("writes the site's footer text escaped, and links in the accent", () => {
    const html = render(
      brand({
        footerText: "Acme <Ltd>\n1 Main St",
        accentColor: "#ff0066",
        footerLinks: [
          { label: "Privacy & terms", url: "https://acme.test/p?x=1&y=2" },
          { label: "Write to us", url: "mailto:hi@acme.test" },
        ],
      })
    );
    expect(html).toContain(">Acme &lt;Ltd&gt;<br>1 Main St</p>");
    expect(html).not.toContain("All rights reserved");
    expect(html).toContain(
      `<a href="https://acme.test/p?x=1&amp;y=2" style="color: #ff0066; text-decoration: underline;">Privacy &amp; terms</a> &middot; <a href="mailto:hi@acme.test"`
    );
  });

  it("leaves the footer line empty for empty footer text", () => {
    expect(render(brand({ footerText: "" }))).toContain(`sans-serif;"></p>`);
  });

  it("takes its brand from the settings, not from a send's own `brand`", () => {
    const html = renderTemplate(
      body("<p>{{ brand }}</p>"),
      defaultLayoutTemplate,
      { brand: "Contoso" },
      { appName: "Acme", brand: brand({ backgroundColor: "#102030" }) }
    ).html;
    // The body says what its data says; the layout keeps the site's colour.
    expect(html).toContain("<p>Contoso</p>");
    expect(html).toContain(`style="background-color: #102030;"`);
  });
});

describe("a layout of the site's own reads the settings", () => {
  it("as the `brand` variable", () => {
    const html = renderTemplate(
      body("<p>Body</p>"),
      SITE_LAYOUT,
      {},
      {
        appName: "Acme",
        brand: brand({
          backgroundColor: "#102030",
          accentColor: "#ff0066",
          fontFamily: "courier",
          logoUrl: "https://cdn.example.com/l.png",
          logoWidth: 64,
          footerLinks: [{ label: "Help", url: "https://acme.test/help" }],
        }),
      }
    ).html;
    expect(html).toBe(
      `<div style="background: #102030; font-family: 'Courier New', Courier, monospace;">` +
        `<img src="https://cdn.example.com/l.png" width="64">` +
        `<p>Body</p>` +
        `<a style="color: #ff0066">courier</a>` +
        `[Help|https://acme.test/help]` +
        `</div>`
    );
  });

  it("with the starting values when the render is given none", () => {
    const html = renderTemplate(
      body("x"),
      SITE_LAYOUT,
      {},
      {
        appName: "Acme",
      }
    ).html;
    expect(html).toContain(`background: ${STARTING_BRAND.backgroundColor};`);
    expect(html).not.toContain("<img");
  });
});

describe("checking a change", () => {
  const parse = (input: unknown) => brandSettingsUpdateSchema.safeParse(input);

  it("accepts each setting, lowercasing colours, and null to start again", () => {
    const result = parse({
      accentColor: "#FF0066",
      logoUrl: "https://cdn.example.com/l.png",
      logoWidth: 200,
      fontFamily: "verdana",
      footerText: null,
      footerLinks: [{ label: " Help ", url: "mailto:hi@acme.test" }],
    });
    expect(result.success && result.data).toEqual({
      accentColor: "#ff0066",
      logoUrl: "https://cdn.example.com/l.png",
      logoWidth: 200,
      fontFamily: "verdana",
      footerText: null,
      footerLinks: [{ label: "Help", url: "mailto:hi@acme.test" }],
    });
  });

  it.each([
    ["a colour that is not six hex digits", { accentColor: "red" }],
    [
      "a colour carrying more CSS",
      { accentColor: "#ffffff; background: url(x)" },
    ],
    ["a logo that is not an absolute web URL", { logoUrl: "/media/logo.png" }],
    ["a logo on another scheme", { logoUrl: "javascript:alert(1)" }],
    [
      "a link on another scheme",
      { footerLinks: [{ label: "x", url: "javascript:alert(1)" }] },
    ],
    ["a font outside the email-safe list", { fontFamily: "Comic Sans" }],
    ["a logo width outside its range", { logoWidth: 4000 }],
    ["a setting it does not know", { borderRadius: 4 }],
  ])("refuses %s", (_case, input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe("resolving what is stored", () => {
  it("reads nothing stored as the starting values", () => {
    expect(resolveBrand(null)).toEqual(STARTING_BRAND);
  });

  it("reads a stored value that fails its rule as the starting value", () => {
    // A row written some other way must not put arbitrary CSS into a style.
    expect(
      resolveBrand({
        accentColor: "#123456",
        backgroundColor: "red; background: url(x)",
        fontFamily: "Comic Sans",
        footerLinks: [{ label: "x", url: "javascript:alert(1)" }],
      })
    ).toEqual({
      ...STARTING_BRAND,
      accentColor: "#123456",
    });
  });
});

describe("whether a template reads a variable", () => {
  it.each([
    ["{{ brand.accentColor }}", true],
    ["{% if brand.logoUrl %}x{% endif %}", true],
    ["{{ 'x' | append: brand.font }}", true],
    ["{% raw %}{{ brand.accentColor }}{% endraw %}", false],
    ["{% comment %}{{ brand }}{% endcomment %}", false],
    ["{% assign brand = 'x' %}{{ brand }}", false],
    ["brand.accentColor in plain text", false],
    ["{% if %}", false],
  ])("%s → %s", (source, expected) => {
    expect(readsVariable(source, "brand")).toBe(expected);
  });
});
