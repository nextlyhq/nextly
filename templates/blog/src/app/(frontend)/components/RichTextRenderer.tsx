/**
 * RichTextRenderer - renders HTML content from Nextly's rich text field.
 *
 * When fetching with `richTextFormat: 'html'`, Nextly converts Lexical
 * JSON to HTML server-side. This component renders that HTML through
 * the `.prose-blog` CSS rules in `globals.css` (or any caller-supplied
 * class), so the typography matches the design-token system and the
 * light/dark theme.
 *
 * SECURITY: This uses dangerouslySetInnerHTML. The HTML here comes
 * from Nextly's server-side Lexical-to-HTML serializer, which is a
 * trusted source. If you modify this to accept HTML from external or
 * user-facing sources (public APIs, form inputs, third-party CMS),
 * add HTML sanitization (e.g., DOMPurify or sanitize-html) to prevent
 * XSS attacks.
 */

interface RichTextRendererProps {
  /** HTML string from Nextly's richTextFormat: 'html' */
  html: string;
  /** Additional className appended after the default `prose-blog`. */
  className?: string;
}

export function RichTextRenderer({
  html,
  className = "",
}: RichTextRendererProps) {
  return (
    <div
      className={`prose-blog max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
