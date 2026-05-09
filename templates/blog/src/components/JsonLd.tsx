/**
 * JsonLd — renders one or more schema.org graphs as
 * `<script type="application/ld+json">`. Server-rendered, zero client
 * cost. Google uses this for rich results (Article carousels,
 * breadcrumbs, author cards, sitelinks search).
 *
 * The stringified JSON is emitted via `dangerouslySetInnerHTML` — safe
 * here because `data` is always built server-side from trusted sources
 * (our own schema, not user input).
 */

interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Escape `<` so a literal `</script>` sequence inside any string field
 * can't terminate our script tag early. This is the idiomatic pattern
 * for emitting JSON inside a `<script>` block.
 */
function safeStringify(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeStringify(data) }}
    />
  );
}
