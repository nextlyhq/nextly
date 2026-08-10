"use client";

/**
 * The comparison surface: every shortlisted theme as a large card, applied
 * with one click.
 *
 * Reads and writes the same selection the /admin switcher uses, so applying
 * here and then refining there is one continuous act rather than two
 * disconnected preferences. The measured AA score rides on each card because
 * the shortlist is judged by eye and a contrast miss is exactly what the eye
 * does not report.
 */
import Link from "next/link";

import { CONTRAST_REPORT } from "../../theme-lab/contrast-report.generated";
import { ThemePreviewCard } from "../../theme-lab/ThemePreviewCard";
import { NEXTLY_THEMES, TWEAKCN_THEMES } from "../../theme-lab/themes";
import { useThemeLab } from "../../theme-lab/use-theme-lab";

const GROUPS = [
  { label: "Nextly originals", themes: NEXTLY_THEMES },
  { label: "tweakcn presets (reference)", themes: TWEAKCN_THEMES },
];

export function Gallery() {
  const { theme, setTheme } = useThemeLab();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--nx-muted-foreground)]">
          Applying a theme switches the real admin. Scores are measured WCAG AA
          misses across every asserted pairing, light and dark.
        </p>
        <Link className="text-sm underline" href="/admin">
          Open /admin with the applied theme →
        </Link>
      </div>

      {GROUPS.map(group => (
        <section key={group.label} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">{group.label}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.themes.map(entry => (
              <ThemePreviewCard
                key={entry.id}
                theme={entry}
                size="gallery"
                contrastFailures={CONTRAST_REPORT[entry.id]}
                onApply={setTheme}
                applied={theme === entry.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
