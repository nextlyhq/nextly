"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import { FileText } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useSingles } from "@admin/hooks/queries";
import type { ApiSingle } from "@admin/types/entities";

import { CardEmpty, CardError, CardSkeleton } from "../widgets/frame/states";

import { keptOffDashboard } from "./kept-off-dashboard";

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
      className="block group h-full rounded-lg overflow-hidden border border-border bg-card transition-colors duration-200 hover-subtle-row hover:border-primary"
    >
      <Card
        variant="interactive"
        className="h-full border-0! bg-transparent! transition-colors duration-200 rounded-lg overflow-hidden relative"
      >
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              {/* A label, not a heading: inside the card the frame's title is the one heading,
                  and a Single's name wraps rather than clipping. */}
              <span className="block break-words font-semibold text-sm tracking-tight text-foreground transition-colors">
                {single.label || single.slug}
              </span>
              {single.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {single.description}
                </p>
              )}
            </div>
            <div className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export const SinglesQuickLinks: React.FC = () => {
  const {
    data: singlesData,
    isLoading,
    error,
    refetch,
  } = useSingles({ pagination: { page: 0, pageSize: 100 } });

  // A Single kept off the dashboard (internal, or hidden from the navigation) is not listed.
  const singles = (singlesData?.items ?? []).filter(
    single => !keptOffDashboard(single)
  );

  // Whether this card is offered at all is the HOST's decision, through the
  // `singles:present` condition on its declaration. It used to hide itself
  // here when the list was empty, and a card that renders nothing still holds
  // its placement -- so the grid reserved an empty slot on every install that
  // never used singles. The card draws what it has and never second-guesses
  // the host.
  // The card's frame draws its title, so this is only its body: the Singles, or the frame's
  // own skeleton and error while they are not there.
  if (isLoading) return <CardSkeleton shape="rows" />;
  if (error) {
    return (
      <CardError
        title="Singles"
        message="The Singles couldn't be loaded."
        onRetry={() => void refetch()}
      />
    );
  }
  // Nothing to list: the frame's empty state, so the card says what will appear rather than
  // drawing a blank body under its title.
  if (singles.length === 0) {
    // Only the first page is read, and the Singles it held may all be kept off the dashboard
    // while later pages hold some that are not. "No Singles yet" would then be false, so the card
    // says where they are instead.
    if (singlesData?.meta?.hasNext === true) {
      return (
        <CardEmpty
          title="Your Singles are in the full list"
          detail="This card shows the first ones, and none of them belong here."
          action={{ label: "Open Singles", href: ROUTES.SINGLES }}
        />
      );
    }
    return (
      <CardEmpty
        title="No Singles yet"
        detail="Singles you can edit appear here."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {singles.map(single => (
        <SingleCard key={single.id} single={single} />
      ))}
    </div>
  );
};
