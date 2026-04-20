/**
 * Rich Text HTML Conversion Utilities
 *
 * Provides server-side conversion of Lexical Rich Text JSON to HTML.
 * Uses a custom serializer that doesn't require DOM/JSDOM for server-side rendering.
 *
 * @module lib/rich-text-html
 * @since 1.0.0
 */

import type { RichTextValue } from "../../collections/fields/types/rich-text";
import {
  sanitizeCssColor,
  sanitizeInlineStyle,
} from "../../services/security/css-validator";

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

const TEXT_FORMAT = {
  BOLD: 1,
  ITALIC: 2,
  STRIKETHROUGH: 4,
  UNDERLINE: 8,
  CODE: 16,
  SUBSCRIPT: 32,
  SUPERSCRIPT: 64,
  HIGHLIGHT: 128,
} as const;

// ============================================================
// Element Format (Alignment) mapping
// ============================================================

// Lexical uses both numeric and string formats for alignment
const ELEMENT_FORMAT_TO_STYLE: Record<number, string> = {
  1: "text-align:left",
  2: "text-align:center",
  3: "text-align:right",
  4: "text-align:justify",
  5: "text-align:start",
  6: "text-align:end",
};

// String-based format mapping (used by newer Lexical versions)
const STRING_FORMAT_TO_STYLE: Record<string, string> = {
  left: "text-align:left",
  center: "text-align:center",
  right: "text-align:right",
  justify: "text-align:justify",
  start: "text-align:start",
  end: "text-align:end",
};

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

function applyTextFormat(text: string, format: number): string {
  let result = escapeHtml(text);

  if (format & TEXT_FORMAT.CODE) {
    result = `<code style="background-color:#f3f4f6;padding:0.125rem 0.25rem;border-radius:0.25rem;font-family:ui-monospace,monospace;font-size:0.875em">${result}</code>`;
  }
  if (format & TEXT_FORMAT.SUBSCRIPT) {
    result = `<sub style="font-size:0.75em;vertical-align:sub">${result}</sub>`;
  }
  if (format & TEXT_FORMAT.SUPERSCRIPT) {
    result = `<sup style="font-size:0.75em;vertical-align:super">${result}</sup>`;
  }
  if (format & TEXT_FORMAT.STRIKETHROUGH) {
    result = `<s style="text-decoration:line-through">${result}</s>`;
  }
  if (format & TEXT_FORMAT.UNDERLINE) {
    result = `<u style="text-decoration:underline">${result}</u>`;
  }
  if (format & TEXT_FORMAT.ITALIC) {
    result = `<em style="font-style:italic">${result}</em>`;
  }
  if (format & TEXT_FORMAT.BOLD) {
    result = `<strong style="font-weight:700">${result}</strong>`;
  }
  if (format & TEXT_FORMAT.HIGHLIGHT) {
    result = `<mark style="background-color:#fef08a;padding:0.125rem 0.25rem">${result}</mark>`;
  }

  return result;
}

function serializeTextNode(node: LexicalSerializedNode): string {
  const text = node.text || "";
  const format = node.format || 0;

  if (!text) {
    return "";
  }

  let result = applyTextFormat(text, format);

  // Validate and sanitize inline styles before rendering (CSS injection prevention)
  if (node.style && typeof node.style === "string" && node.style.trim()) {
    const safeStyle = sanitizeInlineStyle(node.style);
    if (safeStyle) {
      result = `<span style="${escapeHtml(safeStyle)}">${result}</span>`;
    }
  }

  return result;
}

function serializeLineBreakNode(): string {
  return "<br>";
}

function serializeParagraphNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);

  // Add class and inline styles to ensure proper rendering in Tailwind environments
  const className = ' class="nextly-rich-text-paragraph"';

  // Build style with margin and alignment
  const baseStyles = "margin:0 0 1rem 0";

  // Get alignment style - check both string format (new) and numeric format (old)
  let alignmentStyle: string | undefined;

  if (typeof node.format === "string" && node.format !== "") {
    // String-based format (e.g., "center", "right")
    alignmentStyle = STRING_FORMAT_TO_STYLE[node.format];
  } else if (typeof node.format === "number" && node.format > 0) {
    // Numeric format (legacy)
    alignmentStyle = ELEMENT_FORMAT_TO_STYLE[node.format];
  }

  const style = alignmentStyle
    ? ` style="${baseStyles};${alignmentStyle}"`
    : ` style="${baseStyles}"`;

  return `<p${className}${style}>${content}</p>`;
}

function serializeHeadingNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const tag = node.tag || "h1";
  const content = serializeChildren(children);

  // Define styles for each heading level to work in Tailwind-reset environments
  const headingStyles: Record<string, string> = {
    h1: "font-size:2.25rem;font-weight:700;line-height:2.5rem;margin:1.5rem 0 1rem 0",
    h2: "font-size:1.875rem;font-weight:700;line-height:2.25rem;margin:1.25rem 0 0.875rem 0",
    h3: "font-size:1.5rem;font-weight:700;line-height:2rem;margin:1.25rem 0 0.875rem 0",
    h4: "font-size:1.25rem;font-weight:600;line-height:1.75rem;margin:1rem 0 0.75rem 0",
    h5: "font-size:1.125rem;font-weight:600;line-height:1.75rem;margin:1rem 0 0.75rem 0",
    h6: "font-size:1rem;font-weight:600;line-height:1.5rem;margin:0.875rem 0 0.625rem 0",
  };

  const baseStyle = headingStyles[tag] || headingStyles.h1;
  const className = ` class="nextly-rich-text-${tag}"`;

  // Get alignment style - check both string format (new) and numeric format (old)
  let alignmentStyle: string | undefined;

  if (typeof node.format === "string" && node.format !== "") {
    // String-based format (e.g., "center", "right")
    alignmentStyle = STRING_FORMAT_TO_STYLE[node.format];
  } else if (typeof node.format === "number" && node.format > 0) {
    // Numeric format (legacy)
    alignmentStyle = ELEMENT_FORMAT_TO_STYLE[node.format];
  }

  // Merge alignment with base heading styles
  const style = alignmentStyle
    ? ` style="${baseStyle};${alignmentStyle}"`
    : ` style="${baseStyle}"`;

  return `<${tag}${className}${style}>${content}</${tag}>`;
}

function serializeQuoteNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);

  // Add styles for blockquote to work in Tailwind-reset environments
  const className = ' class="nextly-rich-text-blockquote"';
  const style =
    ' style="margin:1.5rem 0;padding:1rem 1.5rem;border-left:4px solid #e5e7eb;background-color:#f9fafb;font-style:italic;color:#4b5563"';

  return `<blockquote${className}${style}>${content}</blockquote>`;
}

function serializeListNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const listType = node.listType || "bullet";
  const tag = listType === "number" ? "ol" : "ul";
  const content = serializeChildren(children);

  const startAttr =
    tag === "ol" && node.start && node.start !== 1
      ? ` start="${node.start}"`
      : "";

  const className = ` class="nextly-rich-text-list nextly-rich-text-${tag}"`;

  let style = "";
  if (listType === "check") {
    style = ` style="list-style:none;padding-left:0;margin:1rem 0"`;
  } else {
    // Add proper list styling for Tailwind-reset environments
    const listStyle = tag === "ol" ? "list-style:decimal" : "list-style:disc";
    style = ` style="${listStyle};margin:1rem 0;padding-left:2rem"`;
  }

  return `<${tag}${startAttr}${className}${style}>${content}</${tag}>`;
}

function serializeListItemNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);

  const className = ' class="nextly-rich-text-list-item"';

  // Handle checklist items
  if (node.checked === true) {
    return `<li${className} style="list-style:none;text-decoration:line-through;opacity:0.7;margin-bottom:0.5rem"><input type="checkbox" checked disabled style="margin-right:0.5em">${content}</li>`;
  }
  if (node.checked === false) {
    return `<li${className} style="list-style:none;margin-bottom:0.5rem"><input type="checkbox" disabled style="margin-right:0.5em">${content}</li>`;
  }

  // Regular list item with margin
  return `<li${className} style="margin-bottom:0.5rem">${content}</li>`;
}

function serializeLinkNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const rawUrl = node.url || "#";
  const url = isUrlSafe(rawUrl) ? rawUrl : "#";
  const content = serializeChildren(children);

  const className = ' class="nextly-rich-text-link"';
  let attrs = `href="${escapeUrl(url)}" style="color:#3b82f6;text-decoration:underline"`;

  if (node.target) {
    attrs += ` target="${escapeHtml(node.target)}"`;
  }
  if (node.rel) {
    attrs += ` rel="${escapeHtml(node.rel)}"`;
  }
  if (node.title) {
    attrs += ` title="${escapeHtml(node.title)}"`;
  }

  return `<a ${className} ${attrs}>${content}</a>`;
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

  const className = ' class="nextly-rich-text-code-block"';
  const preStyle =
    ' style="background-color:#1f2937;color:#f9fafb;padding:1rem;border-radius:0.5rem;overflow-x:auto;margin:1rem 0"';
  const codeStyle =
    ' style="font-family:ui-monospace,monospace;font-size:0.875rem;line-height:1.5"';

  return `<pre${className}${language}${preStyle}><code${codeStyle}>${content}</code></pre>`;
}

function serializeCodeHighlightNode(node: LexicalSerializedNode): string {
  const text = node.text || "";
  return escapeHtml(text);
}

function serializeHorizontalRuleNode(): string {
  return '<hr class="nextly-rich-text-hr" style="border:0;border-top:2px solid #e5e7eb;margin:2rem 0">';
}

function serializeImageNode(node: LexicalSerializedNode): string {
  const src = node.src || "";
  if (!isUrlSafe(src)) return "";

  const alt = node.altText || "";
  const caption = node.caption;

  let imgAttrs = `src="${escapeUrl(src)}" alt="${escapeHtml(alt)}" style="width:100%;height:auto;border-radius:0.375rem"`;
  if (node.width) imgAttrs += ` width="${node.width}"`;
  if (node.height) imgAttrs += ` height="${node.height}"`;

  if (caption) {
    return `<figure style="margin:1rem 0"><img ${imgAttrs}><figcaption style="margin-top:0.5rem;text-align:center;font-size:0.875rem;color:#666">${escapeHtml(caption)}</figcaption></figure>`;
  }

  return `<figure style="margin:1rem 0"><img ${imgAttrs}></figure>`;
}

