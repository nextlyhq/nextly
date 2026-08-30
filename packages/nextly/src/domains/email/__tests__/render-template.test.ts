/**
 * The composition an email recipient actually receives.
 *
 * `sendTemplate` composes a template into subject, HTML and text inline, and
 * `previewTemplate` composes a narrower artifact of its own. The two agreed
 * when they were written and no longer do. These tests pin the SEND path's
 * behaviour — the one users observe in their inbox — so that collapsing both
 * into a single function is provably behaviour-preserving rather than
 * hopefully so.
 *
 * `composeAsSendDoesToday` is the oracle: it is a transcription of
 * `email-service.ts`, and it is replaced by a call to the extracted function
 * once that exists. Every assertion below must hold across that replacement.
 */
import { describe, expect, it } from "vitest";

import { htmlToText, interpolateTemplate } from "../services/template-engine";

interface OracleTemplate {
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
  useLayout: boolean;
}

const CONTENT_MARKER = "{{content}}";

/** The default `appName` the send path supplies when configuration has none. */
const APP_NAME = "Nextly";

function composeAsSendDoesToday(
  t: OracleTemplate,
  layout: { htmlContent: string } | null,
  vars: Record<string, unknown>
): { subject: string; html: string; text: string } {
  const subject = interpolateTemplate(t.subject, vars, { escapeHtml: false });
  let html = interpolateTemplate(t.htmlContent, vars);

  const text = t.plainTextContent?.trim()
    ? interpolateTemplate(t.plainTextContent, vars, { escapeHtml: false })
    : htmlToText(html);

  if (t.preheader?.trim()) {
    const preheader = interpolateTemplate(t.preheader, vars);
    html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>${html}`;
  }

  if (t.useLayout && layout) {
    const layoutVars: Record<string, unknown> = {
      ...vars,
      year: vars.year ?? new Date().getFullYear().toString(),
      appName: vars.appName ?? APP_NAME,
    };
    const at = layout.htmlContent.indexOf(CONTENT_MARKER);
    html =
      at === -1
        ? interpolateTemplate(layout.htmlContent, layoutVars) + html
        : interpolateTemplate(layout.htmlContent.slice(0, at), layoutVars) +
          html +
          interpolateTemplate(
            layout.htmlContent.slice(at + CONTENT_MARKER.length),
            layoutVars
          );
  }

  return { subject, html, text };
}

const base: OracleTemplate = {
  subject: "Welcome to {{appName}}",
  htmlContent: "<p>Hello {{userName}}</p>",
  plainTextContent: null,
  preheader: null,
  useLayout: false,
};

describe("the composition recipients receive", () => {
  it("does NOT html-escape the subject", () => {
    const out = composeAsSendDoesToday(
      { ...base, subject: "{{co}} & you" },
      null,
      { co: "Ben & Jerry" }
    );
    expect(out.subject).toBe("Ben & Jerry & you");
    expect(out.subject).not.toContain("&amp;");
  });

  it("DOES html-escape values interpolated into the body", () => {
    const out = composeAsSendDoesToday(
      { ...base, htmlContent: "<p>{{bio}}</p>" },
      null,
      { bio: "<script>alert(1)</script>" }
    );
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<script>");
  });

  it("prepends a hidden preheader div when one is authored", () => {
    const out = composeAsSendDoesToday(
      { ...base, preheader: "Your account is ready" },
      null,
      {}
    );
    expect(out.html.startsWith('<div style="display:none;')).toBe(true);
    expect(out.html).toContain("Your account is ready");
  });

  it("uses the authored plain text when there is one", () => {
    const out = composeAsSendDoesToday(
      { ...base, plainTextContent: "Hello {{userName}}, welcome." },
      null,
      { userName: "Priya" }
    );
    expect(out.text).toBe("Hello Priya, welcome.");
  });

  it("derives the text part from the body when none is authored", () => {
    const out = composeAsSendDoesToday(
      { ...base, htmlContent: "<h1>Hi</h1><p>Visit us</p>" },
      null,
      {}
    );
    expect(out.text).toContain("Hi");
    expect(out.text).not.toContain("<h1>");
  });

  it("derives the text part BEFORE the preheader, so it never leaks in", () => {
    const out = composeAsSendDoesToday(
      { ...base, preheader: "SECRET-PREVIEW-LINE" },
      null,
      {}
    );
    expect(out.html).toContain("SECRET-PREVIEW-LINE");
    expect(out.text).not.toContain("SECRET-PREVIEW-LINE");
  });

  it("supplies year and appName to the layout when the caller omits them", () => {
    const out = composeAsSendDoesToday(
      { ...base, useLayout: true },
      { htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}` },
      {}
    );
    expect(out.html).toContain(APP_NAME);
    expect(out.html).toMatch(/\d{4}/);
  });

  it("lets the caller's own year and appName win over the defaults", () => {
    const out = composeAsSendDoesToday(
      { ...base, useLayout: true },
      { htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}` },
      { appName: "Northwind", year: "1999" }
    );
    expect(out.html).toContain("Northwind 1999");
  });

  it("splices the body at the layout's {{content}} marker", () => {
    const out = composeAsSendDoesToday(
      { ...base, useLayout: true },
      { htmlContent: `<header>H</header>${CONTENT_MARKER}<footer>F</footer>` },
      { userName: "Priya" }
    );
    expect(out.html.indexOf("<header>H</header>")).toBeLessThan(
      out.html.indexOf("Hello Priya")
    );
    expect(out.html.indexOf("Hello Priya")).toBeLessThan(
      out.html.indexOf("<footer>F</footer>")
    );
  });

  it("appends the body after a layout with NO marker, dropping nothing", () => {
    const out = composeAsSendDoesToday(
      { ...base, useLayout: true },
      { htmlContent: "<header>only</header>" },
      { userName: "Priya" }
    );
    expect(out.html).toContain("<header>only</header>");
    expect(out.html).toContain("Hello Priya");
  });

  it("does not wrap when useLayout is false, even with a layout to hand", () => {
    const out = composeAsSendDoesToday(
      { ...base, useLayout: false },
      { htmlContent: `<header>H</header>${CONTENT_MARKER}` },
      { userName: "Priya" }
    );
    expect(out.html).toBe("<p>Hello Priya</p>");
  });
});
