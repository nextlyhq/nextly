/**
 * Rich Text HTML Conversion Utilities
 *
 * Provides server-side conversion of Lexical Rich Text JSON to HTML.
 * Uses a custom serializer that doesn't require DOM/JSDOM for server-side rendering.
 *
 * @module lib/rich-text-html
 * @since 1.0.0
 */

import {
  codeTokenClass,
  isRichTextValue,
  formatsDrawnByStyle,
  TEXT_FORMAT,
} from "@nextlyhq/blocks-engine";

import type { RichTextValue } from "../../collections/fields/types/rich-text";
import {
  sanitizeCssColor,
  sanitizeInlineStyle,
} from "../../services/security/css-validator";
import { consoleLogger } from "../types";

// ============================================================
// Types
// ============================================================

export type RichTextOutputFormat = "json" | "html" | "both";

export interface RichTextBothFormat {
  json: RichTextValue;
  html: string;
}

interface LexicalSerializedNode {
  type: string;
  children?: LexicalSerializedNode[];
  text?: string;
  highlightType?: string | null;
  format?: number;
  style?: string;
  tag?: string;
  url?: string;
  target?: string;
  rel?: string;
  title?: string;
  listType?: string;
  start?: number;
  value?: number;
  language?: string;
  direction?: string | null;
  indent?: number;
  version?: number;
  // Image fields
  src?: string;
  altText?: string;
  width?: number;
  height?: number;
  caption?: string;
  // Video fields
  provider?: string;
  videoId?: string;
  // Button link fields
  variant?: string;
  size?: string;
  bgColor?: string;
  textColor?: string;
  alignment?: string;
  // Button group fields
  buttons?: Array<{
    url: string;
    text: string;
    target?: string;
    variant?: string;
    size?: string;
    bgColor?: string;
    textColor?: string;
  }>;
  // List item fields
  checked?: boolean;
  // Gallery fields
  images?: Array<{
    src: string;
    alt: string;
    width?: number;
    height?: number;
  }>;
  columns?: number;
  // Collapsible fields
  open?: boolean;
  [key: string]: unknown;
}

// ============================================================
// Text Format Flags (from Lexical)
// ============================================================

// Imported, never re-declared. These numbers are what a stored node MEANS, and
// a second copy agrees on the day it is written and drifts the day Lexical adds
// a format — silently, because both copies still compile and both still render
// something. The engine's copy is the one both this serializer and the block
// renderer read.

// ============================================================
// Element Format (Alignment) mapping
// ============================================================

type Alignment = "left" | "center" | "right" | "justify" | "start" | "end";

// Lexical stores alignment as a number in older documents and as a keyword in
// newer ones; both resolve to the keyword, which is both the `text-align`
// value and the class's suffix.
const NUMERIC_ALIGNMENT: Record<number, Alignment> = {
  1: "left",
  2: "center",
  3: "right",
  4: "justify",
  5: "start",
  6: "end",
};

const ALIGNMENTS: ReadonlySet<string> = new Set<Alignment>([
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
]);

/** The alignment a block node was given, in either of Lexical's spellings. */
function alignmentOf(node: LexicalSerializedNode): Alignment | undefined {
  if (typeof node.format === "string" && node.format !== "") {
    return ALIGNMENTS.has(node.format) ? node.format : undefined;
  }
  if (typeof node.format === "number" && node.format > 0) {
    return NUMERIC_ALIGNMENT[node.format];
  }
  return undefined;
}

// ============================================================
// Output styles
// ============================================================

/**
 * How the HTML is styled.
 *
 * - `"default"` carries Nextly's own look as inline styles, so the HTML reads
 *   well dropped into a page whose CSS resets every element.
 * - `"none"` carries no style Nextly adds. Every element has a class in the
 *   `nextly-rich-text-` namespace, alignment is a class too, and the site's
 *   own stylesheet decides the look, which an inline style would outrank.
 *
 * Styles an author chose in the editor (a text colour, a button's colours) are
 * the author's content, so both keep them.
 */
