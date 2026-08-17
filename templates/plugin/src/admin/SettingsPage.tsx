/**
 * Example plugin settings page, rendered at `/admin/plugins/<slug>` and inside
 * a per-component error boundary (D53).
 *
 * Every class here is a design token utility, so this page follows the admin's
 * theme and its light/dark modes with no styling work of its own. Build your
 * real settings UI the same way.
 *
 * Third-party plugins are not part of the admin's Tailwind `@source` scan, so
 * only the curated utilities in `plugin-safelist.css` are guaranteed to be
 * compiled — layout, spacing, type, and the token-mapped colours used below.
 * Anything outside that set belongs in the stylesheet your plugin declares as
 * `adminStyles`, written against the `--nx-*` custom properties.
 */
export function SettingsPage() {
  return (
    <div className="w-full max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Plugin Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Settings UI goes here. Edit{" "}
          <span className="font-mono text-xs">src/admin/SettingsPage.tsx</span>.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Where to put your fields
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Replace this card with your own form. Group related settings under a
            heading, and keep one save action for the page rather than one per
            group.
          </p>
        </div>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            Colours come from tokens —{" "}
            <span className="font-mono text-xs">bg-card</span>,{" "}
            <span className="font-mono text-xs">text-muted-foreground</span>,{" "}
            <span className="font-mono text-xs">border-border</span> — never
            from a fixed palette shade, which would keep its light-mode
            appearance in dark mode.
          </li>
          <li>
            Spacing and radius come from the same scales the rest of the admin
            uses, so your page stays aligned with it when those move.
          </li>
        </ul>
      </section>
    </div>
  );
}
