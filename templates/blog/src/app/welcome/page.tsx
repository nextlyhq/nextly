"use client";

/**
 * Welcome / Demo seed page.
 *
 * Shown after the user finishes /admin/setup. Offers a single button
 * that POSTs to /admin/api/seed (auth-gated to super-admin) to load
 * demo blog content. Lives in the template rather than the admin
 * shell so we don't need a core extension point.
 */

import Link from "next/link";
import { useState } from "react";

type SeedStatus = "idle" | "running" | "success" | "error";

export default function WelcomePage() {
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The seed route returns `{ message: "Demo content seeded." }`.
  // Holding it in state lets the success UI surface the server-authored
  // copy instead of a hard-coded string.
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function runSeed() {
    setStatus("running");
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/admin/api/seed", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          errors?: Array<{ message?: string }>;
        } | null;
        const message =
          body?.errors?.[0]?.message ?? `Request failed (${res.status})`;
        setErrorMessage(message);
        setStatus("error");
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      setSuccessMessage(body?.message ?? "Demo content seeded.");
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Welcome</h1>
      <p className="mt-2 text-muted-foreground">
        Your Nextly project is ready. You can start with an empty database or
        load some demo blog posts to explore how everything fits together.
      </p>

      <div className="mt-8 rounded-lg border p-6">
        <h2 className="text-lg font-medium">Seed demo content</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Adds example posts, categories, tags, an author, navigation links, a
          homepage hero, site-settings, and a newsletter form. Idempotent — safe
          to re-run.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runSeed}
            disabled={status === "running" || status === "success"}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "running" ? "Seeding…" : "Seed demo content"}
          </button>
          <Link
            href="/admin"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Skip and go to admin
          </Link>
        </div>

        {status === "success" && (
          <p className="mt-4 text-sm text-emerald-600">
            {successMessage ?? "Demo content seeded."} Visit{" "}
            <Link href="/" className="underline">
              your site
            </Link>{" "}
            or{" "}
            <Link href="/admin" className="underline">
              the admin
            </Link>
            .
          </p>
        )}
        {status === "error" && (
          <p className="mt-4 text-sm text-red-600">
            Seeding failed: {errorMessage ?? "unknown error"}
          </p>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Need to re-run the seed later? Sign in as a super-admin and POST to
        <code className="ml-1 font-mono">/admin/api/seed</code>.
      </p>
    </main>
  );
}
