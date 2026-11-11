"use client";

/**
 * What a place draws where a contribution's component cannot be found: a
 * plugin's module not in the generated component map, or a path nothing
 * registered. Shown rather than an empty space, so a broken contribution is
 * noticed; it names nothing of the plugin's, since a reader may see it. The
 * registry warns in development, naming the path, for whoever can fix it.
 *
 * @module components/shared/target-slot/PlaceContributionFallback
 */
import type { ReactNode } from "react";

import { useT } from "@admin/lib/i18n/I18nProvider";

export function PlaceContributionFallback(): ReactNode {
  const t = useT();
  return (
    <p
      role="status"
      className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
    >
      {t("nextly.places.unavailable")}
    </p>
  );
}