export type RichTextStyles = "default" | "none";

export interface RichTextHtmlOptions {
  /** @default "default" */
  styles?: RichTextStyles;
}

/** What every serializer is handed: whether Nextly's look is left out. */
interface RenderContext {
  readonly classOnly: boolean;
}

/** The class naming an element, in the namespace every class here shares. */
const named = (name: string): string => `nextly-rich-text-${name}`;

/** ` style="…"` carrying Nextly's look, or nothing where the site styles it. */
function lookStyle(ctx: RenderContext, css: string): string {
  return ctx.classOnly ? "" : ` style="${css}"`;
}

/**
 * The ` class="…"` attribute: the classes both outputs carry, then in
 * class-only output the ones naming each element and its variant, or in the
 * default output the older classes outside the namespace it has always
 * carried. Nothing is added to the default output, which stays as it was, and
 * class-only output carries only namespaced classes.
 */
function classAttr(
  ctx: RenderContext,
  always: readonly string[],
  classOnly: readonly string[] = [],
  defaultOnly: readonly string[] = []
): string {
  const names = [...always, ...(ctx.classOnly ? classOnly : defaultOnly)];
  return names.length > 0 ? ` class="${names.join(" ")}"` : "";
}

/** The class an alignment is spelled as in class-only output. */
function alignClass(alignment: Alignment | undefined): string[] {
  return alignment ? [named(`align-${alignment}`)] : [];
}

// ============================================================
// HTML Escaping
// ============================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeUrl(url: string): string {
  try {
    return encodeURI(url);
  } catch {
    return url;
  }
}

/**
 * Validates that a URL uses a safe protocol (allowlist approach).
 * Blocks javascript:, vbscript:, data:, and any other non-standard protocol.
 * Normalizes control characters (tab, newline, CR, null byte) before checking
 * to prevent bypass via whitespace insertion.
 */
