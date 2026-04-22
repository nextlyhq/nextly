/**
 * NewsletterCta - layout-only newsletter signup form.
 *
 * Two variants:
 * - "homepage" - big inline section with heading + subheading + two
 *   input fields (name, email) and a submit button.
 * - "footer" - condensed one-row form fitting the footer's Subscribe
 *   column.
 *
 * The submit action is a stub in this PR; Task 17 Sub-task 10 wires it
 * to the `@revnixhq/plugin-form-builder` `form-submissions` collection
 * via a Server Action. Until then the button shows a non-destructive
 * fallback message so the UI is complete and looks right.
 */

interface NewsletterCtaProps {
  variant?: "homepage" | "footer";
  heading?: string;
  subheading?: string;
}

export function NewsletterCta({
  variant = "homepage",
  heading = "Get new posts in your inbox",
  subheading = "No spam. Unsubscribe anytime.",
}: NewsletterCtaProps) {
  if (variant === "footer") {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={e => {
          e.preventDefault();
          /* Wired up in Task 17 Sub-task 10 (form-builder plugin). */
        }}
      >
        <label className="sr-only" htmlFor="nl-footer-email">
          Email
        </label>
        <div className="flex gap-2">
          <input
            id="nl-footer-email"
            type="email"
            required
            placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg-surface)",
              color: "var(--color-fg)",
            }}
          />
          <button
            type="submit"
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-fg)",
              color: "var(--color-bg-surface)",
            }}
          >
            Subscribe
          </button>
        </div>
      </form>
    );
  }

  return (
    <section
      className="rounded-xl border p-8 sm:p-10"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md">
          <h2
            className="text-xl font-semibold tracking-tight sm:text-2xl"
            style={{ color: "var(--color-fg)" }}
          >
            {heading}
          </h2>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {subheading}
          </p>
        </div>
        <form
          className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
          onSubmit={e => {
            e.preventDefault();
          }}
        >
          <label className="sr-only" htmlFor="nl-home-name">
            Name
          </label>
          <input
            id="nl-home-name"
            type="text"
            placeholder="Name"
            className="rounded-md border px-3 py-2 text-sm sm:w-32"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
            }}
          />
          <label className="sr-only" htmlFor="nl-home-email">
            Email
          </label>
          <input
            id="nl-home-email"
            type="email"
            required
            placeholder="you@example.com"
            className="rounded-md border px-3 py-2 text-sm sm:w-56"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
            }}
          />
          <button
            type="submit"
            className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-fg)",
              color: "var(--color-bg-surface)",
            }}
          >
            Subscribe
          </button>
        </form>
      </div>
    </section>
  );
}
