"use client";

import { useActionState } from "react";

import { submitNewsletter } from "@/actions/submit-newsletter";

/**
 * NewsletterCta - newsletter signup form.
 *
 * Two variants:
 * - "homepage" - large inline section with heading + subheading + two
 *   input fields (name, email) and a submit button.
 * - "footer" - condensed one-row form fitting the footer's Subscribe
 *   column.
 *
 * Posts to the `submitNewsletter` Server Action which writes a row
 * into the form-builder plugin's `form-submissions` collection
 * (keyed to the `newsletter` form seeded in `seed/nextly.seed.ts`).
 * Admin sees submissions under `/admin/collections/form-submissions`.
 *
 * Uses React 19's `useActionState` so form state, pending state, and
 * the server result are all in one place.
 */

interface NewsletterCtaProps {
  variant?: "homepage" | "footer";
  heading?: string;
  subheading?: string;
}

type State =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: string };

async function reducer(_prev: State, formData: FormData): Promise<State> {
  const result = await submitNewsletter(formData);
  if (result.ok) return { status: "success" };
  return { status: "error", error: result.error ?? "Submission failed." };
}

export function NewsletterCta({
  variant = "homepage",
  heading = "Get new posts in your inbox",
  subheading = "No spam. Unsubscribe anytime.",
}: NewsletterCtaProps) {
  const [state, formAction, pending] = useActionState(reducer, {
    status: "idle",
  });

  if (variant === "footer") {
    return (
      <form action={formAction} className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="nl-footer-email">
          Email
        </label>
        <div className="flex gap-2">
          <input
            id="nl-footer-email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            disabled={pending || state.status === "success"}
            className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg-surface)",
              color: "var(--color-fg)",
            }}
          />
          <button
            type="submit"
            disabled={pending || state.status === "success"}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "var(--color-fg)",
              color: "var(--color-bg-surface)",
            }}
          >
            {pending ? "..." : state.status === "success" ? "✓" : "Subscribe"}
          </button>
        </div>
        {state.status === "error" && (
          <p
            className="text-xs"
            role="alert"
            style={{ color: "var(--color-accent)" }}
          >
            {state.error}
          </p>
        )}
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
          {state.status === "error" && (
            <p
              className="mt-2 text-sm"
              role="alert"
              style={{ color: "var(--color-accent)" }}
            >
              {state.error}
            </p>
          )}
          {state.status === "success" && (
            <p
              className="mt-2 text-sm"
              role="status"
              style={{ color: "var(--color-accent)" }}
            >
              Thanks! You're subscribed.
            </p>
          )}
        </div>
        <form
          action={formAction}
          className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
        >
          <label className="sr-only" htmlFor="nl-home-name">
            Name
          </label>
          <input
            id="nl-home-name"
            name="name"
            type="text"
            placeholder="Name"
            disabled={pending || state.status === "success"}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-60 sm:w-32"
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
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            disabled={pending || state.status === "success"}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-60 sm:w-56"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
            }}
          />
          <button
            type="submit"
            disabled={pending || state.status === "success"}
            className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "var(--color-fg)",
              color: "var(--color-bg-surface)",
            }}
          >
            {pending
              ? "Subscribing..."
              : state.status === "success"
                ? "Subscribed ✓"
                : "Subscribe"}
          </button>
        </form>
      </div>
    </section>
  );
}
