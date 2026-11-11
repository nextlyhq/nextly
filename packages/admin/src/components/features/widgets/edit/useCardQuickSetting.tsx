"use client";

/**
 * A card's quick setting: the one its header draws at rest (`quick-setting`). Customise mode
 * draws none; there every setting is changed in the card's settings drawer.
 *
 * A change is saved at once, for this reader, through the single-card write, and the toast that
 * says so offers Undo, which writes back what the card had just before that change. The toast is
 * the one place the change is said: its region is polite, and the grid's own live region stays
 * silent for it, so a screen reader hears it once. The control shows the chosen value at once,
 * and goes back to the stored one if the save does not land.
 *
 * Announced once the card SHOWS it, not when the write lands: a change that alters the card's
 * query is asked again for this card alone, and saying "set to" while the old answer is still on
 * screen would describe a card the reader cannot see yet. A change the query does not read
 * (a custom card reading its settings itself) is announced as soon as it lands. A change whose
 * re-ask was refused is still announced, as saved but not shown: the save did land, and a reader
 * who hears nothing cannot tell whether it did.
 *
 * @module components/features/widgets/edit/useCardQuickSetting
 */

import {
  resolveWidgetSettings,
  type AnyWidgetSetting,
  type GridSize,
  type PublishedContentSource,
} from "nextly/config";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { toast } from "@admin/components/ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { settingChangedSentence } from "../useGridAnnouncer";
import { questionOf } from "../widget-as-asked";

import { CardQuickSetting } from "./CardQuickSetting";
import { dependentsOf, startingValue } from "./content-settings";
import { initialValues, toStoredConfig } from "./panel-values";
import {
  quickSettingOf,
  quickValueLabel,
  type QuickSetting,
} from "./quick-setting";
import type { CardSettingsWriteCallbacks } from "./useCardSettingsWrite";

/** How a cell at rest saves its card's settings, bound to that card by the grid. */
export interface CellSettingsWrite {
  /**
   * Save the card's settings at once, its own title where `ownTitle` is given, and its width
   * where `size` is: one write, so the card never shows half of a change.
   */
  write: (
    config: Record<string, unknown>,
    callbacks: CardSettingsWriteCallbacks,
    ownTitle?: string,
    size?: GridSize
  ) => void;
  /** A layout write is in flight anywhere on the dashboard. */
  isWriting: boolean;
  /** Why the card's settings cannot be saved now, when they cannot. */
  unavailable?: string;
}

/** A card's quick setting, for the control that changes it. */
interface CardQuickSettingState {
  /** Drawn in the card's header at rest; the frame decides when. */
  inline?: ReactNode;
}

interface PendingAnnouncement {
  setting: string;
  value: string;
  /** The change asks the card again, so the announcement waits for that answer. */
  asksAgain: boolean;
  /** The card's re-ask has been seen in flight. */
  seenFetching: boolean;
  /** When the answer on screen as the change was made arrived, so a new one can be told apart. */
  shownAt: number | null;
  /** Puts back what the card had before the change, offered with it; absent for an Undo's own. */
  undo?: (() => void) | undefined;
}

/** How long a change's toast, and its Undo, stays: long enough to find the button. */
const UNDO_SHOWN_MS = 10_000;

/**
 * Whether `config` changes what the card asks, compared with `current`: its settings are what its
 * widget's `load` reads, so any change of them asks again.
 */
function changesQuery(
  current: Record<string, unknown> | undefined,
  config: Record<string, unknown>
): boolean {
  return questionOf(current) !== questionOf(config);
}

/**
 * The settings to store when one quick setting changes to `next`: the stored ones with it
 * changed, and only what departs from a default kept, as the sheet's Done stores them. A new
 * collection resets the settings that work over it to where each starts on that collection, as
 * the sheet does, so no filter or sort names a field the new collection lacks.
 */
function quickChangeConfig(
  settings: readonly AnyWidgetSetting[],
  config: Record<string, unknown> | undefined,
  name: string,
  next: string | boolean,
  sources: readonly PublishedContentSource[] | undefined
): Record<string, unknown> {
  const values = initialValues(settings, config);
  const changed = values[name] !== next;
  values[name] = next;
  if (changed) {
    for (const dependent of dependentsOf(settings, name)) {
      values[dependent.name] = startingValue(dependent, next, sources);
    }
  }
  return toStoredConfig(settings, values, config);
}

/**
 * What Undo of one quick setting stores: the card's settings as they are NOW, with that setting,
 * and the settings that work over it, put back as they were before the change. Only those: a
 * later save of another of the card's settings, from the sheet say, is the reader's too, and
 * putting back the whole earlier config would quietly undo it.
 */
