/**
 * Custom 404 page for the frontend route group.
 *
 * Branded message + link back home. This page is rendered inside the
 * (frontend) layout, which already provides the Header and Footer.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center sm:py-32 lg:px-8">
      <p
        className="text-xs font-bold uppercase tracking-widest opacity-40"
        style={{ color: "var(--color-fg)" }}
      >
        Error 404
      </p>
      <h1
        className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl"
        style={{ color: "var(--color-fg)" }}
      >
        Page not found
      </h1>
      <p
        className="mt-6 max-w-md text-base leading-relaxed opacity-60"
        style={{ color: "var(--color-fg)" }}
      >
        The page you are looking for does not exist or has been moved to a new
        architectural coordinate.
      </p>
      <div className="mt-10 flex items-center justify-center gap-x-6">
        <Link
          href="/"
          className="border px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all hover:bg-[color:var(--color-fg)] hover:text-[color:var(--color-bg)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
