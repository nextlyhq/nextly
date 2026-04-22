import Link from "next/link";

import { Logo } from "./Logo";
import { NewsletterCta } from "./NewsletterCta";

import type { Navigation } from "@/lib/queries/navigation";
import type { Media } from "@/lib/queries/types";

/**
 * Footer - three-column layout with About, Read, and Subscribe.
 *
 * Columns (desktop):
 * 1. About: logo + tagline + social links from SiteSettings.social.
 * 2. Read: the footer link list from the Navigation single.
 * 3. Subscribe: compact NewsletterCta.
 *
 * Mobile: columns stack in the same order. Bottom strip has copyright
 * and the "Powered by Nextly" attribution.
 */

interface SocialLinks {
  twitter?: string | null;
  github?: string | null;
  linkedin?: string | null;
}

interface FooterProps {
  siteName: string;
  tagline: string;
  logo?: Media | null;
  social?: SocialLinks | null;
  navigation: Navigation;
}

export function Footer({
  siteName,
  tagline,
  logo,
  social,
  navigation,
}: FooterProps) {
  const currentYear = new Date().getFullYear();

  const socialLinks = [
    social?.twitter && { label: "Twitter", url: social.twitter, icon: XIcon },
    social?.github && { label: "GitHub", url: social.github, icon: GitHubIcon },
    social?.linkedin && {
      label: "LinkedIn",
      url: social.linkedin,
      icon: LinkedInIcon,
    },
  ].filter(Boolean) as Array<{
    label: string;
    url: string;
    icon: () => React.ReactElement;
  }>;

  return (
    <footer className="border-t" style={{ borderColor: "var(--color-border)" }}>
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.3fr]">
          {/* Col 1: About */}
          <div>
            <Logo siteName={siteName} logo={logo} />
            <p
              className="mt-3 max-w-xs text-sm leading-relaxed"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {tagline}
            </p>
            {socialLinks.length > 0 && (
              <div className="mt-4 flex gap-2">
                {socialLinks.map(link => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.label}
                    className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-fg-muted)",
                    }}
                  >
                    <link.icon />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Col 2: Read (from Navigation single) */}
          <div>
            <h3
              className="text-sm font-semibold tracking-tight"
              style={{ color: "var(--color-fg)" }}
            >
              Read
            </h3>
            <ul className="mt-3 space-y-2">
              {navigation.footerReadLinks.map(link => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm transition-colors"
                    style={{ color: "var(--color-fg-muted)" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3: Subscribe */}
          <div>
            <h3
              className="text-sm font-semibold tracking-tight"
              style={{ color: "var(--color-fg)" }}
            >
              Subscribe
            </h3>
            <p
              className="mt-3 mb-3 text-sm"
              style={{ color: "var(--color-fg-muted)" }}
            >
              Get new posts by email. No spam.
            </p>
            <NewsletterCta variant="footer" />
          </div>
        </div>

        {/* Bottom strip */}
        <div
          className="mt-10 flex flex-col items-start justify-between gap-3 border-t pt-6 sm:flex-row sm:items-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>
            &copy; {currentYear} {siteName || "My Blog"}
          </p>
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>
            Powered by{" "}
            <Link
              href="https://nextlyhq.com"
              className="underline underline-offset-2"
            >
              Nextly
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

/* Minimal inline social icons - no external icon library dep. */
function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.08 1.84 2.82 1.31 3.51 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.23 0 1.61-.01 2.9-.01 3.3 0 .32.22.7.83.58C20.56 21.79 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.026-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.049c.475-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