function undoneConfig(
  settings: readonly AnyWidgetSetting[],
  current: Record<string, unknown> | undefined,
  previous: Record<string, unknown>,
  name: string
): Record<string, unknown> {
  const values = initialValues(settings, current);
  const before = initialValues(settings, previous);
  for (const each of [name, ...dependentsOf(settings, name).map(d => d.name)]) {
    values[each] = before[each];
  }
  return toStoredConfig(settings, values, current);
}

/** The one toast a card's changes share, which entering customise mode takes down. */
function changeToastId(placementId: string): string {
  return `card-change-${placementId}`;
}

/**
 * Say a change, in the grid's own sentence (`settingChangedSentence`), with Undo where it has
 * one. One toast per card, so a later change replaces the earlier one's: Undo always puts back
 * what the card had just before the latest change, and an Undo's own toast takes the button away.
 */
function tellChange(
  placementId: string,
  sentence: string,
  undo: (() => void) | undefined
) {
  toast.success(sentence, {
    id: changeToastId(placementId),
    duration: UNDO_SHOWN_MS,
    ...(undo ? { action: { label: "Undo", onClick: undo } } : {}),
  });
}

/**
 * What a pending announcement does now: wait for the card's answer, note that its re-ask is in
 * flight, or be said.
 */
function announcementStep(
  pending: PendingAnnouncement,
  isFetching: boolean,
  shownAt: number | null
): "wait" | "seen" | "say" {
  const awaitsReask = pending.asksAgain && !pending.seenFetching;
  if (isFetching) return awaitsReask ? "seen" : "wait";
  if (!awaitsReask) return "say";
  // An answer newer than the one shown as the change was made means the re-ask has already
  // finished: the write waits for the invalidation that starts it, so it can end before the
  // change is pending here, and waiting to see it in flight would wait for good. No answer at
  // all is not a newer one.
  return shownAt === null || shownAt === pending.shownAt ? "wait" : "say";
}

/** The announcement once the card shows it, in its toast; see the module note. */
function useAnnouncement(
  pending: PendingAnnouncement | null,
  setPending: (pending: PendingAnnouncement | null) => void,
  card: { placementId: string; title: string; isFetching: boolean },
  shownAt: number | null,
  settingsWrite: CellSettingsWrite | undefined
) {
  const { placementId, title, isFetching } = card;
  useEffect(() => {
    if (!pending || !settingsWrite) return;
    const step = announcementStep(pending, isFetching, shownAt);
    if (step === "seen") setPending({ ...pending, seenFetching: true });
    if (step !== "say") return;
    // A refused quiet re-ask keeps the answer the card had, and its time with it: the card does
    // not show the change, so it is said as saved but not shown. Only an answer that arrived
    // after the change shows it.
    tellChange(
      placementId,
      settingChangedSentence(
        title,
        pending.setting,
        pending.value,
        !pending.asksAgain || shownAt !== pending.shownAt
      ),
      pending.undo
    );
    setPending(null);
  }, [
    pending,
    setPending,
    isFetching,
    shownAt,
    settingsWrite,
    placementId,
    title,
  ]);
}

/** What a change to one card needs: the card, where it is kept, and how the controls follow. */
interface ChangeContext {
  placementId: string;
  title: string;
  settings: readonly AnyWidgetSetting[];
  config: Record<string, unknown> | undefined;
  /** The card's stored settings as they are when asked, which a later save may have changed. */
  latestConfig: () => Record<string, unknown> | undefined;
  sources: readonly PublishedContentSource[] | undefined;
  atRest: CellSettingsWrite;
  /** Say the change once the card shows it, offering `undo` with it. */
  announceLater: (
    setting: string,
    value: string,
    asksAgain: boolean,
    undo?: () => void
  ) => void;
}

/** The quick setting changed to `next`: saved at once, with Undo. */
function changeSetting(
  ctx: ChangeContext,
  setting: QuickSetting,
  next: string | boolean,
  reverted: () => void
) {
  const { settings, config, sources, atRest } = ctx;
  const stored = quickChangeConfig(
    settings,
    config,
    setting.name,
    next,
    sources
  );
  const label = setting.label ?? setting.name;
  // Captured now: Undo puts back what this setting was just before THIS change.
  const previous = config ?? {};
  const asksAgain = changesQuery(config, stored);
  const said = (value: unknown) => quickValueLabel(setting, value);
  atRest.write(stored, {
    onLanded: () =>
      ctx.announceLater(label, said(next), asksAgain, () =>
        atRest.write(
          undoneConfig(settings, ctx.latestConfig(), previous, setting.name),
          {
            onLanded: () =>
              ctx.announceLater(
                label,
                said(resolveWidgetSettings(settings, previous)[setting.name]),
                asksAgain
              ),
          }
        )
      ),
    onFailed: () => reverted(),
  });
}

