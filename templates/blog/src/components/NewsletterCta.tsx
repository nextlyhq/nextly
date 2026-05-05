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
        <div className="relative flex w-full max-w-sm">
          <input
            id="nl-footer-email"
            name="email"
            type="email"
            required
            placeholder="Email address"
            disabled={pending || state.status === "success"}
            className="w-full rounded-none border px-4 py-3 text-sm transition-colors focus:border-[color:var(--color-fg-muted)] focus:outline-none disabled:opacity-60 pr-12"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
            }}
          />
          <button
            type="submit"
            disabled={pending || state.status === "success"}
            className="absolute right-0 top-0 bottom-0 flex w-12 items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ color: "var(--color-fg)" }}
            aria-label="Subscribe"
          >
            {pending ? (
              <span className="text-xs">...</span>
            ) : state.status === "success" ? (
              <span className="text-xs">✓</span>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                ></path>
              </svg>
            )}
          </button>
        </div>
        {state.status === "error" && (
          <p
            className="text-[10px] font-medium"
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
      className="w-full"
      style={{
        background: "var(--color-bg-surface)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 py-12 lg:py-20">
        <div
          className="rounded-none border p-10 md:p-14"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-md">
              <h2
                className="text-2xl font-bold tracking-tightest-premium sm:text-3xl"
                style={{ color: "var(--color-fg)" }}
              >
                {heading}
              </h2>
              <p
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--color-fg-muted)" }}
              >
                {subheading}
              </p>
              {state.status === "error" && (
                <p
                  className="mt-4 text-xs font-medium"
                  role="alert"
                  style={{ color: "var(--color-accent)" }}
                >
                  {state.error}
                </p>
              )}
              {state.status === "success" && (
                <p
                  className="mt-4 text-xs font-bold uppercase tracking-widest"
                  style={{ color: "var(--color-accent)" }}
                >
                  Thanks! You're subscribed.
                </p>
              )}
            </div>
            <form
              action={formAction}
              className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
            >
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
                className="rounded-none border px-4 py-3 text-sm transition-colors focus:border-[color:var(--color-fg-muted)] focus:outline-none disabled:opacity-60 sm:w-64"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-fg)",
                }}
              />
              <button
                type="submit"
                disabled={pending || state.status === "success"}
                className="antigravity-press rounded-none px-6 py-3 text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-90 disabled:opacity-50"
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
        </div>
      </div>
    </section>
  );
}