function isUrlSafe(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const normalized = url
    .replace(/[\t\n\r\0]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  // Allow relative URLs, anchors, query strings
  if (/^[/#?]/.test(normalized)) return true;
  // Allow safe protocols
  if (/^https?:\/\//.test(normalized)) return true;
  if (normalized.startsWith("mailto:")) return true;
  if (normalized.startsWith("tel:")) return true;
  // Block anything with a colon (unknown/dangerous protocol)
  if (normalized.includes(":")) return false;
  // Allow bare paths (no protocol — treated as relative by browsers)
  return true;
}

// ============================================================
// Node Serializers
// ============================================================

/** A text format's wrapper: its class in class-only output, else its look. */
function formatWrapper(
  ctx: RenderContext,
  tag: string,
  name: string,
  look: string,
  content: string
): string {
  return `<${tag}${classAttr(ctx, [], [named(name)])}${lookStyle(ctx, look)}>${content}</${tag}>`;
}

function applyTextFormat(
  content: string,
  format: number,
  ctx: RenderContext
): string {
  // Takes content that is ALREADY escaped, because the style span now sits
  // inside these wrappers and has to be built before they are applied.
  let result = content;

  if (format & TEXT_FORMAT.CODE) {
    // Class, not an inline style: the site owns how its code reads, and an
    // inline background here is unreachable from its stylesheet.
    result = `<code class="nextly-rich-text-code">${result}</code>`;
  }
  if (format & TEXT_FORMAT.SUBSCRIPT) {
    result = formatWrapper(
      ctx,
      "sub",
      "subscript",
      "font-size:0.75em;vertical-align:sub",
      result
    );
  }
  if (format & TEXT_FORMAT.SUPERSCRIPT) {
    result = formatWrapper(
      ctx,
      "sup",
      "superscript",
      "font-size:0.75em;vertical-align:super",
      result
    );
  }
  if (format & TEXT_FORMAT.STRIKETHROUGH) {
    result = formatWrapper(
      ctx,
      "s",
      "strikethrough",
      "text-decoration:line-through",
      result
    );
  }
  if (format & TEXT_FORMAT.UNDERLINE) {
    result = formatWrapper(
      ctx,
      "u",
      "underline",
      "text-decoration:underline",
      result
    );
  }
  if (format & TEXT_FORMAT.ITALIC) {
    result = formatWrapper(ctx, "em", "italic", "font-style:italic", result);
  }
  if (format & TEXT_FORMAT.BOLD) {
    result = formatWrapper(ctx, "strong", "bold", "font-weight:700", result);
  }
  if (format & TEXT_FORMAT.HIGHLIGHT) {
    // Class, not an inline style, for the same reason as the code format
    // above: a baked-in colour outranks the site's stylesheet, and this one
    // was a light yellow that a dark page could neither restyle nor read.
    // `mark` carries a highlight of its own even unstyled, so dropping the
    // colour leaves the meaning intact rather than the text bare.
    result = `<mark class="nextly-rich-text-highlight">${result}</mark>`;
  }

  return result;
}

function serializeTextNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const text = node.text || "";
  const format = node.format || 0;

  if (!text) {
    return "";
  }

  // The style span goes INSIDE the format wrappers, and the format is handed to
  // the sanitizer so a declaration the bit already decided is dropped rather
  // than left to win by being nested deeper. Both surfaces do this the same
  // way; the point of sharing the reader is that they cannot differ.
  let inner = escapeHtml(text);
  if (node.style && typeof node.style === "string" && node.style.trim()) {
    const safeStyle = sanitizeInlineStyle(node.style, format);
    if (safeStyle) {
      inner = `<span style="${escapeHtml(safeStyle)}">${inner}</span>`;
    }
  }

  // The same question the React renderer asks, from the same module: a wrapper
  // whose line the style already draws would add a second one, because a text
  // decoration propagates rather than being replaced.
  return applyTextFormat(
    inner,
    format & ~formatsDrawnByStyle(node.style, format),
    ctx
  );
}

function serializeLineBreakNode(): string {
  return "<br>";
}

type SerializeChildren = (children: LexicalSerializedNode[]) => string;

function serializeParagraphNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  const alignment = alignmentOf(node);

  // Nextly's look: a bottom margin, so paragraphs stay apart in a page whose
  // CSS resets them, and the alignment as `text-align`.
  const look = alignment
    ? `margin:0 0 1rem 0;text-align:${alignment}`
    : "margin:0 0 1rem 0";

  return `<p${classAttr(ctx, [named("paragraph")], alignClass(alignment))}${lookStyle(ctx, look)}>${content}</p>`;
}

// Nextly's look for each heading level, for a page whose CSS resets them.
const HEADING_LOOK: Record<string, string> = {
  h1: "font-size:2.25rem;font-weight:700;line-height:2.5rem;margin:1.5rem 0 1rem 0",
  h2: "font-size:1.875rem;font-weight:700;line-height:2.25rem;margin:1.25rem 0 0.875rem 0",
  h3: "font-size:1.5rem;font-weight:700;line-height:2rem;margin:1.25rem 0 0.875rem 0",
  h4: "font-size:1.25rem;font-weight:600;line-height:1.75rem;margin:1rem 0 0.75rem 0",
  h5: "font-size:1.125rem;font-weight:600;line-height:1.75rem;margin:1rem 0 0.75rem 0",
  h6: "font-size:1rem;font-weight:600;line-height:1.5rem;margin:0.875rem 0 0.625rem 0",
};

function serializeHeadingNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const tag = node.tag || "h1";
  const content = serializeChildren(node.children || []);
  const alignment = alignmentOf(node);

  const base = HEADING_LOOK[tag] || HEADING_LOOK.h1;
  const look = alignment ? `${base};text-align:${alignment}` : base;

  return `<${tag}${classAttr(ctx, [named(tag)], alignClass(alignment))}${lookStyle(ctx, look)}>${content}</${tag}>`;
}

function serializeQuoteNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  const look =
    "margin:1.5rem 0;padding:1rem 1.5rem;border-left:4px solid #e5e7eb;background-color:#f9fafb;font-style:italic;color:#4b5563";

  return `<blockquote${classAttr(ctx, [named("blockquote")])}${lookStyle(ctx, look)}>${content}</blockquote>`;
}

function serializeListNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const listType = node.listType || "bullet";
  const tag = listType === "number" ? "ol" : "ul";
  const content = serializeChildren(node.children || []);

  const startAttr =
    tag === "ol" && node.start && node.start !== 1
      ? ` start="${node.start}"`
      : "";

  // A checklist is a `ul` like a bullet list; class-only output names it, so
  // a site can drop the bullets its own list styles would draw.
  const look =
    listType === "check"
      ? "list-style:none;padding-left:0;margin:1rem 0"
      : `${tag === "ol" ? "list-style:decimal" : "list-style:disc"};margin:1rem 0;padding-left:2rem`;
  const classes = classAttr(
    ctx,
    [named("list"), named(tag)],
    listType === "check" ? [named("checklist")] : []
  );

  return `<${tag}${startAttr}${classes}${lookStyle(ctx, look)}>${content}</${tag}>`;
}

function serializeListItemNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);

  // A checklist item: its state as a class in class-only output, and a
  // disabled box the reader sees but cannot tick.
  if (node.checked === true || node.checked === false) {
    const checked = node.checked;
    const look = checked
      ? "list-style:none;text-decoration:line-through;opacity:0.7;margin-bottom:0.5rem"
      : "list-style:none;margin-bottom:0.5rem";
    const classes = classAttr(
      ctx,
      [named("list-item")],
      [named(checked ? "list-item--checked" : "list-item--unchecked")]
    );
    const box = `<input${classAttr(ctx, [], [named("checkbox")])} type="checkbox"${checked ? " checked" : ""} disabled${lookStyle(ctx, "margin-right:0.5em")}>`;
    return `<li${classes}${lookStyle(ctx, look)}>${box}${content}</li>`;
  }

  return `<li${classAttr(ctx, [named("list-item")])}${lookStyle(ctx, "margin-bottom:0.5rem")}>${content}</li>`;
}

function serializeLinkNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const rawUrl = node.url || "#";
  const url = isUrlSafe(rawUrl) ? rawUrl : "#";
  const content = serializeChildren(node.children || []);

  let attrs = `href="${escapeUrl(url)}"${lookStyle(ctx, "color:#3b82f6;text-decoration:underline")}`;
  if (node.target) {
    attrs += ` target="${escapeHtml(node.target)}"`;
  }
  if (node.rel) {
    attrs += ` rel="${escapeHtml(node.rel)}"`;
  }
  if (node.title) {
    attrs += ` title="${escapeHtml(node.title)}"`;
  }

  // Two spaces after `<a`, as the default output has always been spelled.
  return `<a ${classAttr(ctx, [named("link")])} ${attrs}>${content}</a>`;
}

function serializeCodeNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);
  const language = node.language
    ? ` data-language="${escapeHtml(node.language)}"`
    : "";

  // No inline colours: an inline style outranks the site's stylesheet, so
  // baking one here fixes every code block to one palette and leaves the site
  // no way to theme it — including in dark mode.
  const className = ' class="nextly-rich-text-code-block"';

  return `<pre${className}${language}><code>${content}</code></pre>`;
}

/**
 * A single syntax token.
 *
 * The tokenizer already worked out what this text is and stored it on the
 * node; emitting it as a class hands the site the same information, so it can
 * colour code with its own tokens instead of receiving colours it cannot
 * change. Text with no type is emitted bare rather than wrapped in an
 * element that would say nothing.
 */
