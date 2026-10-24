/**
 * Core's built-in emails stay readable: every text colour they set meets
 * WCAG AA's 4.5:1 against the surface it sits on, with the starting brand.
 *
 * A built-in's body sits on the card (`contentColor`); the layout's footer
 * sits on the page (`backgroundColor`). An element that paints its own
 * background, the button, is left out. A site that picks its own brand colours
 * owns their contrast.
 */

import { describe, expect, it } from "vitest";

import { STARTING_BRAND } from "../brand-settings";
import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_SLUG,
  defaultLayoutTemplate,
} from "../services/templates";

const AA = 4.5;

const DATA = {
  userName: "Ada",
  userEmail: "ada@example.com",
  verifyLink: "https://example.com/verify",
  resetLink: "https://example.com/reset",
  expiresIn: "24 hours",
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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text colour each element's inline style sets, as `<tag> #rrggbb`.
 * Outlook-only blocks are dropped first: the one there draws the button's text
 * on the button's own fill, not on the card.
 */
function textColours(html: string): string[] {
  const found: string[] = [];
  const outsideOutlook = html.replace(
    /<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g,
    ""
  );
  for (const [, tag, style] of outsideOutlook.matchAll(
    /<(\w+)\b[^>]*\bstyle="([^"]*)"/g
  )) {
    if (style.includes("background-color:")) continue;
    const colour = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})\b/.exec(style)?.[1];
    if (colour) found.push(`<${tag}> ${colour.toLowerCase()}`);
  }
  return found;
}

function belowAA(colours: string[], surface: string): string[] {
  return colours.filter(c => contrast(c.split(" ")[1], surface) < AA);
}

describe("the built-in emails' text contrast", () => {
  const bodies = BUILT_IN_TEMPLATES.filter(t => t.slug !== DEFAULT_LAYOUT_SLUG);

  it.each(bodies.map(t => [t.slug, t] as const))(
    "%s: every body text colour reads on the card",
    (_slug, template) => {
      const { html } = renderTemplate(fieldsOf(template), null, DATA, {
        appName: "Nextly",
      });
      const colours = textColours(html);
      // The instrument control: a body with no colours found would pass here
      // whatever it said.
      expect(colours.length).toBeGreaterThan(0);
      expect(belowAA(colours, STARTING_BRAND.contentColor)).toEqual([]);
    }
  );

  it("the layout's footer and its links read on the page", () => {
    const { html } = renderTemplate(
      fieldsOf(defaultLayoutTemplate),
      null,
      {},
      {
        appName: "Nextly",
        brand: {
          ...STARTING_BRAND,
          footerLinks: [{ label: "Help", url: "https://example.com/help" }],
        },
      }
    );
    const colours = textColours(html);
    // The footer line, its links paragraph and the link itself.
    expect(colours.length).toBeGreaterThanOrEqual(3);
    expect(belowAA(colours, STARTING_BRAND.backgroundColor)).toEqual([]);
  });

  it("measures a known failure as one", () => {
    // The old muted grey on white, 2.56:1, so a broken contrast sum can't
    // pass everything.
    expect(belowAA(["<p> #a1a1aa"], "#ffffff")).toEqual(["<p> #a1a1aa"]);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
