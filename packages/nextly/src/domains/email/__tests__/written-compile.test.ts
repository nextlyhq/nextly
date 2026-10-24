/**
 * A written email's blocks compile to Liquid, and render safely for where
 * each value sits. Rendered here through the same engine every email uses.
 */
import { describe, expect, it } from "vitest";

import { renderLiquid } from "../services/liquid-engine";
import { compileWrittenHtml, compileWrittenText } from "../written/compile";
import {
  writtenDocumentSchema,
  type WrittenBlock,
  type WrittenDocument,
} from "../written/document";

const doc = (...blocks: WrittenBlock[]): WrittenDocument =>
  writtenDocumentSchema.parse({ version: 1, blocks });

const html = (d: WrittenDocument, data: Record<string, unknown> = {}) =>
  renderLiquid(compileWrittenHtml(d), data, "html");
const text = (d: WrittenDocument, data: Record<string, unknown> = {}) =>
  renderLiquid(compileWrittenText(d), data, "text");

const named = doc({
  type: "text",
  text: [
    { type: "text", text: "Hi " },
    { type: "chip", variable: "name", fallback: "there" },
  ],
});

describe("a chip's fallback", () => {
  it.each([
    ["absent", {}, "Hi there"],
    ["null", { name: null }, "Hi there"],
    ["an empty string", { name: "" }, "Hi there"],
    ["false", { name: false }, "Hi false"],
    ["0", { name: 0 }, "Hi 0"],
    ["a value", { name: "Priya" }, "Hi Priya"],
  ])("when the value is %s", (_case, data, expected) => {
    expect(html(named, data)).toContain(`>${expected}</p>`);
    expect(text(named, data)).toBe(`${expected}\n\n`);
  });
});

describe("a block's condition", () => {
  const when = (when: "present" | "yes" | "no") =>
    doc({
      type: "heading",
      text: [{ type: "text", text: "Shown" }],
      show: { variable: "flag", when },
    });

  it.each([
    ["absent", {}, [false, false, false]],
    ["null", { flag: null }, [false, false, false]],
    ["an empty string", { flag: "" }, [false, false, false]],
    ["an empty list", { flag: [] }, [false, false, false]],
    ["false", { flag: false }, [true, false, true]],
    ["true", { flag: true }, [true, true, false]],
    ["0", { flag: 0 }, [true, false, false]],
    ["a value", { flag: "x" }, [true, false, false]],
  ] as const)("when the variable is %s", (_case, data, [present, yes, no]) => {
    expect(html(when("present"), data).includes("Shown")).toBe(present);
    expect(html(when("yes"), data).includes("Shown")).toBe(yes);
    expect(html(when("no"), data).includes("Shown")).toBe(no);
  });
});

describe("a list", () => {
  const lines = doc({
    type: "list",
    variable: "lines",
    blocks: [
      {
        type: "text",
        text: [
          { type: "chip", variable: "item.name" },
          { type: "text", text: ": " },
          { type: "chip", variable: "item.price" },
        ],
      },
    ],
  });

  it("repeats its blocks with each item's own values", () => {
    const out = html(lines, {
      lines: [
        { name: "Tea", price: "$4" },
        { name: "Cake", price: "$6" },
        { name: "Jam", price: "$3" },
      ],
    });
    expect(out.match(/<p /g)).toHaveLength(3);
    expect(out).toContain(">Tea: $4</p>");
    expect(out).toContain(">Cake: $6</p>");
    expect(out).toContain(">Jam: $3</p>");
  });

  it.each([
    ["absent", {}],
    ["a string", { lines: "Tea" }],
    ["an object", { lines: { name: "Tea" } }],
  ])("repeats nothing when the variable is %s", (_case, data) => {
    expect(html(lines, data)).toBe("");
  });
});

