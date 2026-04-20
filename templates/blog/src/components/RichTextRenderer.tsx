/**
 * RichTextRenderer - renders HTML content from Nextly's rich text field.
 *
 * When fetching with `richTextFormat: 'html'`, Nextly converts Lexical
 * JSON to HTML server-side. This component renders that HTML with
 * proper typography styles via Tailwind's prose classes.
 *
 * SECURITY: This uses dangerouslySetInnerHTML. The HTML here comes from
 * Nextly's server-side Lexical-to-HTML serializer, which is a trusted source.
 * If you modify this to accept HTML from external or user-facing sources
 * (public APIs, form inputs, third-party CMS), add HTML sanitization
 * (e.g., DOMPurify or sanitize-html) to prevent XSS attacks.
 */

interface RichTextRendererProps {
  /** HTML string from Nextly's richTextFormat: 'html' */
  html: string;
  className?: string;
}

export function RichTextRenderer({
  html,
  className = "",
}: RichTextRendererProps) {
  return (
    <div
      className={`prose prose-neutral max-w-none dark:prose-invert prose-headings:tracking-tight prose-a:text-neutral-900 prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-neutral-600 dark:prose-a:text-neutral-100 dark:hover:prose-a:text-neutral-300 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
