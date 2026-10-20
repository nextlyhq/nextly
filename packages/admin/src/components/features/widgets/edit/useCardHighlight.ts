/**
 * The one card the dashboard rings while customising, so the reader sees where a card landed.
 *
 * One state for every gesture that places a card (an add, a removed card put back), so two
 * rings never show at once: placing a card moves the ring to it.
 *
 * @module components/features/widgets/edit/useCardHighlight
 */

import { useState } from "react";

export interface CardHighlight {
  /** The ringed card's placement, or none. */
  highlightedId: string | null;
  highlight: (placementId: string | null) => void;
}

/**
 * The ring follows the mode: leaving customise mode drops it, adjusted during render (React's
 * pattern for state that follows a prop), so no frame after Save or Cancel still rings a card.
 */
export function useCardHighlight(isEditing: boolean): CardHighlight {
  const [highlightedId, highlight] = useState<string | null>(null);
  const [mode, setMode] = useState(isEditing);
  if (mode !== isEditing) {
    setMode(isEditing);
    highlight(null);
  }
  return { highlightedId, highlight };
}
