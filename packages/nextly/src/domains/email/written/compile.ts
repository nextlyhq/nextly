/**
 * A written email's blocks, written out as Liquid.
 *
 * Every written email renders through this Liquid and the same render path a
 * coded one takes, inside its layout and with the brand settings, so a
 * preview, a test send and a real send cannot differ. It is also exactly the
 * code a written email becomes when it is converted, so the converted email
 * renders as it did for every recipient's own data.
 *
 * Values are written safely for where they sit. The editor's own text is
 * escaped, and every `{` in it is written as a Liquid string, so nothing an
 * editor types is ever read as a tag or a variable. A chip is escaped as text
 * in HTML. In a link or an image address it is checked, so only http, https
 * and (for a link) mailto addresses survive. In plain text it is written as
 * it is. Look comes from the brand settings (`nextly_brand`), never from the
 * blocks.
 *
 * @module domains/email/written/compile
 */

import { escapeHtml } from "../services/template-engine";

import {
  COMPILER_NAMES,
  LIST_ITEM,
  WRITTEN_LINK_CLASS,
  type Chip,
  type Condition,
  type ContentBlock,
  type Inline,
  type PlainInline,
  type WrittenBlock,
  type WrittenDocument,
  type WrittenLink,
} from "./document";

/** Where compiled text is written: an HTML body, or the plain-text body. */
type Target = "html" | "text";

/** A `{` written so Liquid reads it as text, never as the start of a tag. */
const BRACE = "{{ '{' }}";

