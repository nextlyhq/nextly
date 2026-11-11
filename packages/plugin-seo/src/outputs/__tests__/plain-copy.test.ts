/**
 * A page's plain-text copy: the words its content fields show, in their
 * order, with rich text written as Markdown, and nothing a visitor never
 * reads: not the page's SEO, its address, its bookkeeping, or the fields that
 * hold choices, numbers or other documents.
 */
import { describe, expect, it } from "vitest";

import {
  copyAddressOf,
  markdownOfRichText,
  pageAddressOfCopy,
  plainCopyOf,
} from "../plain-copy";

const text = (value: string) => ({ type: "text", text: value, format: 0 });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });
const rich = (...children: unknown[]) => ({
  root: { type: "root", children },
});

describe("rich text as Markdown", () => {
  it("writes each kind of block as Markdown, in order", () => {
    const value = rich(
      { type: "heading", tag: "h2", children: [text("Why it works")] },
      paragraph(
        text("Read "),
        {
          type: "link",
          url: "https://example.com/guide",
          children: [text("the guide")],
        },
        text(" first.")
      ),
      {
        type: "list",
        listType: "bullet",
        children: [
          { type: "listitem", children: [text("One")] },
          {
            type: "listitem",
            children: [
              text("Two"),
              {
                type: "list",
                listType: "number",
                start: 3,
                children: [
                  { type: "listitem", children: [text("Two a")] },
                  { type: "listitem", children: [text("Two b")] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "quote",
        children: [text("Said once"), { type: "linebreak" }, text("and again")],
      },
      { type: "code", language: "ts", children: [text("const a = 1;")] },
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
      children: [paragraph(text(value))],
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
  const fields = [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
    { name: "excerpt", type: "textarea" },
    { name: "category", type: "select" },
    { name: "views", type: "number" },
    { name: "author", type: "relationship" },
    { name: "body", type: "richText" },
    {
      name: "faq",
      type: "array",
      fields: [
        { name: "question", type: "text" },
        { name: "answer", type: "richText" },
      ],
    },
    {
      name: "hero",
      type: "group",
      fields: [{ name: "tagline", type: "text" }],
    },
    {
      name: "sections",
      type: "blocks",
      blocks: [
        { slug: "callout", fields: [{ name: "note", type: "textarea" }] },
      ],
    },
    {
      name: "seo",
      type: "group",
      fields: [{ name: "metaTitle", type: "text" }],
    },
  ];

  it("is the title as a heading, then each field's words in the order the type declares them", () => {
    const copy = plainCopyOf({
      title: "Hello world",
      fields,
      document: {
        id: "7",
        title: "Hello world",
        slug: "hello-world",
        excerpt: "A short hello.",
        category: "news",
        views: 42,
        author: { id: "1", name: "Sam", createdAt: "2026-01-01" },
        body: rich(paragraph(text("The body."))),
        faq: [{ question: "Why?", answer: rich(paragraph(text("Because."))) }],
        hero: { tagline: "Say hello" },
        sections: [{ blockType: "callout", note: "Mind the gap." }],
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
        "Mind the gap.",
      ].join("\n\n") + "\n"
    );
  });

  it("leaves out the address, the SEO group, choices, numbers and other documents", () => {
    const copy = plainCopyOf({
      title: "T",
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

  it("says the title once where a row lays it out, and reads a named tab's fields", () => {
    const copy = plainCopyOf({
      title: "T",
      fields: [
        {
          type: "row",
          fields: [
            { name: "title", type: "text" },
            { name: "kicker", type: "text" },
          ],
        },
        {
          type: "tabs",
          tabs: [
            { name: "intro", fields: [{ name: "lead", type: "textarea" }] },
          ],
        },
      ],
      document: { title: "T", kicker: "New", intro: { lead: "Lead words." } },
    });
    expect(copy).toBe("# T\n\nNew\n\nLead words.\n");
  });

  it("reads rich text wherever it is when the type's fields are not known", () => {
    const copy = plainCopyOf({
      title: "T",
      document: {
        title: "T",
        slug: "kept-out",
        body: rich(paragraph(text("Found."))),
        seo: { description: rich(paragraph(text("Not content."))) },
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
