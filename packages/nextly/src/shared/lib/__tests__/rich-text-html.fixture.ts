/**
 * One rich text document holding every node type the HTML converter writes,
 * each in the variants that change its markup: alignment on paragraphs and
 * headings, every text format, an author's colour, the three list kinds and
 * both checklist states, a link with every attribute, a captioned image, a
 * video, a filled and an outline button, a button group, a gallery, a
 * collapsible section and a table with a header row.
 *
 * Shared by the default-output snapshot and the class-only tests, so both
 * judge the same document.
 *
 * @module shared/lib/__tests__/rich-text-html.fixture
 */
import type { RichTextValue } from "../../../collections/fields/types/rich-text";

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  text: value,
  ...extra,
});

const paragraph = (
  children: Record<string, unknown>[],
  format: string | number = ""
) => ({ type: "paragraph", format, children });

export const EVERY_NODE: RichTextValue = {
  root: {
    type: "root",
    children: [
      paragraph([text("Plain")]),
      paragraph([text("Centred")], "center"),
      paragraph([text("Legacy right")], 3),
      paragraph([
        text("bold", { format: 1 }),
        text("italic", { format: 2 }),
        text("struck", { format: 4 }),
        text("underlined", { format: 8 }),
        text("code", { format: 16 }),
        text("sub", { format: 32 }),
        text("sup", { format: 64 }),
        text("marked", { format: 128 }),
        text("coloured", { style: "color: #ff0000" }),
        { type: "linebreak" },
        text("after a break"),
      ]),
      { type: "heading", tag: "h1", children: [text("One")] },
      {
        type: "heading",
        tag: "h2",
        format: "justify",
        children: [text("Two")],
      },
      { type: "heading", tag: "h6", children: [text("Six")] },
      { type: "quote", children: [text("Quoted")] },
      {
        type: "list",
        listType: "bullet",
        children: [{ type: "listitem", children: [text("Bullet")] }],
      },
      {
        type: "list",
        listType: "number",
        start: 3,
        children: [{ type: "listitem", children: [text("Third")] }],
      },
      {
        type: "list",
        listType: "check",
        children: [
          { type: "listitem", checked: true, children: [text("Done")] },
          { type: "listitem", checked: false, children: [text("To do")] },
        ],
      },
      paragraph([
        {
          type: "link",
          url: "https://example.com/a",
          target: "_blank",
          rel: "noopener",
          title: "Example",
          children: [text("A link")],
        },
      ]),
      {
        type: "code",
        language: "ts",
        children: [
          { type: "code-highlight", text: "const", highlightType: "keyword" },
          { type: "code-highlight", text: " x = 1" },
        ],
      },
      { type: "horizontalrule" },
      {
        type: "image",
        src: "https://example.com/a.png",
        altText: "An image",
        width: 640,
        height: 480,
        caption: "Its caption",
      },
      { type: "image", src: "https://example.com/b.png", altText: "Bare" },
      {
        type: "video",
        provider: "youtube",
        videoId: "abc123",
        caption: "A video",
      },
      {
        type: "button-link",
        url: "https://example.com/go",
        text: "Go",
        variant: "filled",
        size: "lg",
        bgColor: "#123456",
        textColor: "#ffffff",
        alignment: "left",
      },
      {
        type: "button-link",
        url: "https://example.com/more",
        text: "More",
        variant: "outline",
        size: "sm",
        textColor: "#654321",
        target: "_blank",
      },
      {
        type: "button-group",
        alignment: "right",
        buttons: [
          { url: "https://example.com/1", text: "One" },
          {
            url: "https://example.com/2",
            text: "Two",
            variant: "outline",
            size: "sm",
            target: "_blank",
          },
        ],
      },
      {
        type: "gallery",
        columns: 2,
        caption: "A gallery",
        images: [
          { src: "https://example.com/1.png", alt: "One", width: 100 },
          { src: "https://example.com/2.png", alt: "Two" },
        ],
      },
      {
        type: "collapsible-container",
        open: true,
        children: [
          { type: "collapsible-title", children: [text("More")] },
          {
            type: "collapsible-content",
            children: [paragraph([text("Hidden")])],
          },
        ],
      },
      {
        type: "table",
        children: [
          {
            type: "tablerow",
            children: [
              { type: "tablecell", headerState: 1, children: [text("Head")] },
            ],
          },
          {
            type: "tablerow",
            children: [{ type: "tablecell", children: [text("Cell")] }],
          },
        ],
      },
    ],
  },
} as unknown as RichTextValue;
