"use client";

import Link from "next/link";
import { useState } from "react";

import { Logo } from "./Logo";
import { SearchIcon } from "./SearchIcon";
import { ThemeToggle } from "./ThemeToggle";

import type { Navigation } from "@/lib/queries/navigation";
import type { Media } from "@/lib/queries/types";

/**
 * Header - sticky site header with logo, primary nav, and right-side
 * icon cluster (search, theme toggle).
 *
 * Desktop layout: logo left, nav links center-right, icons right.
 * Mobile: logo left, hamburger right; the open menu drawer is a full-
 * width panel below the header containing the same nav links + icons.
 *
 * The `useState` + `useEffect`-free hamburger keeps hydration light
 * and works without JavaScript for the initial render - the menu is
 * just shown/hidden via a `aria-expanded` state mirrored to a class.
 */

interface HeaderProps {
  siteName: string;
  logo?: Media | null;
  navigation: Navigation;
}

export function Header({ siteName, logo, navigation }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur"
      style={{
        borderColor: "var(--color-border)",
        background: "color-mix(in srgb, var(--color-bg) 90%, transparent)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <Logo siteName={siteName} logo={logo} />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {navigation.headerLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              target={link.openInNewTab ? "_blank" : undefined}
              rel={link.openInNewTab ? "noopener noreferrer" : undefined}
              className="text-sm font-medium transition-colors hover:opacity-100"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right-side icon cluster */}
        <div className="hidden items-center gap-2 md:flex">
          {navigation.showSearchIcon && <SearchIcon />}
          {navigation.showThemeToggle && <ThemeToggle />}
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen(v => !v)}
          style={{ color: "var(--color-fg)" }}
        >
          {mobileOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          className="border-t md:hidden"
          style={{ borderColor: "var(--color-border)" }}
        >
          <nav
            className="flex flex-col gap-1 px-6 py-4"
            aria-label="Mobile primary"
          >
            {navigation.headerLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                target={link.openInNewTab ? "_blank" : undefined}
                rel={link.openInNewTab ? "noopener noreferrer" : undefined}
                onClick={() => setMobileOpen(false)}
                className="py-2 text-sm font-medium"
                style={{ color: "var(--color-fg)" }}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 flex items-center gap-2">
              {navigation.showSearchIcon && <SearchIcon />}
              {navigation.showThemeToggle && <ThemeToggle />}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
