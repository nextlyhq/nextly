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

import { destinationOf, externalHref, safeHref } from "./text-markdown";

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

  it("judges the destination AFTER the markdown unescaping the library applies", () => {
    // 🔴 `@lexical/markdown` unescapes the capture before creating the node:
    // a backslash before punctuation is dropped and a decimal entity is
    // decoded. Judged on the raw capture, neither spelling shows a scheme,
    // and both reach the DOM as `javascript:`.
    expect(destinationOf("javascript\\:alert%281%29")).toBe(
      "javascript:alert%281%29"
    );
    expect(destinationOf("javascript&#58;alert%281%29")).toBe(
      "javascript:alert%281%29"
    );
    for (const href of [
      "javascript\\:alert%281%29",
      "javascript&#58;alert%281%29",
      "java\u0001script&#58;alert%281%29",
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

  it("classifies the destination the browser will follow, not the raw string", () => {
    // 🔴 An allowed address behind a leading control character is admitted by
    // the guard and leaves the site when clicked; classified on the raw
    // string it received no target and no `noopener`.
    expect(externalHref("\u0001https://example.com")).toBe(true);
    expect(externalHref(" https://example.com")).toBe(true);
  });
});
