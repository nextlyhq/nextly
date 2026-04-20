import Link from "next/link";

/**
 * Footer - site footer with secondary nav, copyright, social links,
 * and the "Powered by Nextly" attribution.
 */

interface SocialLinks {
  twitter?: string | null;
  github?: string | null;
  linkedin?: string | null;
}

interface FooterProps {
  siteName: string;
  social?: SocialLinks | null;
}

export function Footer({ siteName, social }: FooterProps) {
  // Server Component: `new Date()` runs per-request on the server, so
  // there's no client / server hydration mismatch on year-flip.
  const currentYear = new Date().getFullYear();

  const socialLinks = [
    social?.twitter && { label: "Twitter", url: social.twitter },
    social?.github && { label: "GitHub", url: social.github },
    social?.linkedin && { label: "LinkedIn", url: social.linkedin },
  ].filter(Boolean) as Array<{ label: string; url: string }>;

  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        {/* Secondary nav */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href="/blog"
            className="text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Blog
          </Link>
          <Link
            href="/tags"
            className="text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Tags
          </Link>
          <Link
            href="/archive"
            className="text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Archive
          </Link>
          <Link
            href="/feed.xml"
            className="text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            RSS
          </Link>
        </nav>

        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Copyright */}
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            &copy; {currentYear} {siteName || "My Blog"}
          </p>

          {/* Social links */}
          {socialLinks.length > 0 && (
            <nav className="flex items-center gap-4">
              {socialLinks.map(link => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}

          {/* Powered by Nextly */}
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Powered by{" "}
            <Link
              href="https://nextlyhq.com"
              className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              Nextly
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
