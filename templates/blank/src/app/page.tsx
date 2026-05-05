import Link from "next/link";
import { ThemeToggle } from "./components/ThemeToggle";

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
    <main className="relative min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground font-display selection:bg-foreground/10">
      <ThemeToggle />
      <div className="max-w-[640px] w-full text-center">
        <div className="flex items-center justify-center mb-8 font-semibold tracking-[-0.05em] leading-none text-[clamp(48px,10vw,96px)]">
          Nextly
          <span className="ml-2 font-mono text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 bg-foreground/5 text-slate-500">
            Alpha
          </span>
        </div>

        <h1 className="mx-auto font-semibold tracking-[-0.03em] leading-[1.1] text-[clamp(24px,5vw,32px)]">
          Welcome to your new Nextly project.
        </h1>

        <p className="mt-6 mx-auto text-slate-500 dark:text-slate-400 max-w-[42ch] text-[clamp(16px,1.8vw,18px)] leading-[1.6]">
          This is the blank template. Open the admin to create your first
          collection or read the docs to see what Nextly can do.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href={adminHref} className="btn-primary">
            <span>{adminLabel}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-arrow-right"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
          <Link href="https://nextlyhq.com/docs" className="btn-secondary">
            <span>Read documentation</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-arrow-up-right"
            >
              <path d="M7 7h10v10" />
              <path d="M7 17 17 7" />
            </svg>
          </Link>
        </div>

        <div className="mt-16 pt-8 border-t border-foreground/5 flex flex-col sm:flex-row items-center justify-between gap-6">
          <p className="font-mono text-[11px] tracking-tight text-slate-500">
            Edit in <span className="text-foreground">src/app/page.tsx</span>
          </p>
          <div className="flex gap-6">
            <Link
              href="https://github.com/nextlyhq/nextly"
              className="flex items-center gap-2 text-[12px] font-medium text-slate-500 hover:text-foreground transition-colors"
            >
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                style={{ verticalAlign: "text-bottom" }}
              >
                <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"></path>
              </svg>
              <span>GitHub</span>
            </Link>
            <Link
              href="https://nextlyhq.com"
              className="flex items-center gap-2 text-[12px] font-medium text-slate-500 hover:text-foreground transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-globe"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
              <span>Website</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
