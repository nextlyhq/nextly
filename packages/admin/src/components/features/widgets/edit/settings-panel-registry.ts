/**
 * The card settings panels open now, and the one rule for opening one: one panel at a time. Apart
 * from the panel itself, so the dashboard's Save and its leave prompt ask about open panels
 * without loading the panel, which is fetched only when a reader first opens one.
 *
 * @module components/features/widgets/edit/settings-panel-registry
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { PanelKept } from "./panel-values";

/** An open panel, as the others and the dashboard ask about it. */
interface OpenPanel {
  /** Whether it holds a change Done has not kept. */
  holdsChanges: () => boolean;
  close: () => void;
  /** Ask the reader what to do with its change, and run `then` once it is kept or discarded. */
  askToLeave: (then: () => void) => void;
  /**
   * Its change as Done would keep it, `"invalid"` when Done would refuse it (the panel then
   * shows why), or `undefined` when it holds none.
   */
  stage: () => Promise<PanelKept | "invalid" | undefined>;
  /** Take focus on the first field its last refused staging named, if one was refused. */
  focusRefused: () => void;
}

/**
 * The panels open now, by placement.
 *
 * Non-modal panels do not close one another the way a modal one closes by being covered, so the
 * one rule for opening is kept here: ONE panel at a time. Another card's panel that holds nothing
 * unsaved closes for the new one; one holding a change keeps it, is brought forward asking what
 * to do with it, and the new one opens only once that is answered.
 */
const openPanels = new Map<string, OpenPanel>();
const panelListeners = new Set<() => void>();

function panelsChanged(): void {
  for (const listener of panelListeners) listener();
}

/**
 * Open the panel of `placementId` through `open`, one panel at a time: every opener of a card's
 * settings panel asks through this, so no panel opens over another holding a change.
 */
export function requestSettingsPanel(
  placementId: string,
  open: () => void
): void {
  const others = [...openPanels].filter(([id]) => id !== placementId);
  const holding = others.find(([, panel]) => panel.holdsChanges());
  if (holding !== undefined) {
    holding[1].askToLeave(open);
    return;
  }
  for (const [, panel] of others) panel.close();
  open();
}

/** One open panel's change, staged by the dashboard's prompt to be saved with the rest. */
export interface StagedPanel {
  placementId: string;
  kept: PanelKept;
}

/**
 * Every open panel's change as its Done would keep it, for the dashboard's prompt to save with
 * the rest while customising, or `"invalid"` when any panel's own checks refuse its change: that
 * panel then shows why, and nothing is to be saved until the reader fixes it or discards.
 */
export async function stagePendingPanels(): Promise<
  readonly StagedPanel[] | "invalid"
> {
  const staged: StagedPanel[] = [];
  for (const [placementId, panel] of openPanels) {
    const kept = await panel.stage();
    if (kept === "invalid") return "invalid";
    if (kept !== undefined) staged.push({ placementId, kept });
  }
  return staged;
}

/**
 * Bring forward the panel whose change the dashboard's prompt could not stage, with focus on the
 * first field it refused. Asked once that prompt has closed, after its own focus has gone back,
 * so the panel's is the focus that stays.
 */
export function bringRefusedPanelForward(): void {
  window.setTimeout(() => {
    for (const panel of openPanels.values()) panel.focusRefused();
  }, 0);
}

/**
 * Discard every open panel's change, by closing it: a panel rebuilds its form and title from
 * what is stored once closed. The dashboard's Cancel asks this, so "Changes discarded" holds for
 * a panel's change as well as the draft's, and no Done is left to keep one after it.
 */
export function discardOpenPanels(): void {
  for (const panel of openPanels.values()) panel.close();
}

function subscribePanels(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => {
    panelListeners.delete(listener);
  };
}

function anyPanelHoldsChanges(): boolean {
  return [...openPanels.values()].some(panel => panel.holdsChanges());
}

/**
 * Whether an open settings panel holds a change Done has not kept: what the dashboard's own leave
 * prompt also asks about while customising, where a panel leaves the asking to it.
 */
export function useSettingsPanelHoldsChanges(): boolean {
  return useSyncExternalStore(
    subscribePanels,
    anyPanelHoldsChanges,
    () => false
  );
}

export function useOnePanelOpen(
  placementId: string,
  open: boolean,
  holdsChanges: boolean,
  handlers: Pick<OpenPanel, "close" | "askToLeave" | "stage" | "focusRefused">
) {
  const changes = useRef(holdsChanges);
  changes.current = holdsChanges;
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!open) return undefined;
    openPanels.set(placementId, {
      holdsChanges: () => changes.current,
      close: () => latest.current.close(),
      askToLeave: then => latest.current.askToLeave(then),
      stage: () => latest.current.stage(),
      focusRefused: () => latest.current.focusRefused(),
    });
    panelsChanged();
    return () => {
      openPanels.delete(placementId);
      panelsChanged();
    };
  }, [open, placementId]);
  // The dashboard's leave prompt follows whether this panel holds a change as it changes.
  useEffect(() => {
    if (open) panelsChanged();
  }, [open, holdsChanges]);
}
