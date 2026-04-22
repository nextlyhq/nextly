import Image from "next/image";
import Link from "next/link";

import type { Media } from "@/lib/queries/types";

/**
 * Logo - site branding in the Header.
 *
 * Renders the uploaded SiteSettings.logo if present; falls back to a
 * text-only brand with a small accent-colored square to the left so
 * brand-new installs don't look broken before the user uploads a logo.
 */

interface LogoProps {
  siteName: string;
  logo?: Media | null;
}

export function Logo({ siteName, logo }: LogoProps) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 text-base font-bold tracking-tight"
      style={{ color: "var(--color-fg)" }}
    >
      {logo?.url ? (
        <Image
          src={logo.url}
          alt={logo.altText || siteName}
          width={28}
          height={28}
          unoptimized
          className="h-7 w-7 rounded-md object-cover"
        />
      ) : (
        <span
          className="inline-block h-5 w-5 rounded"
          style={{ background: "var(--color-fg)" }}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{siteName || "My Blog"}</span>
    </Link>
  );
}
