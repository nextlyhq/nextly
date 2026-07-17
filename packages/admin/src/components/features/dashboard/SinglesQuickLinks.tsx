"use client";

import { Card, CardContent, Skeleton } from "@nextlyhq/ui";
import { AlertCircle, FileText } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useSingles } from "@admin/hooks/queries";
import type { ApiSingle } from "@admin/types/entities";

/**
 * Dashboard surface listing all configured Singles. Mirrors the grid +
 * heading style used by CollectionQuickLinks. Each card links to the
 * Single's edit page (Singles are 1-of, so there's no list view to
 * navigate to first).
 */

function SingleCard({ single }: { single: ApiSingle }) {
  const Icon = useMemo(() => {
    if (single.admin?.icon) {
      const Configured = (Icons as Record<string, React.ElementType>)[
        single.admin.icon
      ];
      if (Configured) return Configured;
    }
    return FileText;
  }, [single.admin?.icon]);

  return (
    <Link
      href={buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug })}
      // Full-strength hover border, more visible than the resting border, not a fainter alpha.
      className="block group h-full rounded-none overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary"
    >
      <Card
        variant="interactive"
        className="h-full border-0! bg-transparent! transition-colors duration-200 rounded-none overflow-hidden relative"
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h5 className="font-semibold text-base tracking-tight text-foreground truncate group-hover:text-primary transition-colors">
                {single.label || single.slug}
              </h5>
              {single.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {single.description}
                </p>
              )}
            </div>
            <div className="text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0">
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton
          key={i}
          className="h-24 rounded-none bg-muted/30 border border-border"
        />
      ))}
    </div>
  );
}

export const SinglesQuickLinks: React.FC = () => {
  const {
    data: singlesData,
    isLoading,
    error,
  } = useSingles({ pagination: { page: 0, pageSize: 100 } });

  const singles = singlesData?.items ?? [];

  // Hide the entire section when there are no Singles. Keeps the
  // dashboard minimal on installs that don't use Singles at all.
  if (!isLoading && !error && singles.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="dashboard-singles-heading" className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <h4
            id="dashboard-singles-heading"
            className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap"
          >
            Singles
          </h4>
          <div className="h-px flex-1 bg-border" />
        </div>
        {singles.length > 0 && (
          <span className="ml-4 text-xs font-medium tabular-nums text-muted-foreground">
            {singles.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        // Full-strength destructive border so the boundary is perceivable at the 3:1 UI minimum.
        <div className="flex items-center gap-2 py-6 text-sm text-destructive justify-center bg-destructive/5 border border-destructive rounded-none">
          <AlertCircle className="h-4 w-4" />
          <span>Couldn&apos;t load singles.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {singles.map(single => (
            <SingleCard key={single.id} single={single} />
          ))}
        </div>
      )}
    </section>
  );
};