function serializeCodeHighlightNode(node: LexicalSerializedNode): string {
  const text = escapeHtml(node.text || "");
  // The class comes from the engine, so this and the React renderer cannot
  // disagree about which class a token type gets — or about which types are
  // safe to write into a class attribute at all.
  const className = codeTokenClass(node.highlightType);
  if (className === undefined) return text;

  return `<span class="${className}">${text}</span>`;
}

function serializeHorizontalRuleNode(ctx: RenderContext): string {
  return `<hr${classAttr(ctx, [named("hr")])}${lookStyle(ctx, "border:0;border-top:2px solid #e5e7eb;margin:2rem 0")}>`;
}

/** A `figure` around media, with its caption when the author wrote one. */
function figure(
  ctx: RenderContext,
  inner: string,
  caption: string | undefined,
  looks: { figure?: string; caption?: string } = {}
): string {
  const figcaption = caption
    ? `<figcaption${classAttr(ctx, [], [named("caption")])}${looks.caption ? lookStyle(ctx, looks.caption) : ""}>${escapeHtml(caption)}</figcaption>`
    : "";
  return `<figure${classAttr(ctx, [], [named("figure")])}${looks.figure ? lookStyle(ctx, looks.figure) : ""}>${inner}${figcaption}</figure>`;
}

function serializeImageNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const src = node.src || "";
  if (!isUrlSafe(src)) return "";

  const alt = node.altText || "";

  let imgAttrs = `src="${escapeUrl(src)}" alt="${escapeHtml(alt)}"${lookStyle(ctx, "width:100%;height:auto;border-radius:0.375rem")}`;
  if (node.width) imgAttrs += ` width="${node.width}"`;
  if (node.height) imgAttrs += ` height="${node.height}"`;

  return figure(
    ctx,
    `<img${classAttr(ctx, [], [named("image")])} ${imgAttrs}>`,
    node.caption,
    {
      figure: "margin:1rem 0",
      caption:
        "margin-top:0.5rem;text-align:center;font-size:0.875rem;color:#666",
    }
  );
}

function serializeVideoNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const provider = node.provider || "unknown";
  const videoId = node.videoId || "";

  let embedUrl = "";
  if (provider === "youtube") {
    embedUrl = `https://www.youtube-nocookie.com/embed/${escapeHtml(videoId)}`;
  } else if (provider === "vimeo") {
    embedUrl = `https://player.vimeo.com/video/${escapeHtml(videoId)}`;
  }

  if (!embedUrl) return "";

  // Nextly's look holds the frame at 16:9; in class-only output the site's
  // stylesheet sizes `.nextly-rich-text-video` itself.
  let html = `<div${classAttr(ctx, [], [named("video")], ["video-embed"])}${lookStyle(ctx, "position:relative;padding-bottom:56.25%;height:0;overflow:hidden")}>`;
  html += `<iframe${classAttr(ctx, [], [named("video-frame")])} src="${embedUrl}"${lookStyle(ctx, "position:absolute;top:0;left:0;width:100%;height:100%")} frameborder="0" allowfullscreen loading="lazy"></iframe>`;
  html += `</div>`;

  return node.caption ? figure(ctx, html, node.caption) : html;
}

/** A button's colours as its author chose them, each refused unless safe CSS. */
interface ButtonColors {
  background: string | null;
  text: string | null;
}

function authoredButtonColors(
  bgColor?: string,
  textColor?: string
): ButtonColors {
  // Validated against CSS injection: the value lands inside a style attribute.
  return {
    background: bgColor ? sanitizeCssColor(bgColor) : null,
    text: textColor ? sanitizeCssColor(textColor) : null,
  };
}

/**
 * The colour declarations a button carries. The author's colours always; in
 * Nextly's look, a filled button with none chosen falls back to black on
 * white, which class-only output leaves to the site.
 */
