"use client";

import { Button } from "@nextlyhq/ui";
import type React from "react";

import { ArrowLeft, LayoutDashboard } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

/**
 * Leave a page that has nothing to show.
 *
 * A link opened in a fresh tab has a single history entry, and `back()` there
 * does nothing, so the button would look broken exactly when someone followed
 * a shared link they can't use. The dashboard is the nearest place to go.
 */
function goBack(): void {
  if (window.history.length > 1) {
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
