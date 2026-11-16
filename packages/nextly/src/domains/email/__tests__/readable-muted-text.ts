/**
 * The one visible change core made to its built-in emails after brand
 * settings: muted text darkened to meet WCAG AA, the footer's grey on the page
 * (#71717a to #52525b) and the small print's on the card (#a1a1aa to
 * #71717a).
 *
 * The suites that pin "brand settings change nothing a reader sees" compare
 * today's renders with the pre-brand sources. They apply this to the pre-brand
 * side, so that equality still holds for everything else, and no other
 * difference can pass unseen.
 */

/** Pre-brand HTML with the muted text as core writes it now. */
export function withReadableMutedText(html: string): string {
  return html
    .replace(
      /(class="email-muted" style="[^"]*?)color: #71717a;/g,
      "$1color: #52525b;"
    )
    .replaceAll("color: #a1a1aa;", "color: #71717a;");
}

/** Renders by slug, each `html` passed through {@link withReadableMutedText}. */
export function rendersWithReadableMutedText(
  renders: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(renders).map(([slug, render]) => {
      if (!render || typeof render !== "object" || !("html" in render)) {
        return [slug, render];
      }
      const { html } = render;
      return [
        slug,
        {
          ...render,
          html: typeof html === "string" ? withReadableMutedText(html) : html,
        },
      ];
    })
  );
}