function serializeVideoNode(node: LexicalSerializedNode): string {
  const provider = node.provider || "unknown";
  const videoId = node.videoId || "";
  const caption = node.caption;

  let embedUrl = "";
  if (provider === "youtube") {
    embedUrl = `https://www.youtube-nocookie.com/embed/${escapeHtml(videoId)}`;
  } else if (provider === "vimeo") {
    embedUrl = `https://player.vimeo.com/video/${escapeHtml(videoId)}`;
  }

  if (!embedUrl) return "";

  let html = `<div class="video-embed" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">`;
  html += `<iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%" frameborder="0" allowfullscreen loading="lazy"></iframe>`;
  html += `</div>`;

  if (caption) {
    html = `<figure>${html}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  }

  return html;
}

function getButtonInlineStyle(
  variant: string,
  size: string,
  bgColor?: string,
  textColor?: string
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

  // Validate color values against CSS injection
  const safeBg = bgColor ? sanitizeCssColor(bgColor) : null;
  const safeText = textColor ? sanitizeCssColor(textColor) : null;

  // Variant styles
  if (variant === "outline") {
    styles.push("background:transparent", "border:1px solid");
    if (safeText) {
      styles.push(`color:${safeText}`, `border-color:${safeText}`);
    }
  } else {
    // filled (also handles legacy "primary"/"secondary")
    styles.push("border:none");
    styles.push(`background-color:${safeBg || "#000"}`);
    styles.push(`color:${safeText || "#fff"}`);
  }

  return styles.join(";");
}

function serializeButtonLinkNode(node: LexicalSerializedNode): string {
  const rawUrl = node.url || "#";
  const url = isUrlSafe(rawUrl) ? rawUrl : "#";
  const text = (node.text as string) || "";
  const target = node.target;
  const variant = node.variant || "filled";
  const size = node.size || "md";
  const bgColor = node.bgColor as string | undefined;
  const textColor = node.textColor as string | undefined;
  const alignment = node.alignment || "center";

  // Map alignment to CSS text-align values
  const textAlign =
    alignment === "left" ? "left" : alignment === "right" ? "right" : "center";

  const style = getButtonInlineStyle(variant, size, bgColor, textColor);
  let attrs = `href="${escapeUrl(url)}" style="${style}"`;
  if (target) {
    attrs += ` target="${escapeHtml(target)}" rel="noopener noreferrer"`;
  }

  return `<div style="text-align:${textAlign};margin:1rem 0"><a ${attrs}>${escapeHtml(text)}</a></div>`;
}

function serializeButtonGroupNode(node: LexicalSerializedNode): string {
  const buttons = node.buttons || [];
  if (buttons.length === 0) return "";

  const alignment = node.alignment || "center";

  // Map alignment to CSS values
  const textAlign =
    alignment === "left" ? "left" : alignment === "right" ? "right" : "center";
  const justifyContent =
    alignment === "left"
      ? "flex-start"
      : alignment === "right"
        ? "flex-end"
        : "center";

  let html = `<div style="text-align:${textAlign};margin:1rem 0;display:flex;justify-content:${justifyContent};gap:0.75rem;flex-wrap:wrap">`;

  for (const button of buttons) {
    const rawUrl = button.url || "#";
    const url = isUrlSafe(rawUrl) ? rawUrl : "#";
    const text = button.text || "";
    const variant = button.variant || "filled";
    const size = button.size || "md";
    const style = getButtonInlineStyle(
      variant,
      size,
      button.bgColor,
      button.textColor
    );

    let attrs = `href="${escapeUrl(url)}" style="${style}"`;
    if (button.target) {
      attrs += ` target="${escapeHtml(button.target)}" rel="noopener noreferrer"`;
    }

    html += `<a ${attrs}>${escapeHtml(text)}</a>`;
  }

  html += `</div>`;
  return html;
}

function serializeGalleryNode(node: LexicalSerializedNode): string {
  const rawImages = node.images || [];
  const safeImages = rawImages.filter(image => isUrlSafe(image.src));
  if (safeImages.length === 0) return "";

  const columns = node.columns || 3;
  const caption = node.caption;

  let html = `<div class="gallery gallery--cols-${columns}" style="display:grid;grid-template-columns:repeat(${columns},1fr);gap:0.5rem">`;

  for (const image of safeImages) {
    let imgAttrs = `src="${escapeUrl(image.src)}" alt="${escapeHtml(image.alt)}"`;
    if (image.width) imgAttrs += ` width="${image.width}"`;
    if (image.height) imgAttrs += ` height="${image.height}"`;
    imgAttrs += ` style="width:100%;height:auto;object-fit:cover;border-radius:0.375rem"`;
    html += `<img ${imgAttrs}>`;
  }

  html += `</div>`;

  if (caption) {
    html = `<figure>${html}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  }

  return html;
}

function serializeCollapsibleContainerNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const openAttr = node.open ? " open" : "";
  const content = serializeChildren(children);
  return `<details${openAttr}>${content}</details>`;
}

function serializeCollapsibleTitleNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);
  return `<summary>${content}</summary>`;
}

function serializeCollapsibleContentNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);
  return `<div class="collapsible-content">${content}</div>`;
}

function serializeTableNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);

  // Inline styles for table: borders, spacing, collapse
  const tableStyles = [
    "border-collapse:collapse",
    "border:1px solid #d1d5db",
    "width:100%",
    "margin:1rem 0",
  ].join(";");

  return `<table class="nextly-rich-text-table" style="${tableStyles}">${content}</table>`;
}

function serializeTableRowNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);

  // Inline styles for table row
  const rowStyles = "border-bottom:1px solid #d1d5db";

  return `<tr class="nextly-rich-text-table-row" style="${rowStyles}">${content}</tr>`;
}

function serializeTableCellNode(
  node: LexicalSerializedNode,
  serializeChildren: (children: LexicalSerializedNode[]) => string
): string {
  const children = node.children || [];
  const content = serializeChildren(children);
  const headerState = node.headerState as number | undefined;
  const tag = headerState && headerState > 0 ? "th" : "td";

  // Inline styles for table cells: borders, padding, alignment
  const cellStyles = [
    "border:1px solid #d1d5db",
    "padding:0.5rem 0.75rem",
    "text-align:left",
  ];

  // Add header-specific styles
  if (headerState && headerState > 0) {
    cellStyles.push("font-weight:600");
    cellStyles.push("background-color:#f9fafb");
  }

  const styleAttr = cellStyles.join(";");

  return `<${tag} class="nextly-rich-text-table-cell" style="${styleAttr}">${content}</${tag}>`;
}

// ============================================================
// Main Serializer
// ============================================================

function serializeNode(node: LexicalSerializedNode): string {
  const serializeChildren = (children: LexicalSerializedNode[]): string => {
    return children.map(child => serializeNode(child)).join("");
  };

  switch (node.type) {
    case "root":
      return serializeChildren(node.children || []);

    case "text":
      return serializeTextNode(node);

    case "linebreak":
      return serializeLineBreakNode();

    case "paragraph":
      return serializeParagraphNode(node, serializeChildren);

    case "heading":
      return serializeHeadingNode(node, serializeChildren);

    case "quote":
      return serializeQuoteNode(node, serializeChildren);

    case "list":
      return serializeListNode(node, serializeChildren);

    case "listitem":
      return serializeListItemNode(node, serializeChildren);

    case "link":
    case "autolink":
      return serializeLinkNode(node, serializeChildren);

    case "code":
      return serializeCodeNode(node, serializeChildren);

    case "code-highlight":
      return serializeCodeHighlightNode(node);

    case "horizontalrule":
      return serializeHorizontalRuleNode();

    case "image":
      return serializeImageNode(node);

    case "video":
      return serializeVideoNode(node);

    case "button-link":
      return serializeButtonLinkNode(node);

    case "button-group":
      return serializeButtonGroupNode(node);

    case "gallery":
      return serializeGalleryNode(node);

    case "collapsible-container":
      return serializeCollapsibleContainerNode(node, serializeChildren);

    case "collapsible-title":
      return serializeCollapsibleTitleNode(node, serializeChildren);

    case "collapsible-content":
      return serializeCollapsibleContentNode(node, serializeChildren);

    case "table":
      return serializeTableNode(node, serializeChildren);

    case "tablerow":
      return serializeTableRowNode(node, serializeChildren);

    case "tablecell":
      return serializeTableCellNode(node, serializeChildren);

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

export function convertRichTextToHtml(
  value: RichTextValue | null | undefined
): string | null {
  if (!value || !value.root) {
    return null;
  }

  try {
    return serializeNode(value.root as LexicalSerializedNode);
  } catch (error) {
    console.error(
      "[RichTextHtmlConverter] Failed to convert rich text to HTML:",
      error
    );
    return null;
  }
}

export function formatRichTextOutput(
  value: RichTextValue | null | undefined,
  format: RichTextOutputFormat = "json"
): RichTextValue | string | RichTextBothFormat | null {
  if (!value || !value.root) {
    return null;
  }

  switch (format) {
    case "json":
      return value;

    case "html":
      return convertRichTextToHtml(value);

    case "both":
      return {
        json: value,
        html: convertRichTextToHtml(value) || "",
      };

    default:
      return value;
  }
}

export function isRichTextValue(value: unknown): value is RichTextValue {
  if (!value || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    "root" in obj &&
    typeof obj.root === "object" &&
    obj.root !== null &&
    "type" in (obj.root as Record<string, unknown>) &&
    (obj.root as Record<string, unknown>).type === "root"
  );
}
