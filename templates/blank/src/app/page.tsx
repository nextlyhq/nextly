import Link from "next/link";

/**
 * Blank-template landing page.
 *
 * Replaces the inherited Next.js placeholder at `/` with a minimal,
 * brutalist-edge welcome page that points the developer at the admin
 * panel and the docs. Server Component — fetches setup-status so the
 * primary button label flips between "Set up admin" (no super-admin
 * yet) and "Open admin" (super-admin exists).
 *
 * If the auth API fails for any reason (DB not migrated, network),
 * the button defaults to "Open admin" / /admin since /admin already
 * redirects to /admin/setup when no super-admin exists — the link
 * works either way.
 *
 * Edit this file in src/app/page.tsx after scaffolding to customise.
 */

interface SetupStatus {
  isSetup: boolean;
  requiresInitialUser: boolean;
}

async function fetchSetupStatus(): Promise<SetupStatus | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/auth/setup-status`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SetupStatus;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const status = await fetchSetupStatus();
  const needsSetup = status?.requiresInitialUser ?? false;
  const adminLabel = needsSetup ? "Set up admin" : "Open admin";
  const adminHref = needsSetup ? "/admin/setup" : "/admin";

  return (
    <main className="relative min-h-screen bg-[#f9f9f9] text-slate-900 grid-bg dark:bg-[#0f172a] dark:text-slate-50">
      {/* Corner brackets — small L-marks at each viewport corner */}
      <span
        aria-hidden="true"
        className="corner-bracket fixed top-6 left-6 border-l border-t"
      />
      <span
        aria-hidden="true"
        className="corner-bracket fixed top-6 right-6 border-r border-t"
      />
      <span
        aria-hidden="true"
        className="corner-bracket fixed bottom-6 left-6 border-l border-b"
      />
      <span
        aria-hidden="true"
        className="corner-bracket fixed bottom-6 right-6 border-r border-b"
      />

      {/* Top status bar */}
      <header className="fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-3 backdrop-blur bg-[#f9f9f9]/70 dark:bg-[#0f172a]/70 border-b border-black/5 dark:border-white/10 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <span className="flex items-center">
          <span className="pulse-dot" aria-hidden="true" />
          Localhost / Development
        </span>
        <span>Nextly v0.0.x-alpha</span>
      </header>

      <div className="max-w-[720px] mx-auto px-6 pt-32 pb-12 font-display">
        <p className="font-mono font-bold uppercase tracking-[0.2em] text-[11px] text-slate-500 dark:text-slate-400">
          // 01 — New project
        </p>

        <div
          className="mt-7"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 0.9,
            fontSize: "clamp(48px, 9vw, 88px)",
            color: "currentColor",
          }}
        >
          Nextly
          <span
            aria-hidden="true"
            className="inline-block w-[14px] h-[14px] bg-current rounded-full ml-1.5"
            style={{ transform: "translateY(2px)" }}
          />
        </div>

        <h1
          className="mt-8 max-w-[18ch]"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            fontSize: "clamp(28px, 4vw, 36px)",
          }}
        >
          Welcome to your new
          <br />
          Nextly project.
        </h1>

        <p
          className="mt-7 max-w-[36ch] text-slate-500 dark:text-slate-400"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(15px, 1.5vw, 17px)",
            lineHeight: 1.55,
          }}
        >
          This is the blank template. Open the admin to create your first
          collection — or read the docs to see what Nextly can do.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            href={adminHref}
            className="group inline-flex items-center gap-2.5 rounded-none bg-current px-[22px] py-[14px] text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.4)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span className="text-[#f9f9f9] dark:text-[#0f172a]">
              {adminLabel}
            </span>
            <span
              aria-hidden="true"
              className="text-[#f9f9f9] dark:text-[#0f172a] transition-transform group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
          <Link
            href="https://nextlyhq.com/docs"
            className="inline-flex items-center gap-2.5 rounded-none bg-transparent border border-black/10 dark:border-white/15 text-current px-[22px] py-[14px] text-sm font-medium transition-all hover:bg-current hover:border-current"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span className="hover-invert">Read documentation</span>
            <span aria-hidden="true" className="hover-invert">
              ↗
            </span>
          </Link>
        </div>

        <hr className="mt-12 mb-5 border-black/[0.06] dark:border-white/10" />

        <div className="flex items-center justify-between flex-wrap gap-4">
          <p className="font-mono text-[11px] tracking-[0.04em] text-slate-500 dark:text-slate-400">
            Edit this page in{" "}
            <span className="font-semibold text-current">src/app/page.tsx</span>
          </p>
          <div className="flex gap-5 items-center">
            <Link
              href="https://github.com/nextlyhq/nextly"
              className="font-mono text-[11px] tracking-[0.04em] text-slate-500 dark:text-slate-400 hover:text-current transition-colors"
            >
              GitHub →
            </Link>
            <Link
              href="https://nextlyhq.com"
              className="font-mono text-[11px] tracking-[0.04em] text-slate-500 dark:text-slate-400 hover:text-current transition-colors"
            >
              Website →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