function buttonColorDeclarations(
  variant: string,
  colors: ButtonColors,
  withFallbacks: boolean
): string[] {
  if (variant === "outline") {
    return colors.text
      ? [`color:${colors.text}`, `border-color:${colors.text}`]
      : [];
  }
  const background = colors.background || (withFallbacks ? "#000" : null);
  const text = colors.text || (withFallbacks ? "#fff" : null);
  return [
    ...(background ? [`background-color:${background}`] : []),
    ...(text ? [`color:${text}`] : []),
  ];
}

function getButtonInlineStyle(
  variant: string,
  size: string,
  colors: ButtonColors
): string {
  const styles: string[] = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "border-radius:0.375rem",
    "font-weight:500",
    "text-decoration:none",
    "transition:opacity 0.2s",
    "cursor:pointer",
  ];

  // Size styles
  if (size === "sm") {
    styles.push("padding:0.375rem 0.75rem", "font-size:0.875rem");
  } else if (size === "lg") {
    styles.push("padding:0.75rem 1.5rem", "font-size:1rem");
  } else {
    styles.push("padding:0.5rem 1rem", "font-size:0.875rem");
  }

  // Variant styles: an outline, or filled (also the legacy "primary" and
  // "secondary").
  if (variant === "outline") {
    styles.push("background:transparent", "border:1px solid");
  } else {
    styles.push("border:none");
  }
  styles.push(...buttonColorDeclarations(variant, colors, true));

  return styles.join(";");
}

interface ButtonSpec {
  url?: string;
  text?: string;
  target?: string;
  variant?: string;
  size?: string;
  bgColor?: string;
  textColor?: string;
}

/**
 * One button's anchor, for a lone button and for each in a group. Class-only
 * output names its variant and size, and keeps only the colours its author
 * chose.
 */
function serializeButtonAnchor(ctx: RenderContext, button: ButtonSpec): string {
  const rawUrl = button.url || "#";
  const url = isUrlSafe(rawUrl) ? rawUrl : "#";
  const variant = button.variant || "filled";
  const size = button.size || "md";
  const colors = authoredButtonColors(button.bgColor, button.textColor);

  let style: string;
  if (ctx.classOnly) {
    const authored = buttonColorDeclarations(variant, colors, false);
    style = authored.length > 0 ? ` style="${authored.join(";")}"` : "";
  } else {
    style = ` style="${getButtonInlineStyle(variant, size, colors)}"`;
  }

  const classes = classAttr(
    ctx,
    [],
    [
      named("button"),
      named(`button--${variant === "outline" ? "outline" : "filled"}`),
      named(`button--${size === "sm" || size === "lg" ? size : "md"}`),
    ]
  );

  let attrs = `href="${escapeUrl(url)}"${style}`;
  if (button.target) {
    attrs += ` target="${escapeHtml(button.target)}" rel="noopener noreferrer"`;
  }

  return `<a${classes} ${attrs}>${escapeHtml(button.text || "")}</a>`;
}

/** A button's alignment, which only left, right and centre can be. */
function buttonAlignment(alignment: string | undefined): Alignment {
  return alignment === "left"
    ? "left"
    : alignment === "right"
      ? "right"
      : "center";
}

function serializeButtonLinkNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const textAlign = buttonAlignment(node.alignment);
  const anchor = serializeButtonAnchor(ctx, {
    url: node.url,
    text: node.text,
    target: node.target,
    variant: node.variant,
    size: node.size,
    bgColor: node.bgColor,
    textColor: node.textColor,
  });

  return `<div${classAttr(ctx, [], [named("button-link"), ...alignClass(textAlign)])}${lookStyle(ctx, `text-align:${textAlign};margin:1rem 0`)}>${anchor}</div>`;
}

function serializeButtonGroupNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const buttons = node.buttons || [];
  if (buttons.length === 0) return "";

  const textAlign = buttonAlignment(node.alignment);
  const justifyContent =
    textAlign === "left"
      ? "flex-start"
      : textAlign === "right"
        ? "flex-end"
        : "center";

  let html = `<div${classAttr(ctx, [], [named("button-group"), ...alignClass(textAlign)])}${lookStyle(ctx, `text-align:${textAlign};margin:1rem 0;display:flex;justify-content:${justifyContent};gap:0.75rem;flex-wrap:wrap`)}>`;
  for (const button of buttons) {
    html += serializeButtonAnchor(ctx, button);
  }
  html += `</div>`;
  return html;
}

function serializeGalleryNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const rawImages = node.images || [];
  const safeImages = rawImages.filter(image => isUrlSafe(image.src));
  if (safeImages.length === 0) return "";

  const columns = node.columns || 3;

  let html = `<div${classAttr(ctx, [], [named("gallery"), named(`gallery--cols-${columns}`)], ["gallery", `gallery--cols-${columns}`])}${lookStyle(ctx, `display:grid;grid-template-columns:repeat(${columns},1fr);gap:0.5rem`)}>`;

  for (const image of safeImages) {
    let imgAttrs = `src="${escapeUrl(image.src)}" alt="${escapeHtml(image.alt)}"`;
    if (image.width) imgAttrs += ` width="${image.width}"`;
    if (image.height) imgAttrs += ` height="${image.height}"`;
    imgAttrs += lookStyle(
      ctx,
      "width:100%;height:auto;object-fit:cover;border-radius:0.375rem"
    );
    html += `<img${classAttr(ctx, [], [named("gallery-image")])} ${imgAttrs}>`;
  }

  html += `</div>`;

  return node.caption ? figure(ctx, html, node.caption) : html;
}

function serializeCollapsibleContainerNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const openAttr = node.open ? " open" : "";
  const content = serializeChildren(node.children || []);
  return `<details${classAttr(ctx, [], [named("collapsible")])}${openAttr}>${content}</details>`;
}

function serializeCollapsibleTitleNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  return `<summary${classAttr(ctx, [], [named("collapsible-title")])}>${content}</summary>`;
}

function serializeCollapsibleContentNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  return `<div${classAttr(ctx, [], [named("collapsible-content")], ["collapsible-content"])}>${content}</div>`;
}

function serializeTableNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  const look =
    "border-collapse:collapse;border:1px solid #d1d5db;width:100%;margin:1rem 0";

  return `<table${classAttr(ctx, [named("table")])}${lookStyle(ctx, look)}>${content}</table>`;
}

function serializeTableRowNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);

  return `<tr${classAttr(ctx, [named("table-row")])}${lookStyle(ctx, "border-bottom:1px solid #d1d5db")}>${content}</tr>`;
}

function serializeTableCellNode(
  node: LexicalSerializedNode,
  ctx: RenderContext,
  serializeChildren: SerializeChildren
): string {
  const content = serializeChildren(node.children || []);
  const headerState = node.headerState as number | undefined;
  const isHeader = headerState !== undefined && headerState > 0;
  const tag = isHeader ? "th" : "td";

  // Borders, padding and left alignment, and a header cell's weight and fill.
  const look = isHeader
    ? "border:1px solid #d1d5db;padding:0.5rem 0.75rem;text-align:left;font-weight:600;background-color:#f9fafb"
    : "border:1px solid #d1d5db;padding:0.5rem 0.75rem;text-align:left";

  return `<${tag}${classAttr(ctx, [named("table-cell")], isHeader ? [named("table-header-cell")] : [])}${lookStyle(ctx, look)}>${content}</${tag}>`;
}

// ============================================================
// Main Serializer
// ============================================================

