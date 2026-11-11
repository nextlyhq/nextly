/**
 * A page's plain-text copy: the words its content fields show, in their
 * order, with rich text written as Markdown, and nothing a visitor never
 * reads: not the page's SEO, its address, its bookkeeping, or the fields that
 * hold choices, numbers or other documents.
 */
import {
  fieldGroup,
  group,
  number,
  relationship,
  repeater,
  richText,
  select,
  text,
  textarea,
} from "nextly";
import { describe, expect, it } from "vitest";

import {
  copyAddressOf,
  markdownOfRichText,
  pageAddressOfCopy,
  plainCopyOf,
} from "../plain-copy";

const text_ = (value: string) => ({ type: "text", text: value, format: 0 });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });
const rich = (...children: unknown[]) => ({
  root: { type: "root", children },
});

describe("rich text as Markdown", () => {
  it("writes each kind of block as Markdown, in order", () => {
    const value = rich(
      { type: "heading", tag: "h2", children: [text_("Why it works")] },
      paragraph(
        text_("Read "),
        {
          type: "link",
          url: "https://example.com/guide",
          children: [text_("the guide")],
        },
        text_(" first.")
      ),
      {
        type: "list",
        listType: "bullet",
        children: [
          { type: "listitem", children: [text_("One")] },
          {
            type: "listitem",
            children: [
              text_("Two"),
              {
                type: "list",
                listType: "number",
                start: 3,
                children: [
                  { type: "listitem", children: [text_("Two a")] },
                  { type: "listitem", children: [text_("Two b")] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "quote",
        children: [
          text_("Said once"),
          { type: "linebreak" },
          text_("and again"),
        ],
      },
      { type: "code", language: "ts", children: [text_("const a = 1;")] },
      { type: "horizontalrule" },
      {
        type: "image",
        src: "/media/cat.png",
        altText: "A cat",
        caption: "Our cat",
      },
      paragraph()
    );
    expect(markdownOfRichText(value)).toBe(
      [
        "## Why it works",
        "Read [the guide](https://example.com/guide) first.",
        "- One\n- Two\n  3. Two a\n  4. Two b",
        "> Said once\n> and again",
        "```ts\nconst a = 1;\n```",
        "---",
        "![A cat](/media/cat.png)\nOur cat",
      ].join("\n\n")
    );
  });

  it("writes a table's rows, the first as its header", () => {
    const cell = (value: string) => ({
      type: "tablecell",
      children: [paragraph(text_(value))],
    });
    const value = rich({
      type: "table",
      children: [
        { type: "tablerow", children: [cell("Plan"), cell("Price")] },
        { type: "tablerow", children: [cell("Pro"), cell("$10")] },
      ],
    });
    expect(markdownOfRichText(value)).toBe(
      "| Plan | Price |\n| --- | --- |\n| Pro | $10 |"
    );
  });

  it("writes buttons as links", () => {
    const value = rich(
      { type: "button-link", url: "/start", text: "Start now" },
      {
        type: "button-group",
        buttons: [
          { url: "/a", text: "A" },
          { url: "/b", text: "B" },
        ],
      }
    );
    expect(markdownOfRichText(value)).toBe(
      "[Start now](/start)\n\n[A](/a) [B](/b)"
    );
  });

  it("answers nothing for a value that is not rich text", () => {
    expect(markdownOfRichText("plain words")).toBe("");
    expect(markdownOfRichText({ root: "no" })).toBe("");
    expect(markdownOfRichText(null)).toBe("");
  });
});

describe("a page's plain-text copy", () => {
  // The fields as a site declares them, through Nextly's own factories.
  const fields = [
    text({ name: "title" }),
    text({ name: "slug" }),
    textarea({ name: "excerpt" }),
    select({ name: "category", options: [{ label: "News", value: "news" }] }),
    number({ name: "views" }),
    relationship({ name: "author", relationTo: "users" }),
    richText({ name: "body" }),
    repeater({
      name: "faq",
      fields: [text({ name: "question" }), richText({ name: "answer" })],
    }),
    group({ name: "hero", fields: [text({ name: "tagline" })] }),
    group({ name: "seo", fields: [text({ name: "metaTitle" })] }),
  ];

  it("is the title as a heading, then each field's words in the order the type declares them", () => {
    const copy = plainCopyOf({
      title: "Hello world",
      titleField: "title",
      fields,
      document: {
        id: "7",
        title: "Hello world",
        slug: "hello-world",
        excerpt: "A short hello.",
        category: "news",
        views: 42,
        author: { id: "1", name: "Sam", createdAt: "2026-01-01" },
        body: rich(paragraph(text_("The body."))),
        faq: [{ question: "Why?", answer: rich(paragraph(text_("Because."))) }],
        hero: { tagline: "Say hello" },
        seo: { metaTitle: "Hello | Acme" },
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
      },
    });
    expect(copy).toBe(
      [
        "# Hello world",
        "A short hello.",
        "The body.",
        "Why?",
        "Because.",
        "Say hello",
      ].join("\n\n") + "\n"
    );
  });

  it("leaves out the address, the SEO group, choices, numbers and other documents", () => {
    const copy = plainCopyOf({
      title: "T",
      titleField: "title",
      fields,
      document: {
        title: "T",
        slug: "secret-slug",
        category: "news",
        views: 42,
        author: { id: "1", name: "Sam", createdAt: "2026-01-01" },
        seo: { metaTitle: "Meta only" },
      },
    });
    expect(copy).toBe("# T\n");
  });

  it("leaves out only the field the heading was taken from", () => {
    const copy = plainCopyOf({
      title: "Rockets",
      titleField: "title",
      fields: [
        text({ name: "title" }),
        text({ name: "heading" }),
        text({ name: "name" }),
      ],
      document: { title: "Rockets", heading: "Up we go", name: "Model 3" },
    });
    expect(copy).toBe("# Rockets\n\nUp we go\n\nModel 3\n");
  });

  it("reads the rich text of a field group, whose fields are declared elsewhere", () => {
    const copy = plainCopyOf({
      title: "T",
      fields: [fieldGroup({ name: "cta", fieldGroup: "call-to-action" })],
      document: {
        cta: { label: "x", body: rich(paragraph(text_("Act now."))) },
      },
    });
    expect(copy).toBe("# T\n\nAct now.\n");
  });

  it("reads rich text wherever it is when the type's fields are not known", () => {
    const copy = plainCopyOf({
      title: "T",
      document: {
        title: "T",
        slug: "kept-out",
        body: rich(paragraph(text_("Found."))),
        seo: { description: rich(paragraph(text_("Not content."))) },
      },
    });
    expect(copy).toBe("# T\n\nFound.\n");
  });
});

describe("where a page's plain-text copy is served", () => {
  it("adds .md to a page's address, and index.html.md to one ending in a slash", () => {
    expect(copyAddressOf("https://acme.example/blog/hello")).toBe(
      "https://acme.example/blog/hello.md"
    );
    expect(copyAddressOf("https://acme.example/")).toBe(
      "https://acme.example/index.html.md"
    );
    expect(copyAddressOf("https://acme.example/docs/")).toBe(
      "https://acme.example/docs/index.html.md"
    );
  });

  it("reads a copy's address back to the page's, and nothing else", () => {
    expect(pageAddressOfCopy("/blog/hello.md")).toBe("/blog/hello");
    expect(pageAddressOfCopy("/index.html.md")).toBe("/");
    expect(pageAddressOfCopy("/docs/index.html.md")).toBe("/docs/");
    expect(pageAddressOfCopy("/blog/hello")).toBeUndefined();
    expect(pageAddressOfCopy("/.md")).toBeUndefined();
    expect(pageAddressOfCopy("/notes.txt")).toBeUndefined();
  });
});
