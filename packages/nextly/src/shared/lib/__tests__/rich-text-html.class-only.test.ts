/**
 * Class-only rich text HTML (`styles: "none"`): no style Nextly adds, a class
 * in the `nextly-rich-text-` namespace on every element, alignment as a class,
 * and the styles an author chose kept.
 *
 * @module shared/lib/__tests__/rich-text-html.class-only.test
 */
import { describe, expect, it } from "vitest";

import type { RichTextValue } from "../../../collections/fields/types/rich-text";
import { convertRichTextToHtml, formatRichTextOutput } from "../rich-text-html";

import { EVERY_NODE } from "./rich-text-html.fixture";

const classOnly = (value: RichTextValue): string =>
  convertRichTextToHtml(value, { styles: "none" }) ?? "";

const ALL = classOnly(EVERY_NODE);

/** Every `style="…"` value in some HTML. */
const styles = (html: string): string[] =>
  [...html.matchAll(/ style="([^"]*)"/g)].map(match => match[1]);

describe("class-only rich text HTML", () => {
  it("carries no style but the ones authors chose", () => {
    // The fixture's author styles: a text colour, and the two buttons whose
    // colours were picked. Nothing else may carry one.
    expect(styles(ALL)).toEqual([
      "color:#ff0000",
      "background-color:#123456;color:#ffffff",
      "color:#654321;border-color:#654321",
    ]);
  });

  it("writes only classes in the nextly-rich-text- namespace, apart from code tokens", () => {
    // Syntax tokens keep the engine's `nextly-code-token` classes, which the
    // React renderer writes too, so a site styles code once for both.
    const classes = [...ALL.matchAll(/ class="([^"]*)"/g)].flatMap(match =>
      match[1].split(" ")
    );
    const outside = classes.filter(
      name =>
        !name.startsWith("nextly-rich-text-") &&
        !name.startsWith("nextly-code-token")
    );
    expect(outside).toEqual([]);
  });

  it.each([
    ["paragraph", '<p class="nextly-rich-text-paragraph">Plain</p>'],
    [
      "paragraph alignment, as a keyword",
      '<p class="nextly-rich-text-paragraph nextly-rich-text-align-center">Centred</p>',
    ],
    [
      "paragraph alignment, as a legacy number",
      '<p class="nextly-rich-text-paragraph nextly-rich-text-align-right">Legacy right</p>',
    ],
    ["bold", '<strong class="nextly-rich-text-bold">bold</strong>'],
    ["italic", '<em class="nextly-rich-text-italic">italic</em>'],
    ["strikethrough", '<s class="nextly-rich-text-strikethrough">struck</s>'],
    ["underline", '<u class="nextly-rich-text-underline">underlined</u>'],
    ["inline code", '<code class="nextly-rich-text-code">code</code>'],
    ["subscript", '<sub class="nextly-rich-text-subscript">sub</sub>'],
    ["superscript", '<sup class="nextly-rich-text-superscript">sup</sup>'],
    ["highlight", '<mark class="nextly-rich-text-highlight">marked</mark>'],
    ["heading", '<h1 class="nextly-rich-text-h1">One</h1>'],
    [
      "heading alignment",
      '<h2 class="nextly-rich-text-h2 nextly-rich-text-align-justify">Two</h2>',
    ],
    [
      "quote",
      '<blockquote class="nextly-rich-text-blockquote">Quoted</blockquote>',
    ],
    ["bullet list", '<ul class="nextly-rich-text-list nextly-rich-text-ul">'],
    [
      "numbered list",
      '<ol start="3" class="nextly-rich-text-list nextly-rich-text-ol">',
    ],
    [
      "checklist",
      '<ul class="nextly-rich-text-list nextly-rich-text-ul nextly-rich-text-checklist">',
    ],
    ["list item", '<li class="nextly-rich-text-list-item">Bullet</li>'],
    [
      "checked item",
      '<li class="nextly-rich-text-list-item nextly-rich-text-list-item--checked"><input class="nextly-rich-text-checkbox" type="checkbox" checked disabled>Done</li>',
    ],
    [
      "unchecked item",
      '<li class="nextly-rich-text-list-item nextly-rich-text-list-item--unchecked"><input class="nextly-rich-text-checkbox" type="checkbox" disabled>To do</li>',
    ],
    ["link", 'class="nextly-rich-text-link" href="https://example.com/a"'],
    [
      "code block",
      '<pre class="nextly-rich-text-code-block" data-language="ts">',
    ],
    ["rule", '<hr class="nextly-rich-text-hr">'],
    [
      "image with caption",
      '<figure class="nextly-rich-text-figure"><img class="nextly-rich-text-image" src="https://example.com/a.png" alt="An image" width="640" height="480"><figcaption class="nextly-rich-text-caption">Its caption</figcaption></figure>',
    ],
    [
      "video",
      '<div class="nextly-rich-text-video"><iframe class="nextly-rich-text-video-frame" src="https://www.youtube-nocookie.com/embed/abc123" frameborder="0" allowfullscreen loading="lazy"></iframe></div>',
    ],
    [
      "button",
      '<div class="nextly-rich-text-button-link nextly-rich-text-align-left"><a class="nextly-rich-text-button nextly-rich-text-button--filled nextly-rich-text-button--lg"',
    ],
    [
      "button group",
      '<div class="nextly-rich-text-button-group nextly-rich-text-align-right"><a class="nextly-rich-text-button nextly-rich-text-button--filled nextly-rich-text-button--md" href="https://example.com/1">One</a>',
    ],
    [
      "gallery",
      '<div class="nextly-rich-text-gallery nextly-rich-text-gallery--cols-2"><img class="nextly-rich-text-gallery-image"',
    ],
    [
      "collapsible",
      '<details class="nextly-rich-text-collapsible" open><summary class="nextly-rich-text-collapsible-title">More</summary><div class="nextly-rich-text-collapsible-content">',
    ],
    [
      "table",
      '<table class="nextly-rich-text-table"><tr class="nextly-rich-text-table-row">',
    ],
    [
      "header cell",
      '<th class="nextly-rich-text-table-cell nextly-rich-text-table-header-cell">Head</th>',
    ],
    ["cell", '<td class="nextly-rich-text-table-cell">Cell</td>'],
  ])("names the %s", (_node, markup) => {
    expect(ALL).toContain(markup);
  });

  it("keeps the style an author set on text, sanitized", () => {
    // A declaration the sanitizer refuses is dropped in both outputs alike;
    // the colour the author chose stays.
    const html = classOnly({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                text: "Hi",
                style: "color: #00aa00; position: fixed",
              },
            ],
          },
        ],
      },
    } as unknown as RichTextValue);
    expect(html).toBe(
      '<p class="nextly-rich-text-paragraph"><span style="color:#00aa00">Hi</span></p>'
    );
  });

  it("leaves a filled button with no chosen colours unstyled, where the default look fills it in", () => {
    const button = {
      root: {
        type: "root",
        children: [{ type: "button-link", url: "/x", text: "X" }],
      },
    } as unknown as RichTextValue;
    expect(classOnly(button)).toBe(
      '<div class="nextly-rich-text-button-link nextly-rich-text-align-center"><a class="nextly-rich-text-button nextly-rich-text-button--filled nextly-rich-text-button--md" href="/x">X</a></div>'
    );
    expect(convertRichTextToHtml(button)).toContain(
      "background-color:#000;color:#fff"
    );
  });

  it("applies to the HTML of both formats that return it, and not to JSON", () => {
    const html = formatRichTextOutput(EVERY_NODE, "html", { styles: "none" });
    const both = formatRichTextOutput(EVERY_NODE, "both", { styles: "none" });
    expect(html).toBe(ALL);
    expect(both).toEqual({ json: EVERY_NODE, html: ALL });
    expect(formatRichTextOutput(EVERY_NODE, "json", { styles: "none" })).toBe(
      EVERY_NODE
    );
  });

  it("is the default output when styles is left unset or set to default", () => {
    expect(convertRichTextToHtml(EVERY_NODE, { styles: "default" })).toBe(
      convertRichTextToHtml(EVERY_NODE)
    );
    expect(
      styles(convertRichTextToHtml(EVERY_NODE) ?? "").length
    ).toBeGreaterThan(30);
  });
});
