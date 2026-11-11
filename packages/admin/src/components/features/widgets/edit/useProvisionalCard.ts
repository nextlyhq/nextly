/**
 * The card the add panel added as one the reader already has: a widget that reads a collection,
 * added when every collection it may read already has its card. It starts as a copy of one of
 * them, so its settings drawer opens at once for the reader to tell it apart, and it is kept only
 * once its settings no longer match another card of its widget. Closing the drawer without
 * saving takes it back off the dashboard, as if it had never been added.
 *
 * @module components/features/widgets/edit/useProvisionalCard
 */

import type { PublishedContentSource } from "nextly/config";
import { useCallback, useRef, useState } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { sameConfig } from "../layout-editor";
import { settingsAsAsked } from "../widget-as-asked";

import type { SaveOptions, SaveOutcome } from "./useLayoutLifecycle";

/** No card on probation. */
const NONE: ReadonlySet<string> = new Set();

/** What the drawer's Save says while the card still matches another one. */
export const MATCHES_A_CARD =
  "This matches a card you already have. Change a setting first.";

/** The cards on probation, and what their drawers do with them. */
export interface ProvisionalCard {
  /**
   * The cards added as one the reader already has and neither kept nor taken off yet. Usually
   * one; another can be added while the first's drawer is open, since that drawer leaves the
   * dashboard usable, and each stays on probation until its own drawer settles it.
   */
  ids: ReadonlySet<string>;
  /** The add panel added `placementId` as one the reader already has. */
  start: (placementId: string) => void;
  /**
   * Why the card cannot be kept with these settings and this title, or `undefined` when it can:
   * it matches another card of its widget, setting for setting, as each card is asked.
   */
  refusal: (
    placementId: string,
    config: Record<string, unknown>,
    ownTitle: string | undefined
  ) => string | undefined;
  /** Its settings were saved: it stays. */
  keep: (placementId: string) => void;
  /** Its drawer closed: unless it was kept, it goes. */
  closed: (placementId: string) => void;
}

/** Whether `config` and `title` ask what `other` asks, setting for setting. */
function asksTheSame(
  widget: DashboardWidget,
  other: WidgetPlacement,
  config: Record<string, unknown>,
  title: string,
  sources: readonly PublishedContentSource[] | undefined
): boolean {
  return (
    (other.title ?? "") === title &&
    sameConfig(
      settingsAsAsked(widget, other.config, sources),
      settingsAsAsked(widget, config, sources)
    )
  );
}

export function useProvisionalCard({
  isEditing,
  placements,
  byId,
  sources,
  discard,
}: {
  isEditing: boolean;
  placements: readonly WidgetPlacement[];
  byId: ReadonlyMap<string, DashboardWidget>;
  sources: readonly PublishedContentSource[] | undefined;
  /** Take the card out of the draft altogether. */
  discard: (placementId: string) => void;
}): ProvisionalCard {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  // Read by a drawer's close, which runs in the same task as its Save: the state set by `keep`
  // has not been drawn yet, so the ref is what tells the two apart.
  const pending = useRef<Set<string>>(new Set());
  // Drawn from the ref, the one record of which cards are still on probation.
  const publish = useCallback(() => setIds(new Set(pending.current)), []);
  // Customise mode ended (Save or Cancel): nothing is on probation any more. Adjusted during
  // render (React's pattern for state that follows a prop). A drawer still open past it, and
  // closed later, discards from no draft, which changes nothing.
  const [mode, setMode] = useState(isEditing);
  if (mode !== isEditing) {
    setMode(isEditing);
    setIds(NONE);
  }

  const start = useCallback(
    (placementId: string) => {
      pending.current.add(placementId);
      publish();
    },
    [publish]
  );

  const refusal = useCallback(
    (
      placementId: string,
      config: Record<string, unknown>,
      ownTitle: string | undefined
    ): string | undefined => {
      const card = placements.find(p => p.id === placementId);
      const widget = card === undefined ? undefined : byId.get(card.widgetId);
      if (card === undefined || widget === undefined) return undefined;
      const title = (ownTitle ?? card.title ?? "").trim();
      const matches = placements.some(
        other =>
          other.id !== placementId &&
          other.widgetId === card.widgetId &&
          !other.removed &&
          asksTheSame(widget, other, config, title, sources)
      );
      return matches ? MATCHES_A_CARD : undefined;
    },
    [placements, byId, sources]
  );

  const keep = useCallback(
    (placementId: string) => {
      if (pending.current.delete(placementId)) publish();
    },
    [publish]
  );

  const closed = useCallback(
    (placementId: string) => {
      if (!pending.current.delete(placementId)) return;
      publish();
      discard(placementId);
    },
    [discard, publish]
  );

  return { ids, start, refusal, keep, closed };
}

/**
 * The dashboard's Save, leaving out each provisional card that still matches another card: its
 * drawer holds no change, or one that still matches. A change that tells it apart is saved with
 * the rest, as the drawer's own Save would keep it.
 */
export function useSaveLeavingOut(
  save: (options?: SaveOptions) => Promise<SaveOutcome>,
  provisional: Pick<ProvisionalCard, "ids" | "refusal">
): (options?: SaveOptions) => Promise<SaveOutcome> {
  const { ids, refusal } = provisional;
  return useCallback(
    (options?: SaveOptions) => {
      const leaveOut = [...ids].filter(id => {
        const change = options?.staged?.find(each => each.placementId === id);
        return (
          change === undefined ||
          refusal(id, change.config, change.ownTitle) !== undefined
        );
      });
      return leaveOut.length === 0
        ? save(options)
        : save({ ...options, leaveOut });
    },
    [save, ids, refusal]
  );
}

/**
 * The provisional card for the dashboard (`useProvisionalCard`), and its Save, which leaves that
 * card out until it is told apart (`useSaveLeavingOut`).
 */
export function useProvisionalDashboard(args: {
  editor: { isEditing: boolean; placements: readonly WidgetPlacement[] } & {
    discard: (placementId: string) => void;
  };
  byId: ReadonlyMap<string, DashboardWidget>;
  save: (options?: SaveOptions) => Promise<SaveOutcome>;
}) {
  const { editor } = args;
  // The reader's collections, which each card's settings are read against.
  const sources = useBranding().widgetSources;
  const provisional = useProvisionalCard({
    isEditing: editor.isEditing,
    placements: editor.placements,
    byId: args.byId,
    sources,
    discard: editor.discard,
  });
  const save = useSaveLeavingOut(args.save, provisional);
  return { provisional, save };
}
