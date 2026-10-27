/**
 * The write a reader makes to ONE card outside customise mode: dismissing it,
 * or changing its settings.
 *
 * The whole arrangement travels with one card changed, under the read's own
 * `version` and `scope`, so a write raced against another tab is refused
 * rather than overwriting it. It is sent with `arranged: false`: changing one
 * card is not taking charge of the dashboard, and a write that claimed to be
 * an arrangement would stop every widget declared afterwards from reaching
 * this reader.
 *
 * @module components/features/widgets/edit/single-card-write
 */

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

/** The single-card write: the whole list with one card changed, not arranged. */
export function singleCardWrite(
  stored: DashboardLayoutResponse,
  placements: WidgetPlacement[]
): {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
  arranged: boolean;
} {
  return {
    placements,
    version: stored.version,
    scope: stored.scope,
    arranged: false,
  };
}

/**
 * Whether the arrangement the client now HOLDS shows the card as intended.
 *
 * 🔴 The write's own success says the SERVER accepted it; the grid draws the
 * cache, and the re-read that fills it can fail on its own --
 * `invalidateQueries` swallows that and resolves anyway. Read synchronously,
 * and safely: the write's `onSuccess` returns the invalidation, and TanStack
 * awaits it before a `mutate` callback runs.
 */
export function landed(
  layout: UseDashboardLayoutResult,
  placementId: string,
  intended: (placement: WidgetPlacement) => boolean
): boolean {
  const settled = layout.cached()?.placements.find(p => p.id === placementId);
  return settled !== undefined && intended(settled);
}