/** The editor's own text, escaped for HTML where it is HTML. */
function literal(text: string, target: Target): string {
  const safe =
    target === "html" ? escapeHtml(text).replace(/\n/g, "<br>") : text;
  return safe.replace(/\{/g, BRACE);
}

/** A fixed address, escaped as an attribute. */
function attribute(text: string): string {
  return escapeHtml(text).replace(/\{/g, BRACE);
}

/**
 * A chip's value, or its fallback when the value is absent, null or an empty
 * string. False and 0 are values, and are written as themselves.
 */
function chip(c: Chip, target: Target, filter = ""): string {
  const value = `{{ ${c.variable}${filter} }}`;
  if (c.fallback === undefined || c.fallback === "") return value;
  // A fallback address is an attribute in HTML, and the address as it is in
  // plain text.
  const fallback =
    filter && target === "html"
      ? attribute(c.fallback)
      : literal(c.fallback, target);
  return `{% if ${c.variable} == nil or ${c.variable} == "" %}${fallback}{% else %}${value}{% endif %}`;
}

/** Where a link points, checked and escaped. */
function href(link: WrittenLink, kind: "link" | "image" = "link"): string {
  if ("url" in link) return attribute(link.url);
  return chip(
    link.chip,
    "html",
    kind === "image" ? " | safe_url: 'image'" : " | safe_url"
  );
}

/** Text with chips, as plain text or escaped HTML. */
function plain(parts: ReadonlyArray<PlainInline>, target: Target): string {
  return parts
    .map(part =>
      part.type === "text" ? literal(part.text, target) : chip(part, target)
    )
    .join("");
}

/** Rich text: plain text with bold, italic and links. */
function rich(parts: ReadonlyArray<Inline>, target: Target): string {
  return parts
    .map(part => {
      let out =
        part.type === "text" ? literal(part.text, target) : chip(part, target);
      if (target === "html") {
        if (part.bold) out = `<strong>${out}</strong>`;
        if (part.italic) out = `<em>${out}</em>`;
        if (part.link) {
          // The class is what keeps the link readable on the default
          // layout's dark card (`brand-settings` darkModeRules).
          out = `<a class="${WRITTEN_LINK_CLASS}" href="${href(part.link)}" style="color: {{ nextly_brand.accentColor }}; text-decoration: underline;">${out}</a>`;
        }
      } else if (part.link) {
        out = `${out} (${textHref(part.link)})`;
      }
      return out;
    })
    .join("");
}

/** A link's address in the plain-text body, checked but not escaped. */
function textHref(link: WrittenLink): string {
  if ("url" in link) return literal(link.url, "text");
  return chip(link.chip, "text", " | safe_url");
}

/** A block shown only on its condition. */
function shown(condition: Condition | undefined, body: string): string {
  if (!condition) return body;
  const v = condition.variable;
  const test =
    condition.when === "present"
      ? `{% assign ${COMPILER_NAMES.shown} = ${v} | has_value %}{% if ${COMPILER_NAMES.shown} %}`
      : condition.when === "yes"
        ? `{% if ${v} == true %}`
        : `{% if ${v} == false %}`;
  return `${test}${body}{% endif %}`;
}

const TEXT_STYLE =
  "margin: 0; padding: 0 0 16px; font-size: 16px; color: #3f3f46; line-height: 24px;";
const HEADING_STYLE =
  "margin: 0; padding: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 32px;";

/** A content block in the email-safe markup core's built-ins use. */
function htmlBlock(block: ContentBlock): string {
  switch (block.type) {
    case "heading":
      return `<h1 style="${HEADING_STYLE}">${plain(block.text, "html")}</h1>\n`;
    case "text":
      return `<p style="${TEXT_STYLE}">${rich(block.text, "html")}</p>\n`;
    case "button": {
      const url = href(block.link);
      const label = plain(block.label, "html");
      return (
        `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">\n` +
        `  <tr>\n` +
        `    <td align="center" style="padding: 0 0 24px;">\n` +
        `      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fillcolor="{{ nextly_brand.accentColor }}" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">${label}</center></v:textbox></v:roundrect><![endif]-->\n` +
        `      <!--[if !mso]><!--><a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: {{ nextly_brand.accentColor }}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; font-family: {{ nextly_brand.fontFamily }}; line-height: 20px;">${label}</a><!--<![endif]-->\n` +
        `    </td>\n` +
        `  </tr>\n` +
        `</table>\n`
      );
    }
    case "image": {
      const width = block.width ?? 536;
      return `<img src="${href(block.src, "image")}" alt="${plain(block.alt, "html")}" width="${width}" style="display: block; width: 100%; max-width: ${width}px; height: auto; border: 0; margin: 0 0 16px;">\n`;
    }
    case "divider":
      return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="margin: 0 0 16px;"><tr><td style="border-top: 1px solid #e4e4e7; font-size: 0; line-height: 0;">&nbsp;</td></tr></table>\n`;
    case "spacer": {
      const height = block.height ?? 24;
      return `<div style="height: ${height}px; line-height: ${height}px; font-size: 0;">&nbsp;</div>\n`;
    }
  }
}

/** A content block as readable plain text: link text followed by the link. */
function textBlock(block: ContentBlock): string {
  switch (block.type) {
    case "heading":
      return `${plain(block.text, "text")}\n\n`;
    case "text":
      return `${rich(block.text, "text")}\n\n`;
    case "button":
      return `${plain(block.label, "text")} (${textHref(block.link)})\n\n`;
    case "image": {
      const alt = plain(block.alt, "text");
      return alt ? `${alt}\n\n` : "";
    }
    case "divider":
      return "----------\n\n";
    case "spacer":
      return "";
  }
}

function compileBlock(block: WrittenBlock, target: Target): string {
  if (block.type !== "list") {
    return shown(
      block.show,
      target === "html" ? htmlBlock(block) : textBlock(block)
    );
  }
  const body = block.blocks.map(inner => compileBlock(inner, target)).join("");
  return shown(
    block.show,
    `{% assign ${COMPILER_NAMES.items} = ${block.variable} | as_list %}{% for ${LIST_ITEM} in ${COMPILER_NAMES.items} %}${body}{% endfor %}`
  );
}

/** A written email's body as Liquid, for the HTML part. */
export function compileWrittenHtml(document: WrittenDocument): string {
  return document.blocks.map(block => compileBlock(block, "html")).join("");
}

/** A written email's body as Liquid, for the plain-text part. */
export function compileWrittenText(document: WrittenDocument): string {
  return document.blocks.map(block => compileBlock(block, "text")).join("");
}
