/**
 * The composition an email recipient actually receives.
 *
 * `sendTemplate` composed a template into subject, HTML and text inline, and
 * `previewTemplate` composed a narrower artifact of its own. The two agreed
 * when they were written and had drifted on six properties by the time they
 * were unified. These tests pin the SEND path's behaviour — the one users
 * observe in their inbox — against the extracted renderer that now serves both.
 *
 * Every assertion calls `renderTemplate` itself. An earlier revision asserted
 * against a transcription of the old inline composition, which passed whether
 * or not the extracted renderer was correct: breaking subject escaping in
 * production left all eleven green. A test that cannot fail for its own reason
 * is worse than no test, because the next reader takes the green as coverage.
 */
import { describe, expect, it } from "vitest";

import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";

const CONTENT_MARKER = "{{content}}";

/** The default `appName` the send path supplies when configuration has none. */
const APP_NAME = "Nextly";

/**
 * Calls the renderer under test, supplying only the `appName` option.
 *
 * A thin argument-shaping helper, deliberately not a second composition: it
 * makes no decision the renderer would otherwise make.
 */
function render(
  template: TemplateFields,
  layout: { htmlContent: string } | null,
  data: Record<string, unknown>
) {
  return renderTemplate(template, layout, data, { appName: APP_NAME });
}

const base: TemplateFields = {
  subject: "Welcome to {{appName}}",
  htmlContent: "<p>Hello {{userName}}</p>",
  plainTextContent: null,
  preheader: null,
  useLayout: false,
  kind: "template",
};

describe("the composition recipients receive", () => {
  it("does NOT html-escape the subject", () => {
    const out = render({ ...base, subject: "{{co}} & you" }, null, {
      co: "Ben & Jerry",
    });
    expect(out.subject).toBe("Ben & Jerry & you");
    expect(out.subject).not.toContain("&amp;");
  });

  it("DOES html-escape values interpolated into the body", () => {
    const out = render({ ...base, htmlContent: "<p>{{bio}}</p>" }, null, {
      bio: "<script>alert(1)</script>",
    });
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<script>");
  });

  it("prepends a hidden preheader div when one is authored", () => {
    const out = render(
      { ...base, preheader: "Your account is ready" },
      null,
      {}
    );
    expect(out.html.startsWith('<div style="display:none;')).toBe(true);
    expect(out.html).toContain("Your account is ready");
  });

  it("uses the authored plain text when there is one", () => {
    const out = render(
      { ...base, plainTextContent: "Hello {{userName}}, welcome." },
      null,
      { userName: "Priya" }
    );
    expect(out.text).toBe("Hello Priya, welcome.");
  });

  it("derives the text part from the body when none is authored", () => {
    const out = render(
      { ...base, htmlContent: "<h1>Hi</h1><p>Visit us</p>" },
      null,
      {}
    );
    expect(out.text).toContain("Hi");
    expect(out.text).not.toContain("<h1>");
  });

  it("derives the text part BEFORE the preheader, so it never leaks in", () => {
    const out = render({ ...base, preheader: "SECRET-PREVIEW-LINE" }, null, {});
    expect(out.html).toContain("SECRET-PREVIEW-LINE");
    expect(out.text).not.toContain("SECRET-PREVIEW-LINE");
  });

  it("supplies year and appName to the layout when the caller omits them", () => {
    const out = render(
      { ...base, useLayout: true },
      { htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}` },
      {}
    );
    expect(out.html).toContain(APP_NAME);
    expect(out.html).toMatch(/\d{4}/);
  });

  it("lets the caller's own year and appName win over the defaults", () => {
    const out = render(
      { ...base, useLayout: true },
      { htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}` },
      { appName: "Northwind", year: "1999" }
    );
    expect(out.html).toContain("Northwind 1999");
  });

  it("splices the body at the layout's {{content}} marker", () => {
    const out = render(
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
    const out = render(
      { ...base, useLayout: true },
      { htmlContent: "<header>only</header>" },
      { userName: "Priya" }
    );
    expect(out.html).toContain("<header>only</header>");
    expect(out.html).toContain("Hello Priya");
  });

  /*
   * New behaviour rather than characterised behaviour: `sendTemplate` never
   * sends a layout row, so the send path had no such guard and the assertions
   * above cannot cover this. `previewTemplate` did make the distinction, and
   * the unified renderer has to keep it.
   */
  it("renders a layout ROW as its own wrapper, never nested in another", () => {
    const out = render(
      {
        subject: "s",
        htmlContent: `<html>${CONTENT_MARKER}</html>`,
        plainTextContent: null,
        preheader: null,
        useLayout: true,
        kind: "layout",
      },
      { htmlContent: `<other>${CONTENT_MARKER}</other>` },
      {}
    );
    // Its own wrapper, and no trace of the other one — the property under test.
    expect(out.html).toBe("<html></html>");
    expect(out.html).not.toContain("<other>");
    // The row's own `{{content}}` is consumed as an unbound variable, exactly
    // as `previewTemplate` did before the unification. Asserted so that the
    // slot disappearing is recorded as preserved behaviour rather than being
    // mistaken later for a splice that went wrong.
    expect(out.html).not.toContain(CONTENT_MARKER);
  });

  /*
   * The chrome variables were supplied only to a wrapper a body was spliced
   * INTO, so a layout row rendering itself resolved them against nothing and
   * emitted `<footer> </footer>`. It is the same markup either way.
   */
  it("fills a layout ROW's own appName and year", () => {
    const out = render(
      {
        subject: "s",
        htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}`,
        plainTextContent: null,
        preheader: null,
        useLayout: true,
        kind: "layout",
      },
      null,
      {}
    );
    expect(out.html).toContain(APP_NAME);
    expect(out.html).toMatch(/\d{4}/);
  });

  it("lets the caller's own values win on a layout ROW too", () => {
    const out = render(
      {
        subject: "s",
        htmlContent: `<footer>{{appName}} {{year}}</footer>${CONTENT_MARKER}`,
        plainTextContent: null,
        preheader: null,
        useLayout: true,
        kind: "layout",
      },
      null,
      { appName: "Northwind", year: "1999" }
    );
    expect(out.html).toContain("Northwind 1999");
    expect(out.html).not.toContain(APP_NAME);
  });

  it("does not wrap when useLayout is false, even with a layout to hand", () => {
    const out = render(
      { ...base, useLayout: false },
      { htmlContent: `<header>H</header>${CONTENT_MARKER}` },
      { userName: "Priya" }
    );
    expect(out.html).toBe("<p>Hello Priya</p>");
  });
});
