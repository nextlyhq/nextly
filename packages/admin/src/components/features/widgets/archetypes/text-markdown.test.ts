/**
 * What a `text` widget lets a link point at.
 *
 * The parsing is Lexical's; the decision that is ours is which hrefs may
 * become links. Asserted on the predicate rather than through the DOM, so the
 * bypass spellings can be enumerated in one place and each one named.
 *
 * @module components/features/widgets/archetypes/text-markdown.test
 */

import { describe, expect, it } from "vitest";

import { externalHref, safeHref } from "./text-markdown";

describe("which hrefs may become links", () => {
  it("allows the web, mail, phone and paths on this site", () => {
    for (const href of [
      "https://example.com/runbook",
      "http://intranet/wiki",
      "mailto:ops@example.com",
      "tel:+15551234567",
      "/admin/collections/posts",
      "./sibling",
      "#section",
      "posts?status=draft",
    ]) {
      expect(safeHref(href), href).toBe(true);
    }
  });

  it("refuses a scheme that runs code or carries a payload", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:MsgBox",
      "file:///etc/passwd",
    ]) {
      expect(safeHref(href), href).toBe(false);
    }
  });

  it("reads the scheme the way a browser does, not the way it was typed", () => {
    // 🔴 A browser strips ASCII whitespace and control characters while
    // parsing, so these all resolve to `javascript:` there. A guard that
    // matched the scheme against the raw string saw a tab, a newline, a
    // leading space or a control character and called the href relative.
    for (const href of [
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "java\u0001script:alert(1)",
    ]) {
      expect(safeHref(href), JSON.stringify(href)).toBe(false);
    }
  });
});

describe("which links leave this site", () => {
  it("is any absolute web address, protocol-relative included", () => {
    expect(externalHref("https://example.com")).toBe(true);
    expect(externalHref("//cdn.example.com/x")).toBe(true);
    expect(externalHref("/admin")).toBe(false);
    expect(externalHref("mailto:a@b.c")).toBe(false);
  });
});
