"use client";

import { Button } from "@nextlyhq/ui";
import type React from "react";

import { ArrowLeft, LayoutDashboard } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES } from "@admin/constants/routes";
import { entryBehindIsAdmin, isAdminPath } from "@admin/lib/admin-history";
import { navigateTo } from "@admin/lib/navigation";

/** A same-origin URL inside the admin, matched by whole path segment. */
function isAdminUrl(url: string): boolean {
  try {
    const { origin, pathname } = new URL(url);
    return origin === window.location.origin && isAdminPath(pathname);
  } catch {
    return false;
  }
}

/** The part of the Navigation API read here; not in every browser yet. */
interface NavigationEntries {
  currentEntry: { index: number } | null;
  entries: () => ReadonlyArray<{ url: string | null }>;
}

function navigationEntries(): NavigationEntries | undefined {
  const { navigation } = window as Window & { navigation?: unknown };
  if (
    typeof navigation === "object" &&
    navigation !== null &&
    "entries" in navigation &&
    typeof navigation.entries === "function" &&
    "currentEntry" in navigation
  ) {
    return navigation as NavigationEntries;
  }
  return undefined;
}

/**
 * Whether the page before this one is an admin page.
 *
 * Same-origin is not enough: the admin runs inside the site it manages, so a
 * link followed from the site's own pages leaves an entry of this origin that
 * is not the admin, and going back would leave it. The Navigation API lists
 * this origin's entries with their URLs, so the one before is read directly.
 * Without it, only a move the router itself saw proves an admin page behind:
 * the referrer names the page a link was followed from, which a new tab
 * reports too while having no entry behind it at all. Anything not proven
 * goes to the dashboard, which never leaves the admin.
 */
function previousPageIsAdmin(): boolean {
  const navigation = navigationEntries();
  if (navigation) {
    const index = navigation.currentEntry?.index ?? 0;
    const previous = index > 0 ? navigation.entries()[index - 1] : undefined;
    return typeof previous?.url === "string" && isAdminUrl(previous.url);
  }
  return entryBehindIsAdmin() === true;
}

/**
 * Leave a page that has nothing to show.
 *
 * Where going back would leave the admin, or do nothing at all, the button
 * would look broken exactly when someone followed a shared link they can't
 * use, so it goes to the dashboard, the nearest place inside.
 */
function goBack(): void {
  if (previousPageIsAdmin()) {
    window.history.back();
    return;
  }
  navigateTo(ROUTES.DASHBOARD);
}

export interface StatusPageProps {
  /** The large mark above the label: a numeral, or an icon in a tile. */
  visual: React.ReactNode;
  /** A short neutral tag naming the state, e.g. "Page Not Found". */
  label: string;
  title: string;
  description: string;
}

/**
 * The centred card a page shows in place of its content: not found, or no
 * access. One shell, so every dead end in the admin looks and leaves the same
 * way, with "Go back" and "Go to dashboard".
 */
export function StatusPage({
  visual,
  label,
  title,
  description,
}: StatusPageProps) {
  return (
    <PageContainer className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
      <div className="flex flex-col items-center text-center max-w-[500px] w-full px-6 py-12 rounded-lg bg-card border border-border">
        <div className="mb-2 select-none">{visual}</div>

        {/* Neutral: a dead end is a state, not an outcome, so it takes the
            muted pair rather than the green the admin uses for success or
            the red it keeps for errors. */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          {label}
        </div>

        <h1 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-[340px]">
          {description}
        </p>

        {/* Stacked on a phone, side by side from `sm`, each at full width
            until then so neither is a narrow target. */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[140px] gap-2 rounded-md font-medium text-foreground border-border hover:bg-primary/5"
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </Button>
          <Button
            className="w-full sm:w-auto sm:min-w-[140px] gap-2 rounded-md font-medium"
            onClick={() => navigateTo(ROUTES.DASHBOARD)}
          >
            <LayoutDashboard className="h-4 w-4" />
            Go to dashboard
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
