"use client";

import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useRouter } from "@admin/hooks/useRouter";
import { cn } from "@admin/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type DocumentScope = "collection" | "single";

export interface DocumentTabsProps {
  /** What kind of document this is. Singles don't get Versions/LivePreview tabs. */
  scope: DocumentScope;
  /** The collection or single slug; used to build sibling-route hrefs. */
  slug: string;
  /** The entry id for collection edit pages. Omitted on /create routes
   *  (Versions makes no sense before the document exists). */
  entryId?: string;
}

// ============================================================================
// Component
// ============================================================================

interface Tab {
  key: string;
  label: string;
  href: string | null;
  /** Disabled tabs render a "Soon" badge and don't navigate. */
  comingSoon?: boolean;
  /** True when the current pathname belongs to this tab's route surface. */
  active: boolean;
}

/**
 * DocumentTabs — sibling-route navigation strip above the action bar.
 *
 * Per Q-D6=c in the redesign spec, every collection / single document edit
 * surface gets the same four tabs:
 *
 *   • Edit (the form, default)
 *   • API (the existing API playground sibling route)
 *   • Versions (Soon — placeholder, disabled)
 *   • Live Preview (Soon — placeholder, disabled)
 *
 * Singles render Edit + API only — Versions/Live Preview are suppressed
 * since singles don't have a per-version model in v1.
 *
 * The active tab is derived from `usePathname()` against ROUTES — no prop
 * threading required by callers.
 */
export function DocumentTabs({
  scope,
  slug,
  entryId,
}: DocumentTabsProps): React.ReactElement {
  const { pathname } = useRouter();
  const tabs = buildTabs({ scope, slug, entryId, pathname });

  return (
    <div className="border-b border-primary/5 px-6 flex items-center gap-1">
      {tabs.map(tab => (
        <DocumentTab key={tab.key} tab={tab} />
      ))}
    </div>
  );
}

function DocumentTab({ tab }: { tab: Tab }) {
  const baseClass = cn(
    "inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium",
    "border-b-2 transition-colors",
    tab.active
      ? "text-foreground border-foreground"
      : "text-muted-foreground border-transparent hover:text-foreground"
  );

  if (tab.comingSoon || !tab.href) {
    return (
      <span
        className={cn(baseClass, "cursor-not-allowed opacity-70")}
        aria-disabled="true"
      >
        {tab.label}
        {tab.comingSoon && (
          <span className="text-[9px] font-bold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-primary/5 text-muted-foreground">
            Soon
          </span>
        )}
      </span>
    );
  }

  return (
    <Link href={tab.href} className={baseClass}>
      {tab.label}
    </Link>
  );
}

// ============================================================================
// Tab construction
// ============================================================================

function buildTabs(args: {
  scope: DocumentScope;
  slug: string;
  entryId?: string;
  pathname: string;
}): Tab[] {
  const { scope, slug, entryId, pathname } = args;

  if (scope === "single") {
    const editHref = buildRoute(ROUTES.SINGLE_EDIT, { slug });
    const apiHref = buildRoute(ROUTES.SINGLE_API, { slug });
    return [
      {
        key: "edit",
        label: "Edit",
        href: editHref,
        active: pathname === editHref,
      },
      { key: "api", label: "API", href: apiHref, active: pathname === apiHref },
    ];
  }

  // Collection scope.
  const editHref = entryId
    ? buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id: entryId })
    : buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug });
  const apiHref = buildRoute(ROUTES.COLLECTION_ENTRY_API, { slug });
  const compareHref = buildRoute(ROUTES.COLLECTION_ENTRY_COMPARE, { slug });

  // Edit is "active" for both create and edit routes (and the entries list
  // root, which lands users back on the form anyway).
  const editActive =
    pathname === editHref ||
    pathname === buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug }) ||
    pathname === buildRoute(ROUTES.COLLECTION_ENTRIES, { slug });

  return [
    { key: "edit", label: "Edit", href: editHref, active: editActive },
    {
      key: "api",
      label: "API",
      href: apiHref,
      active: pathname === apiHref || pathname === compareHref,
    },
    {
      key: "versions",
      label: "Versions",
      href: null,
      comingSoon: true,
      active: false,
    },
    {
      key: "preview",
      label: "Live Preview",
      href: null,
      comingSoon: true,
      active: false,
    },
  ];
}
