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
import {
  oldEngineReasons,
  templateReadsVariable,
} from "../services/liquid-compat";
import { readsVariable } from "../services/liquid-engine";
import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_BEFORE_BRAND,
  defaultLayoutTemplate,
  EARLIER_BUILT_IN_VERSIONS,
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

/** A built-in as the render reads it. */
function fieldsOf(
  template: (typeof BUILT_IN_TEMPLATES)[number]
): TemplateFields {
  return {
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? null,
    preheader: template.preheader ?? null,
    useLayout: template.useLayout ?? true,
    kind: template.kind ?? "template",
  };
}

/** The version core shipped of a built-in before brand settings; every built-in has one. */
function earlierOf(slug: string) {
  const earlier = EARLIER_BUILT_IN_VERSIONS[slug]?.[0];
  if (!earlier) throw new Error(`no earlier version of ${slug}`);
  return earlier;
}

describe("core's built-ins before and after brand settings", () => {
  const data = {
    appName: `Shop <b>&</b> 'Co' "Ltd"`,
    year: "2026",
    userName: "Priya",
    resetLink: "https://example.com/reset?a=1&b=2",
  };

  it.each(BUILT_IN_TEMPLATES.map(t => [t.slug, t] as const))(
    "renders %s exactly as core shipped it before brand settings",
    (slug, template) => {
      const fields = fieldsOf(template);
      // What core shipped before: the template's earlier version, in the
      // layout's. It differs from today's text, so the equality below
      // compares two renders of different sources.
      const earlier = earlierOf(slug);
      expect(earlier.htmlContent).not.toBe(template.htmlContent);
      const layouts = fields.useLayout
        ? { before: DEFAULT_LAYOUT_BEFORE_BRAND, after: defaultLayoutTemplate }
        : { before: null, after: null };
      const before = renderTemplate(
        { ...fields, ...earlier },
        layouts.before,
        data,
        { appName: "Nextly" }
      );
      const after = renderTemplate(fields, layouts.after, data, {
        appName: "Nextly",
        brand: brand({}),
      });
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

describe("core's built-in emails with a changed accent", () => {
  const accent = brand({ accentColor: "#ff0066" });
  const bodies = BUILT_IN_TEMPLATES.filter(t => t.kind !== "layout");

  it.each(bodies.map(t => [t.slug, t] as const))(
    "writes the button of %s in the accent, for Outlook and every other client",
    (_slug, template) => {
      const { html } = renderTemplate(
        body(template.htmlContent),
        defaultLayoutTemplate,
        { verifyLink: "https://x.test/v", resetLink: "https://x.test/r" },
        { appName: "Acme", brand: accent }
      );
      expect(html).toContain(`fillcolor="#ff0066"`);
      expect(html).toContain(`background-color: #ff0066; color: #ffffff;`);
      // Only the button: the heading keeps its own colour.
      expect(html).toContain(`font-weight: 600; color: #18181b;`);
      expect(html).not.toContain(`fillcolor="#18181b"`);
    }
  );

  it("does so without a layout too", () => {
    const reset = bodies.find(t => t.slug === "password-reset");
    if (!reset) throw new Error("no password-reset");
    const { html } = renderTemplate(
      { ...body(reset.htmlContent), useLayout: false },
      null,
      {},
      { appName: "Acme", brand: accent }
    );
    expect(html).toContain(`fillcolor="#ff0066"`);
  });

  it("lets a send that supplies its own `brand` keep it in the body", () => {
    const { html } = renderTemplate(
      body("<p>{{ brand }}</p>"),
      null,
      { brand: "Contoso" },
      { appName: "Acme", brand: accent }
    );
    expect(html).toBe("<p>Contoso</p>");
  });
});

describe("a send that supplies its own `brand`", () => {
  // Sites already send data of their own under `brand` (a product's brand
  // name, say). Core's built-ins read the settings under a name no send can
  // reach, so such a send renders exactly as it does without the key.
  const bodies = BUILT_IN_TEMPLATES.filter(t => t.kind !== "layout");
  const data = {
    userName: "Priya",
    resetLink: "https://x.test/r",
    verifyLink: "https://x.test/v",
  };

  it.each(
    bodies.flatMap(t =>
      ["Nike", null, { accentColor: "red" }].map(
        value => [t.slug, JSON.stringify(value), t, value] as const
      )
    )
  )(
    "renders %s with `brand` = %s exactly as without it",
    (_slug, _shown, template, value) => {
      for (const settings of [brand({}), brand({ accentColor: "#ff0066" })]) {
        const render = (extra: Record<string, unknown>) =>
          renderTemplate(
            fieldsOf(template),
            defaultLayoutTemplate,
            { ...data, ...extra },
            {
              appName: "Acme",
              brand: settings,
            }
          );
        expect(render({ brand: value })).toEqual(render({}));
      }
    }
  );

  it("keeps the configured accent on the button", () => {
    const reset = bodies.find(t => t.slug === "password-reset");
    if (!reset) throw new Error("no password-reset");
    const { html } = renderTemplate(
      fieldsOf(reset),
      null,
      { brand: "Nike" },
      {
        appName: "Acme",
        brand: brand({ accentColor: "#ff0066" }),
      }
    );
    expect(html).toContain(`fillcolor="#ff0066"`);
    expect(html).toContain(`background-color: #ff0066; color: #ffffff;`);
  });

  it("cannot reach the settings under the reserved name", () => {
    const { html } = renderTemplate(
      body("<p>{{ nextly_brand.accentColor }}</p>"),
      null,
      {
        nextly_brand: { accentColor: "red" },
      },
      { appName: "Acme", brand: brand({ accentColor: "#ff0066" }) }
    );
    expect(html).toBe("<p>#ff0066</p>");
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

describe("core's default layout in dark mode", () => {
  /** The layout's style block, where the dark-mode rules are. */
  const style = (settings: BrandSettings) => {
    const { html } = renderTemplate(
      body("x"),
      defaultLayoutTemplate,
      {},
      {
        appName: "Acme",
        brand: settings,
      }
    );
    return html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  };

  it("swaps the starting colours for dark ones", () => {
    const css = style(brand({}));
    expect(css).toContain(
      ".email-bg { background-color: #1a1a2e !important; }"
    );
    expect(css).toContain(
      ".email-card { background-color: #27272a !important; }"
    );
  });

  it("keeps a background the site chose", () => {
    const css = style(brand({ backgroundColor: "#102030" }));
    expect(css).not.toContain(".email-bg {");
    expect(css).toContain(
      ".email-card { background-color: #27272a !important; }"
    );
  });

  it("keeps a content colour the site chose, and its text with it", () => {
    const css = style(brand({ contentColor: "#fff8e7" }));
    expect(css).not.toContain(".email-card");
    expect(css).toContain(
      ".email-bg { background-color: #1a1a2e !important; }"
    );
    // The muted footer text is not the card's, and keeps its dark rule.
    expect(css).toContain(".email-muted { color: #a1a1aa !important; }");
  });
});

describe("a layout kept on the engine before Liquid", () => {
  it("writes the brand markup as markup, not as escaped text", () => {
    const { html, text } = renderTemplate(
      {
        ...body("<p>Body</p>"),
        plainTextContent: "Body {{brand.html.footer}}",
        legacy: true,
      },
      {
        htmlContent:
          "<div>{{content}}<p>{{brand.html.footer}}</p>{{brand.html.links}}</div>",
        legacy: true,
      },
      {},
      {
        appName: "Acme",
        brand: brand({
          footerText: "Acme <Ltd>",
          footerLinks: [{ label: "Help", url: "https://acme.test/h" }],
        }),
      }
    );
    expect(html).toContain('<p>Acme &lt;Ltd&gt;</p><p class="email-muted"');
    expect(html).toContain(`<a href="https://acme.test/h"`);
    expect(html).not.toContain("&lt;p");
    // In plain text the markup is read as its text.
    expect(text).toBe("Body Acme <Ltd>");
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

describe("whether a template reads a variable on the engine it renders with", () => {
  it.each([
    ["{{brand.accentColor}}", true],
    // Liquid can't parse it, so it is kept on the old engine, which reads it.
    ["{% if %} {{brand.accentColor}}", true],
    ["{% if %} {{ brand.accentColor }}", true],
    ["{% if %} {{ other.value }}", false],
    ["{% if %} brand.accentColor", false],
  ])("%s → %s", (source, expected) => {
    expect(templateReadsVariable(source, "brand")).toBe(expected);
  });
});

describe("a template kept on the engine before Liquid", () => {
  it("reads a variable only as that engine's plain tokens do", () => {
    // Liquid reads `brand` here; the engine before it leaves the filter
    // expression as text, so a kept template does not read it.
    const filtered = "{{ brand.accentColor | upcase }}";
    expect(templateReadsVariable(filtered, "brand")).toBe(true);
    expect(templateReadsVariable(filtered, "brand", true)).toBe(false);
    expect(templateReadsVariable("{{brand.accentColor}}", "brand", true)).toBe(
      true
    );
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
