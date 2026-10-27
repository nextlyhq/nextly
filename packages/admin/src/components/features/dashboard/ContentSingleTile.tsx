"use client";

/**
 * One Single on the Content card: its name, its description when the Singles list has one, and
 * its icon, linking to the Single itself (a Single is one document, so there is no list to go
 * through first). A Single has no entries, so unlike a collection's tile it carries no count.
 *
 * @module components/features/dashboard/ContentSingleTile
 */

import { Card, CardContent } from "@nextlyhq/ui";
import { FileText } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import type { ApiSingle } from "@admin/types/entities";

export function ContentSingleTile({
  slug,
  label,
  single,
}: {
  slug: string;
  label: string;
  /** The Single as the Singles list describes it, for its icon and description, once known. */
  single?: ApiSingle;
}): React.JSX.Element {
  const Icon = useMemo(() => {
    const configured = single?.admin?.icon;
    if (configured) {
      const Found = (Icons as Record<string, React.ElementType>)[configured];
      if (Found) return Found;
    }
    return FileText;
  }, [single?.admin?.icon]);

  return (
    <Link
      href={buildRoute(ROUTES.SINGLE_EDIT, { slug })}
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
              {/* A label, not a heading: the frame's title is the card's one heading, and a
                  Single's name wraps rather than clipping. */}
              <span className="block break-words font-semibold text-sm tracking-tight text-foreground transition-colors">
                {label}
              </span>
              {single?.description && (
                // Shortened to two lines, with the whole text on hover (`title`) and to assistive
                // technology, which reads the element's full text.
                <p
                  className="text-xs text-muted-foreground line-clamp-2 leading-relaxed"
                  title={single.description}
                >
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
