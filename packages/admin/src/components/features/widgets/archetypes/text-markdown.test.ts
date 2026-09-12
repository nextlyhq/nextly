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

import {
  destinationOf,
  externalHref,
  representableMarkdown,
  safeHref,
} from "./text-markdown";

describe("which hrefs may become links", () => {
  it("allows the web, mail, phone and paths on this site", () => {
    for (const href of [
      "https://example.com/runbook",
      "http://intranet/wiki",
      "mailto:ops@example.com",
      "tel:+15551234567",
      "/admin/collections/posts",
      "./sibling",
      "../parent",
      "#section",
    ]) {
      expect(safeHref(href), href).toBe(true);
      expect(destinationOf(href), href).toBe(href);
    }
  });

  it("refuses a destination the link node would rewrite before rendering it", () => {
    // 🔴 `@lexical/link` formats a scheme-less destination: one that does not
    // start with `/`, `.` or `#` is prefixed `https://`, an address with an
    // `@` becomes `mailto:`. Read here as a path on this site,
    // `posts?status=draft` rendered as a link to a host called `posts` that
    // opened a new tab. Refused, it stays markdown the author can see;
    // decided by asking the formatter, not by restating its prefixes.
    for (const href of [
      "posts?status=draft",
      "example.com",
      "me@example.com",
    ]) {
      expect(safeHref(href), href).toBe(false);
      expect(destinationOf(href), href).toBeUndefined();
    }
  });

  it("decodes a reference no code point can hold the way a browser does, rather than throwing", () => {
    // 🔴 The library decodes `&#1114112;` by throwing a RangeError. Judged
    // here by the same rule the whole card is decoded with -- HTML's, which
    // yields U+FFFD -- the destination is a string like any other, and the
    // link is a link to it.
    expect(destinationOf("https://example.com/&#1114112;")).toBe(
      "https://example.com/\uFFFD"
    );
    expect(destinationOf("https://example.com/&#99999999999999999999;")).toBe(
      "https://example.com/\uFFFD"
    );
    // The bound, not merely the shape: the last code point decodes as itself.
    expect(destinationOf("https://example.com/&#1114111;")).toBe(
      "https://example.com/\u{10FFFF}"
    );
  });

  it("makes a whole card representable by that one rule", () => {
    // Prose, a title and a destination are decoded alike, and a reference the
    // library CAN hold is left for it to decode.
    expect(
      representableMarkdown(
        'Price &#1114112; each, [a](https://x.test "&#1114112;") &#65;'
      )
    ).toBe('Price \uFFFD each, [a](https://x.test "\uFFFD") &#65;');
  });

  it("decodes an ESCAPED reference no code point can hold, too", () => {
    // 🔴 The library drops a backslash before punctuation before it decodes
    // references, and `#` and `;` are punctuation -- so these reach its
    // decoder as `&#1114112;` and threw there, past a decode that matched
    // only the unescaped spelling.
    expect(representableMarkdown("&\\#1114112;")).toBe("\uFFFD");
    expect(representableMarkdown("&#1114112\\;")).toBe("\uFFFD");
    expect(representableMarkdown("\\&\\#1114112\\;")).toBe("\uFFFD");
    expect(destinationOf("https://example.com/&#1114112\\;")).toBe(
      "https://example.com/\uFFFD"
    );
    // A backslash that is itself escaped is one character of text, as the
    // library reads it, and the reference after it is decoded on its own.
    expect(representableMarkdown("\\\\&#1114112;")).toBe("\\\\\uFFFD");
    // A reference the library CAN hold is left for it to decode.
    expect(representableMarkdown("&#65\\;")).toBe("&#65\\;");
  });

  it("refuses a destination the browser's URL parser sends somewhere its written form does not say", () => {
    // 🔴 For `http` and `https` the parser reads a backslash as a slash, so
    // `/\evil.example` -- a path, as written, and so opened in this tab -- is
    // the host `evil.example`; and it reads `https:evil.example` as a path on
    // an https page and a host on an http one. Each was admitted as a path on
    // this site.
    for (const href of [
      "/\\evil.example",
      // The same destination as markdown writes it escaped.
      "/\\\\evil.example",
      "https:\\evil.example",
      "https:evil.example",
      "http:evil.example",
    ]) {
      expect(destinationOf(href), href).toBeUndefined();
    }
  });

  it("admits every destination whose written form and parsed form agree", () => {
    // The control: a rule refusing whatever a parser touches would satisfy
    // the case above and refuse every link below.
    for (const [href, leaves] of [
      ["/admin/collections/notes", false],
      ["./posts?status=draft", false],
      ["#top", false],
      ["/%5Cevil.example", false],
      ["https://example.com/runbook", true],
      ["//example.com/runbook", true],
      ["mailto:ops@example.com", false],
      ["tel:+15551234567", false],
    ] as const) {
      const destination = destinationOf(href);
      expect(destination, href).toBe(href);
      expect(externalHref(href), href).toBe(leaves);
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
    // Asserted on an ALLOWED scheme spelled the same two ways, because the
    // refused one has no destination to compare: what the guard reads is the
    // unescaped string, and the scheme is read off that.
    expect(destinationOf("https\\://example.com")).toBe("https://example.com");
    expect(destinationOf("https&#58;//example.com")).toBe(
      "https://example.com"
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

  it("is asked of the destination the guard produced, which has no control characters left", () => {
    // 🔴 An allowed address behind a leading control character is admitted by
    // the guard and leaves the site when clicked; classified on the raw
    // string it received no target and no `noopener`. The guard's destination
    // is what the node carries, and it is what the classification reads.
    for (const raw of ["\u0001https://example.com", " https://example.com"]) {
      const destination = destinationOf(raw);
      expect(destination, JSON.stringify(raw)).toBe("https://example.com");
      expect(externalHref(destination!)).toBe(true);
    }
  });
});
