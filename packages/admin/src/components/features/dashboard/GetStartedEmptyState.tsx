"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@revnixhq/ui";
import { ArrowRight } from "lucide-react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { cn } from "@admin/lib/utils";

interface QuickAction {
  label: string;
  description: string;
  href: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Create a collection",
    description: "A reusable schema for many items (Posts, Products, Authors).",
    href: ROUTES.COLLECTIONS_CREATE,
  },
  {
    label: "Create a single",
    description: "One-off content like Site Settings, Homepage, or Footer.",
    href: ROUTES.SINGLES_BUILDER,
  },
  {
    label: "Create a component",
    description: "Reusable building blocks for layouts and rich text.",
    href: ROUTES.COMPONENTS,
  },
  {
    label: "Add a user",
    description: "Invite a teammate. Assign roles and permissions.",
    href: ROUTES.USERS_CREATE,
  },
];

/**
 * Dashboard empty state shown when no content collections exist.
 *
 * Replaces the previous "No Collections" pill which only offered a
 * single CTA and had contrast issues. This version covers the four
 * primary "things you can create" paths in Nextly (collections,
 * singles, components, users) with consistent brutalist styling that
 * matches the OnboardingChecklist and SeedDemoContentCard aesthetic.
 *
 * Hidden when the SeedDemoContentCard is the active CTA — first-visit
 * users see only the seed prompt; once that's dismissed/completed,
 * this card surfaces if the project still has no collections.
 */
export function GetStartedEmptyState() {
  const { status: seedStatus } = useSeedStatus();

  // Mutual exclusivity with SeedDemoContentCard.
  if (seedStatus.kind !== "loading" && seedStatus.kind !== "hidden") {
    return null;
  }

  return (
    <Card className="rounded-none border-primary/5 bg-primary/[0.01] backdrop-blur-md overflow-hidden transition-all duration-700 hover:border-primary/40 group/card relative">
      <div className="absolute top-0 left-0 right-0 h-px bg-primary/5">
        <span className="block h-full w-full bg-primary" />
      </div>

      <CardHeader noBorder className="space-y-2 px-8 pt-9 pb-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/80">
          Get started
        </CardTitle>
        <h2 className="text-[22px] font-black tracking-tight text-foreground">
          Build your project.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
          Pick a starting point. You can have all four — collections, singles,
          components, and users coexist in any Nextly project.
        </p>
      </CardHeader>

      <CardContent className="px-8 pb-8 pt-2">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
          {QUICK_ACTIONS.map(action => (
            <li key={action.label}>
              <Link
                href={action.href}
                className={cn(
                  "group/row flex items-center justify-between gap-4 px-5 py-4 bg-background",
                  "hover:bg-primary/[0.03] transition-colors duration-300"
                )}
              >
                <div className="space-y-1 min-w-0">
                  <span className="block text-[11px] font-black uppercase tracking-[0.2em] text-foreground/85 group-hover/row:text-primary transition-colors">
                    {action.label}
                  </span>
                  <span className="block text-[12px] text-muted-foreground leading-snug">
                    {action.description}
                  </span>
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-primary/30 group-hover/row:text-primary group-hover/row:translate-x-1 transition-all"
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
