/**
 * Hero - centered homepage intro.
 *
 * Takes the title + subtitle from the Homepage single. Generous
 * vertical padding; max-width 640px for readable line lengths on the
 * subtitle. Intentionally minimal - the hero's job is one clear idea,
 * not a dashboard.
 */

interface HeroProps {
  title: string;
  subtitle?: string;
}

export function Hero({ title, subtitle }: HeroProps) {
  return (
    <section className="py-14 text-center sm:py-20">
      <h1
        className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl"
        style={{ color: "var(--color-fg)" }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          className="mx-auto mt-4 max-w-2xl text-base sm:text-lg"
          style={{ color: "var(--color-fg-muted)" }}
        >
          {subtitle}
        </p>
      )}
    </section>
  );
}
