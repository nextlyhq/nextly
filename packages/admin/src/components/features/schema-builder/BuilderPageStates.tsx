/**
 * The three screens a builder page shows instead of the builder: no slug in
 * the route, the entity still loading, and the entity failed to load.
 *
 * They are components rather than a single `<BuilderPage state={...}>` because
 * the pages must keep returning them from their own early guards — that is
 * what narrows `settings` and the loaded entity to non-null for everything
 * below, and a component that owned the branching would hand the page back a
 * nullable entity it has already proven is present.
 */
import { Skeleton } from "@nextlyhq/ui";
import type { ReactNode } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";

/**
 * Full-height centre stage shared by the two message screens. Not exported:
 * outside those two it is a `div` with no meaning of its own.
 */
function BuilderCenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      {children}
    </div>
  );
}

type BuilderNotFoundScreenProps = {
  /** Heading, e.g. "Collection Not Found". */
  title: string;
  /** Body copy naming what the route was missing. */
  description: string;
};

/**
 * Shown when the route carries no slug, so there is no entity to build against.
 * The copy is a prop because each builder kind names itself.
 */
export function BuilderNotFoundScreen({
  title,
  description,
}: BuilderNotFoundScreenProps) {
  return (
    <BuilderCenteredScreen>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </BuilderCenteredScreen>
  );
}

/**
 * Shown while the entity loads: a toolbar-shaped header over three field rows,
 * matching the layout the builder settles into so the page does not jump.
 */
export function BuilderLoadingScreen() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="p-6 border-b border-border">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex-1 p-4">
        <Skeleton className="h-12 w-full mb-2" />
        <Skeleton className="h-12 w-full mb-2" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

/**
 * Shown when the entity query failed, or resolved without the data the builder
 * needs. Carries no kind-specific copy — the fallback owns the message.
 */
export function BuilderErrorScreen() {
  return (
    <BuilderCenteredScreen>
      <PageErrorFallback />
    </BuilderCenteredScreen>
  );
}
