import { describe, expect, it } from "vitest";

import type { EmailTemplateVariable } from "../../../schemas/email-templates/types";
import {
  escapeHtml,
  htmlToText,
  interpolateTemplate,
  interpolateWithValidation,
  resolveVariable,
  validateTemplateVariables,
} from "../services/template-engine";

describe("escapeHtml", () => {
  it("escapes the five critical characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("Hello world 123")).toBe("Hello world 123");
  });

  it("does not double-escape in a single pass", () => {
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("resolveVariable", () => {
  it("resolves flat keys", () => {
    expect(resolveVariable({ name: "Bob" }, "name")).toBe("Bob");
  });

  it("resolves nested dot paths", () => {
    expect(resolveVariable({ user: { name: "Alice" } }, "user.name")).toBe(
      "Alice"
    );
  });

  it("returns undefined for a missing path", () => {
    expect(resolveVariable({}, "missing.path")).toBeUndefined();
  });
});

describe("interpolateTemplate", () => {
  it("replaces flat placeholders", () => {
    expect(interpolateTemplate("Hello, {{name}}!", { name: "Alice" })).toBe(
      "Hello, Alice!"
    );
  });

  it("resolves nested paths and trims whitespace in braces", () => {
    expect(
      interpolateTemplate("Hi {{ user.name }}", { user: { name: "Bob" } })
    ).toBe("Hi Bob");
  });

  it("HTML-escapes values by default", () => {
    expect(
      interpolateTemplate("{{content}}", {
        content: '<script>alert("x")</script>',
      })
    ).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("does not escape when escapeHtml is false", () => {
    expect(
      interpolateTemplate(
        "{{subject}}",
        { subject: "A & B" },
        { escapeHtml: false }
      )
    ).toBe("A & B");
  });

  it("replaces missing variables with an empty string", () => {
    expect(interpolateTemplate("Hi {{name}}!", {})).toBe("Hi !");
  });
});

describe("validateTemplateVariables", () => {
  const vars: EmailTemplateVariable[] = [
    { name: "userName", description: "User name", required: true },
    { name: "appName", description: "App name", required: true },
    { name: "extra", description: "Optional field" },
  ];

  it("reports missing required variables", () => {
    expect(validateTemplateVariables(vars, { userName: "Alice" })).toEqual({
      valid: false,
      missing: ["appName"],
    });
  });

  it("passes when all required variables are present", () => {
    expect(
      validateTemplateVariables(vars, { userName: "Alice", appName: "Nextly" })
    ).toEqual({ valid: true, missing: [] });
  });

  it("treats null values as missing", () => {
    expect(
      validateTemplateVariables(vars, { userName: null, appName: "Nextly" })
    ).toEqual({ valid: false, missing: ["userName"] });
  });

  it("is valid when there are no variable definitions", () => {
    expect(validateTemplateVariables(null, {})).toEqual({
      valid: true,
      missing: [],
    });
  });
});

describe("interpolateWithValidation", () => {
  const vars: EmailTemplateVariable[] = [
    { name: "name", description: "Name", required: true },
  ];

  it("interpolates when required variables are present", () => {
    expect(interpolateWithValidation("Hi {{name}}", { name: "Al" }, vars)).toBe(
      "Hi Al"
    );
  });

  it("throws when a required variable is missing", () => {
    expect(() => interpolateWithValidation("Hi {{name}}", {}, vars)).toThrow(
      /Missing required template variables: name/
    );
  });
});

describe("htmlToText", () => {
  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });

  it("strips tags and turns block boundaries into line breaks", () => {
    expect(htmlToText("<h1>Hi</h1><p>Welcome aboard</p>")).toBe(
      "Hi\nWelcome aboard"
    );
  });

  it("keeps link targets alongside the label", () => {
    expect(htmlToText('<p>Visit <a href="https://x.io">us</a></p>')).toBe(
      "Visit us (https://x.io)"
    );
  });

  it("omits the target when the label already equals the href", () => {
    expect(htmlToText('<a href="https://x.io">https://x.io</a>')).toBe(
      "https://x.io"
    );
  });

  it("drops style and script blocks entirely", () => {
    expect(
      htmlToText("<style>.a{color:red}</style><p>Body</p><script>x()</script>")
    ).toBe("Body");
  });

  it("converts <br> to newlines", () => {
    expect(htmlToText("Line one<br>Line two")).toBe("Line one\nLine two");
  });

  it("decodes common entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &copy; 2026</p>")).toBe(
      "Tom & Jerry © 2026"
    );
  });

  it("collapses excess whitespace and blank lines", () => {
    expect(htmlToText("<p>A</p>\n\n\n<p>B</p>")).toBe("A\n\nB");
  });
});
