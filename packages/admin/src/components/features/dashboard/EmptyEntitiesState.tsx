"use client";

import { Button } from "@nextlyhq/ui";

import { Database, FileText, Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface EmptyEntitiesStateProps {
  /** Which entity kind is empty — drives copy + CTA destination. */
  type: "collection" | "single";
}

/**
 * Rendered by the `/admin/collections` and `/admin/singles` index
 * redirects when zero items exist. Replaces the previous 404 fallback
 * with a guided empty state that points the user at the visual
 * builder so they can create their first entity in one click.
 */
export function EmptyEntitiesState({ type }: EmptyEntitiesStateProps) {
  const isCollection = type === "collection";
  const Icon = isCollection ? Database : FileText;
  const heading = isCollection ? "No collections yet" : "No singles yet";
  const subText = isCollection
    ? "Create your first collection to start organising your content."
    : "Create your first single to start managing one-off pages.";
  const ctaLabel = isCollection ? "Create collection" : "Create single";
  // Builder routes confirmed in `constants/routes.ts`:
  // BUILDER_COLLECTIONS_NEW = "/admin/builder/collections/new"
  // BUILDER_SINGLES_NEW     = "/admin/builder/singles/new"
  const ctaHref = isCollection
    ? ROUTES.BUILDER_COLLECTIONS_NEW
    : ROUTES.BUILDER_SINGLES_NEW;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          {heading}
        </h2>
        <p className="mb-8 text-sm text-muted-foreground">{subText}</p>
        <Button asChild>
          <Link href={ctaHref}>
            <Plus className="mr-2 h-4 w-4" />
            {ctaLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
