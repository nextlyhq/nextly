"use client";

/**
 * Client-side error boundary for the frontend route group.
 *
 * Shown when a Server Component or a nested client component throws.
 * The `reset` prop re-runs the segment so transient errors (e.g. flaky
 * upstream call) can recover without a page reload.
 *
 * In production, wire `console.error` to a logging service of your
 * choice (Sentry, Axiom, Datadog, etc.).
 */

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
        Error
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
        Something went wrong
      </h1>
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-8 inline-flex rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Try again
      </button>
    </div>
  );
}
