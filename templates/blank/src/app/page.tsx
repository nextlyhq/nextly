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
        <div className="flex items-center justify-center mb-8">
          <svg
            width="180"
            height="48"
            viewBox="0 0 235 63"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-foreground"
          >
            <rect width="62" height="63" fill="currentColor" />
            <path
              d="M18 46.7034L24.6253 43.6455V26.6564L32.9494 30.5448V23.26L18 16.21V46.7034Z"
              fill="var(--color-background)"
            />
            <path
              d="M44 16.2102L37.3747 19.268V36.2905L29.035 32.4021L29.0506 39.6536L44 46.7036V16.2102Z"
              fill="var(--color-background)"
            />
            <path
              d="M116.233 11.0908V45.9999H109.858L94.6705 24.0283H94.4148V45.9999H87.0341V11.0908H93.5114L108.58 33.0454H108.886V11.0908H116.233ZM134.126 46.5113C131.433 46.5113 129.115 45.9658 127.172 44.8749C125.24 43.7726 123.751 42.2158 122.706 40.2044C121.661 38.1817 121.138 35.7897 121.138 33.0283C121.138 30.3351 121.661 27.9715 122.706 25.9374C123.751 23.9033 125.223 22.3181 127.121 21.1817C129.03 20.0454 131.268 19.4772 133.837 19.4772C135.564 19.4772 137.172 19.7556 138.661 20.3124C140.161 20.8579 141.467 21.6817 142.581 22.784C143.706 23.8863 144.581 25.2726 145.206 26.9431C145.831 28.6022 146.143 30.5454 146.143 32.7726V34.7669H124.036V30.2669H139.308C139.308 29.2215 139.081 28.2954 138.626 27.4885C138.172 26.6817 137.541 26.051 136.734 25.5965C135.939 25.1306 135.013 24.8976 133.956 24.8976C132.854 24.8976 131.876 25.1533 131.024 25.6647C130.183 26.1647 129.524 26.8408 129.047 27.6931C128.57 28.534 128.325 29.4715 128.314 30.5056V34.784C128.314 36.0794 128.553 37.1988 129.03 38.1419C129.518 39.0851 130.206 39.8124 131.092 40.3238C131.979 40.8351 133.03 41.0908 134.246 41.0908C135.053 41.0908 135.791 40.9772 136.462 40.7499C137.132 40.5226 137.706 40.1817 138.183 39.7272C138.661 39.2726 139.024 38.7158 139.274 38.0567L145.99 38.4999C145.649 40.1135 144.95 41.5226 143.893 42.7272C142.848 43.9204 141.496 44.8522 139.837 45.5226C138.189 46.1817 136.286 46.5113 134.126 46.5113ZM156.482 19.8181L161.288 28.9715L166.214 19.8181H173.663L166.078 32.909L173.868 45.9999H166.453L161.288 36.9488L156.209 45.9999H148.709L156.482 32.909L148.982 19.8181H156.482ZM191.902 19.8181V25.2726H176.135V19.8181H191.902ZM179.714 13.5454H186.976V37.9544C186.976 38.6249 187.078 39.1476 187.283 39.5226C187.487 39.8863 187.771 40.1419 188.135 40.2897C188.51 40.4374 188.942 40.5113 189.43 40.5113C189.771 40.5113 190.112 40.4829 190.453 40.426C190.794 40.3579 191.055 40.3067 191.237 40.2726L192.379 45.676C192.016 45.7897 191.504 45.9204 190.845 46.0681C190.186 46.2272 189.385 46.3238 188.442 46.3579C186.692 46.426 185.158 46.1931 183.839 45.659C182.533 45.1249 181.516 44.2954 180.788 43.1704C180.061 42.0454 179.703 40.6249 179.714 38.909V13.5454ZM204.456 11.0908V45.9999H197.195V11.0908H204.456ZM214.756 55.8181C213.835 55.8181 212.972 55.7442 212.165 55.5965C211.369 55.4601 210.71 55.284 210.188 55.0681L211.824 49.6476C212.676 49.909 213.443 50.051 214.125 50.0738C214.818 50.0965 215.415 49.9374 215.915 49.5965C216.426 49.2556 216.841 48.676 217.159 47.8579L217.585 46.7499L208.193 19.8181H215.83L221.25 39.0454H221.523L226.994 19.8181H234.682L224.506 48.8294C224.017 50.2385 223.352 51.4658 222.511 52.5113C221.682 53.5681 220.631 54.3806 219.358 54.9488C218.085 55.5283 216.551 55.8181 214.756 55.8181Z"
              fill="currentColor"
            />
          </svg>
          <span className="ml-4 font-mono text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 bg-foreground/5 text-slate-500">
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