function serializeNode(
  node: LexicalSerializedNode,
  ctx: RenderContext
): string {
  const serializeChildren = (children: LexicalSerializedNode[]): string => {
    return children.map(child => serializeNode(child, ctx)).join("");
  };

  switch (node.type) {
    case "root":
      return serializeChildren(node.children || []);

    case "text":
      return serializeTextNode(node, ctx);

    case "linebreak":
      return serializeLineBreakNode();

    case "paragraph":
      return serializeParagraphNode(node, ctx, serializeChildren);

    case "heading":
      return serializeHeadingNode(node, ctx, serializeChildren);

    case "quote":
      return serializeQuoteNode(node, ctx, serializeChildren);

    case "list":
      return serializeListNode(node, ctx, serializeChildren);

    case "listitem":
      return serializeListItemNode(node, ctx, serializeChildren);

    case "link":
    case "autolink":
      return serializeLinkNode(node, ctx, serializeChildren);

    case "code":
      return serializeCodeNode(node, serializeChildren);

    case "code-highlight":
      return serializeCodeHighlightNode(node);

    case "horizontalrule":
      return serializeHorizontalRuleNode(ctx);

    case "image":
      return serializeImageNode(node, ctx);

    case "video":
      return serializeVideoNode(node, ctx);

    case "button-link":
      return serializeButtonLinkNode(node, ctx);

    case "button-group":
      return serializeButtonGroupNode(node, ctx);

    case "gallery":
      return serializeGalleryNode(node, ctx);

    case "collapsible-container":
      return serializeCollapsibleContainerNode(node, ctx, serializeChildren);

    case "collapsible-title":
      return serializeCollapsibleTitleNode(node, ctx, serializeChildren);

    case "collapsible-content":
      return serializeCollapsibleContentNode(node, ctx, serializeChildren);

    case "table":
      return serializeTableNode(node, ctx, serializeChildren);

    case "tablerow":
      return serializeTableRowNode(node, ctx, serializeChildren);

    case "tablecell":
      return serializeTableCellNode(node, ctx, serializeChildren);

    default:
      // For unknown nodes, try to serialize children if they exist
      if (node.children && node.children.length > 0) {
        return serializeChildren(node.children);
      }
      // For unknown leaf nodes with text, return escaped text
      if (node.text) {
        return escapeHtml(node.text);
      }
      return "";
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Rich text as HTML.
 *
 * @param value - the stored Lexical document
 * @param options - `styles: "none"` for HTML a site styles with its own CSS:
 *   classes only, and no style Nextly adds (`RichTextStyles`)
 * @returns the HTML, or `null` for a value with no document to read
 */
export function convertRichTextToHtml(
  value: RichTextValue | null | undefined,
  options: RichTextHtmlOptions = {}
): string | null {
  if (!value || !value.root) {
    return null;
  }

  try {
    return serializeNode(value.root, { classOnly: options.styles === "none" });
  } catch (error) {
    consoleLogger.error(
      "[RichTextHtmlConverter] Failed to convert rich text to HTML",
      { error: error }
    );
    return null;
  }
}

/**
 * Rich text in the format a read asked for. The style option applies only
 * where HTML is returned (`"html"` and `"both"`); JSON is the stored document.
 */
export function formatRichTextOutput(
  value: RichTextValue | null | undefined,
  format: RichTextOutputFormat = "json",
  options: RichTextHtmlOptions = {}
): RichTextValue | string | RichTextBothFormat | null {
  if (!value || !value.root) {
    return null;
  }

  switch (format) {
    case "json":
      return value;

    case "html":
      return convertRichTextToHtml(value, options);

    case "both":
      return {
        json: value,
        html: convertRichTextToHtml(value, options) || "",
      };

    default:
      return value;
  }
}

// Re-exported so this module's existing callers keep one import site, while the
// answer itself comes from the engine. The local copy this replaces did not
// require `root.children` to be an array, so it accepted a root this file's own
// walker could only render as empty — the two disagreed about what rich text is,
// which is the drift a shared definition exists to prevent.
export { isRichTextValue };
