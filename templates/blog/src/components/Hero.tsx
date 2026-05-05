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
    <section
      className="py-24 text-center md:py-32 w-full"
      style={{
        background: "var(--color-bg-surface)",
      }}
    >
      <div className="mx-auto w-full px-6">
        <h1
          className="mx-auto max-w-4xl text-5xl font-extrabold leading-tight tracking-tightest-premium sm:text-6xl md:text-7xl"
          style={{ color: "var(--color-fg)" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mx-auto mt-8 max-w-2xl text-lg font-medium leading-relaxed sm:text-xl"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}
