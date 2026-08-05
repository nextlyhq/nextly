"use client";

/**
 * What the sanitizer removed from a block of custom CSS, shown where it was
 * written.
 *
 * Custom CSS is checked on render, not on save, so a rule the author typed can
 * be missing from the page with nothing on screen to say so. Reading their own
 * CSS back tells them nothing either — the source still contains the line that
 * did not survive. This is the only place the removal can be explained.
 */
import type { CssWarning } from "../../../core/css-sanitize";

export function CssWarnings({
  warnings,
}: {
  warnings: readonly CssWarning[];
}): React.ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <ul
      // `alert` rather than a plain list: the content appears in response to
      // something the author just typed, and a screen reader that only
      // announces it on focus would announce it too late to be the reason.
      role="alert"
      aria-label="Custom CSS warnings"
      style={{
        display: "grid",
        gap: 4,
        margin: 0,
        padding: "6px 8px",
        listStyle: "none",
        fontSize: 12,
        lineHeight: 1.4,
        color: "var(--nx-pb-ed-destructive, var(--nx-destructive))",
        border: "1px solid var(--nx-pb-ed-border-strong, var(--nx-border))",
        borderRadius: 4,
      }}
    >
      {warnings.map(warning => (
        <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
      ))}
    </ul>
  );
}