describe("values written safely for where they sit", () => {
  const hostile = `<script>alert("x")</script> & 'q'`;

  it("escapes a chip and the editor's own text in HTML", () => {
    const d = doc({
      type: "text",
      text: [
        { type: "text", text: "Fish & <chips> {{ secret }} {% if x %}" },
        { type: "chip", variable: "name" },
      ],
    });
    const out = html(d, { name: hostile, secret: "LEAK" });
    expect(out).toContain("Fish &amp; &lt;chips&gt; {{ secret }} {% if x %}");
    expect(out).not.toContain("LEAK");
    expect(out).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;"
    );
  });

  it("writes a chip as it is in plain text, and never reads the editor's braces", () => {
    const d = doc({
      type: "text",
      text: [
        { type: "text", text: "{{ secret }} " },
        { type: "chip", variable: "name" },
      ],
    });
    expect(text(d, { name: hostile, secret: "LEAK" })).toBe(
      `{{ secret }} ${hostile}\n\n`
    );
  });

  it.each([
    ["javascript:alert(1)", ""],
    ["  JavaScript:alert(1)", ""],
    ["data:text/html,x", ""],
    ["https://example.com/a?b=1&c=2", "https://example.com/a?b=1&amp;c=2"],
    ["mailto:hi@example.com", "mailto:hi@example.com"],
    [
      `https://x.test/"onmouseover="alert(1)`,
      "https://x.test/&quot;onmouseover=&quot;alert(1)",
    ],
  ])("checks a link from a chip: %s", (url, expected) => {
    const d = doc({
      type: "button",
      label: [{ type: "text", text: "Go" }],
      link: { chip: { variable: "url" } },
    });
    const out = html(d, { url });
    expect(out).toContain(`<a href="${expected}"`);
    expect(out).toContain(`href="${expected}" style="height:44px`);
  });

  it("allows only web addresses for an image from a chip", () => {
    const d = doc({
      type: "image",
      src: { chip: { variable: "src" } },
      alt: [{ type: "text", text: "Logo" }],
    });
    expect(html(d, { src: "mailto:x@y.z" })).toContain(`src=""`);
    expect(html(d, { src: "https://cdn.test/a.png" })).toContain(
      `src="https://cdn.test/a.png"`
    );
  });
});

describe("the plain text", () => {
  it("is readable on its own: link text followed by the link", () => {
    const d = doc(
      { type: "heading", text: [{ type: "text", text: "Your order" }] },
      {
        type: "text",
        text: [
          { type: "text", text: "Read the " },
          {
            type: "text",
            text: "terms",
            link: { url: "https://shop.test/terms" },
          },
          { type: "text", text: "." },
        ],
      },
      {
        type: "button",
        label: [{ type: "text", text: "Track it" }],
        link: { chip: { variable: "trackUrl" } },
      },
      { type: "divider" },
      { type: "spacer" }
    );
    expect(text(d, { trackUrl: "https://shop.test/t/1" })).toBe(
      "Your order\n\nRead the terms (https://shop.test/terms).\n\nTrack it (https://shop.test/t/1)\n\n----------\n\n"
    );
  });
});

describe("the stored form", () => {
  it.each([
    [
      "a fixed link to another scheme",
      {
        type: "button",
        label: [{ type: "text", text: "x" }],
        link: { url: "javascript:alert(1)" },
      },
    ],
    [
      "a list inside a list",
      {
        type: "list",
        variable: "a",
        blocks: [{ type: "list", variable: "b", blocks: [] }],
      },
    ],
    [
      "a variable that is not a name",
      { type: "text", text: [{ type: "chip", variable: "a | upcase" }] },
    ],
    ["a block it does not know", { type: "video" }],
    [
      "a chip reading a name the compiled email assigns",
      { type: "text", text: [{ type: "chip", variable: "nextly_shown" }] },
    ],
    [
      "a condition on a name the compiled email assigns",
      {
        type: "divider",
        show: { variable: "nextly_items.length", when: "present" },
      },
    ],
    [
      "a list over a name the compiled email assigns",
      { type: "list", variable: "nextly_items", blocks: [] },
    ],
  ])("refuses %s", (_case, block) => {
    expect(
      writtenDocumentSchema.safeParse({ version: 1, blocks: [block] }).success
    ).toBe(false);
  });

  it("keeps a caller's value under a name that only resembles the compiler's", () => {
    // The control: only the names the compiled Liquid assigns are refused.
    const d = doc(
      { type: "divider", show: { variable: "flag", when: "present" } },
      {
        type: "text",
        text: [{ type: "chip", variable: "nextly_shown_at" }],
      }
    );
    expect(html(d, { flag: "x", nextly_shown_at: "noon" })).toContain(
      ">noon</p>"
    );
  });
});
