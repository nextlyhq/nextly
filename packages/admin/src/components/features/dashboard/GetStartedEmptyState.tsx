"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import { ArrowRight } from "lucide-react";

import { Database, FileText, Puzzle, UserPlus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";

interface QuickAction {
  label: string;
  description: string;
  href: string;
  Icon: typeof Database;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Create a collection",
    description: "A reusable schema for many items (Posts, Products, Authors).",
    href: ROUTES.BUILDER_COLLECTIONS_NEW,
    Icon: Database,
  },
  {
    label: "Create a single",
    description: "One-off content like Site Settings, Homepage, or Footer.",
    href: ROUTES.BUILDER_SINGLES_NEW,
    Icon: FileText,
  },
  {
    label: "Create a component",
    description: "Reusable building blocks for layouts and rich text.",
    href: ROUTES.BUILDER_COMPONENTS,
    Icon: Puzzle,
  },
  {
    label: "Add a user",
    description: "Invite a teammate. Assign roles and permissions.",
    href: ROUTES.USERS_CREATE,
    Icon: UserPlus,
  },
];

/**
 * Dashboard empty state shown when no content collections exist.
 *
 * Four CTAs (collection / single / component / user) rendered as
 * separate cards in a 2x2 grid. Typography matches the rest of the
 * admin (text-base / text-sm / font-semibold / tracking-tight) rather
 * than the brutalist styling used by the SeedDemoContentCard.
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
    <section aria-labelledby="get-started-heading" className="space-y-4">
      <header className="space-y-1">
        <h2
          id="get-started-heading"
          className="text-xl font-semibold tracking-tight text-foreground"
        >
          Get started
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a starting point. Collections, singles, components, and users can
          coexist in any Nextly project.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {QUICK_ACTIONS.map(({ label, description, href, Icon }) => (
          <li key={label}>
            <Link href={href} className="block group">
              <Card variant="interactive" className="h-full">
                <CardContent className="p-5 flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="text-base font-semibold tracking-tight text-foreground">
                      {label}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {description}
                    </p>
                  </div>
                  <ArrowRight
                    aria-hidden="true"
                    className="shrink-0 h-4 w-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
                  />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