/** The header's quick control at rest, where the widget marks one the header can draw. */
function inlineControl(
  ctx: ChangeContext,
  resolved: Readonly<Record<string, unknown>>
): ReactNode | undefined {
  const quick = quickSettingOf(ctx.settings);
  const { atRest } = ctx;
  if (!quick) return undefined;
  return (
    <CardQuickSetting
      setting={quick}
      value={resolved[quick.name]}
      cardTitle={ctx.title}
      disabled={atRest.isWriting}
      {...(atRest.unavailable === undefined
        ? {}
        : { unavailable: atRest.unavailable })}
      onChange={(next, reverted) => changeSetting(ctx, quick, next, reverted)}
    />
  );
}

/**
 * Whether an Undo the card offered may still write, kept by the card for the Undo it captures.
 *
 * An Undo is an at-rest write. Once customising begins the draft holds the card, and a write
 * underneath it would move the stored version the draft's Save is checked against, so the
 * card's toast goes, one not yet said is dropped, and an Undo pressed anyway does nothing.
 * Remove's notice is cleared on the same change of mode by its own owner.
 *
 * The card's toast also goes with the card, and its Undo does nothing once the card is gone: a
 * card removed at rest leaves without a change of mode, and an Undo pressed after it would write
 * the removed card's old setting back.
 */
function useUndoLive(
  isEditing: boolean,
  placementId: string,
  setPending: (pending: PendingAnnouncement | null) => void
): () => boolean {
  const editing = useRef(isEditing);
  useEffect(() => {
    editing.current = isEditing;
    if (!isEditing) return;
    toast.dismiss(changeToastId(placementId));
    setPending(null);
  }, [isEditing, placementId, setPending]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      toast.dismiss(changeToastId(placementId));
    };
  }, [placementId]);
  return () => active.current && !editing.current;
}

/** `undo`, doing nothing once `live` says the card's Undo may no longer write. */
function whileLive(undo: () => void, live: () => boolean): () => void {
  return () => {
    if (live()) undo();
  };
}

export function useCardQuickSetting(args: {
  placementId: string;
  /** The widget as declared, before its settings apply. */
  widget: DashboardWidget;
  /** The card's title as drawn, which the controls' names and the toast say. */
  title: string;
  config: Record<string, unknown> | undefined;
  isEditing: boolean;
  /** This card's own request is in flight. */
  isFetching: boolean;
  /** When the answer this card shows arrived. */
  updatedAt: Date | null;
  /** Absent while customising, and before an arrangement has been read. */
  settingsWrite: CellSettingsWrite | undefined;
}): CardQuickSettingState {
  const { isEditing, settingsWrite } = args;
  // The same collections the grid asked the card with, so a change is judged
  // against the query the card actually sent.
  const sources = useBranding().widgetSources;
  const shownAt = args.updatedAt?.getTime() ?? null;
  const [pending, setPending] = useState<PendingAnnouncement | null>(null);
  useAnnouncement(
    pending,
    setPending,
    {
      placementId: args.placementId,
      title: args.title,
      isFetching: args.isFetching,
    },
    shownAt,
    settingsWrite
  );
  // The stored settings as last drawn, for an Undo pressed after a later save. Kept after each
  // commit: Undo is pressed later, never while the card is drawing.
  const latestConfig = useRef(args.config);
  useEffect(() => {
    latestConfig.current = args.config;
  });
  const undoLive = useUndoLive(isEditing, args.placementId, setPending);
  // Drawn at rest alone, once an arrangement has been read: there is a stored card to save to.
  if (isEditing || !settingsWrite) return {};
  const settings = args.widget.settings ?? [];
  const ctx: ChangeContext = {
    placementId: args.placementId,
    title: args.title,
    settings,
    config: args.config,
    latestConfig: () => latestConfig.current,
    sources,
    atRest: settingsWrite,
    announceLater: (setting, value, asksAgain, undo) =>
      setPending({
        setting,
        value,
        asksAgain,
        seenFetching: false,
        shownAt,
        undo: undo && whileLive(undo, undoLive),
      }),
  };
  const resolved = resolveWidgetSettings(settings, args.config);
  const inline = inlineControl(ctx, resolved);
  return inline ? { inline } : {};
}
