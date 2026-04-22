/**
 * Extract a Table of Contents from HTML rich-text content.
 *
 * Walks the HTML string produced by Nextly's Lexical-to-HTML serializer,
 * finds every `<h2>` and `<h3>`, slugifies the heading text, and both:
 * 1. Injects an `id="<slug>"` attribute on the heading tag (so anchor
 *    links from the TOC scroll to the right place), and
 * 2. Returns a flat list of TOC entries the component can render.
 *
 * Uses a narrow regex rather than a full HTML parser: the input is
 * server-generated Lexical HTML, so it follows a predictable shape
 * (`<h2>Text</h2>` with at most basic formatting inside). Adding a
 * full DOM parser (jsdom / parse5) would be overkill here.
 *
 * Duplicate heading text gets disambiguated with a numeric suffix
 * (`notes`, `notes-2`, `notes-3`).
 */

export interface TocEntry {
  /** Heading level: 2 or 3. */
  level: 2 | 3;
  /** Stable anchor id. Safe for URL fragments. */
  id: string;
  /** Plain-text heading content. */
  text: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "") // strip any inline tags (em, strong, code)
    .replace(/&[^;]+;/g, "") // strip entities
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractToc(html: string): { html: string; toc: TocEntry[] } {
  if (!html) return { html: "", toc: [] };

  const toc: TocEntry[] = [];
  const used = new Map<string, number>();

  const out = html.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (match, levelStr: string, attrs: string, inner: string) => {
      const level = Number(levelStr) as 2 | 3;
      const text = inner.replace(/<[^>]+>/g, "").trim();
      if (!text) return match;

      const base = slugify(text) || "section";
      const seen = used.get(base) ?? 0;
      const id = seen === 0 ? base : `${base}-${seen + 1}`;
      used.set(base, seen + 1);

      toc.push({ level, id, text });

      // If the heading already has an id attribute, leave it alone;
      // otherwise inject ours. Regex is intentionally lax - Lexical's
      // output doesn't interleave quotes inside attribute values.
      if (/\bid\s*=\s*["']/.test(attrs)) return match;
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );

  return { html: out, toc };
}
