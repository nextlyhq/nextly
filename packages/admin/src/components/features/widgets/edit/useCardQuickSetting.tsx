"use client";

/**
 * The quick setting of one card at rest: what it draws in the header, what a change writes, and
 * when the change is announced.
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

import { resolveWidgetSettings } from "nextly/config";
import { useEffect, useState, type ReactNode } from "react";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { widgetAsAsked } from "../widget-as-asked";

import { CardQuickSetting } from "./CardQuickSetting";
import {
  quickSettingOf,
  quickValueLabel,
  type QuickSetting,
} from "./quick-setting";
import { initialValues, toStoredConfig } from "./WidgetSettingsSheet";

/** How a cell at rest saves its card's settings, bound to that card by the grid. */
export interface CellSettingsWrite {
  write: (
    config: Record<string, unknown>,
    callbacks: { onLanded: () => void; onFailed: () => void }
  ) => void;
  /** A layout write is in flight anywhere on the dashboard. */
  isWriting: boolean;
  /** Why the card's settings cannot be saved now, when they cannot. */
  unavailable?: string;
  /**
   * Say that one of the card's settings changed, once its request has ended: `shown` when the
   * card shows the change, false when its new answer was refused and it kept the one it had.
   */
  announce: (setting: string, value: string, shown: boolean) => void;
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
}

/** Whether `config` changes what the card asks, compared with `current`. */
function changesQuery(
  widget: DashboardWidget,
  current: Record<string, unknown> | undefined,
  config: Record<string, unknown>
): boolean {
  return (
    JSON.stringify(widgetAsAsked(widget, current).query) !==
    JSON.stringify(widgetAsAsked(widget, config).query)
  );
}

/** A card's quick setting, for the controls that change it: the header's and the menu's. */
export interface CardQuickSettingState {
  /** Drawn in the card's header; the frame decides when. */
  inline: ReactNode;
  /** For the card's menu, which offers it at every size. */
  menu: {
    setting: QuickSetting;
    value: unknown;
    change: (next: string | boolean) => void;
  };
}

export function useCardQuickSetting(args: {
  /** The widget as declared, before its settings apply. */
  widget: DashboardWidget;
  config: Record<string, unknown> | undefined;
  isEditing: boolean;
  /** This card's own request is in flight. */
  isFetching: boolean;
  /** When the answer this card shows arrived. */
  updatedAt: Date | null;
  /** Absent while customising, and before an arrangement has been read. */
  settingsWrite: CellSettingsWrite | undefined;
}): Partial<CardQuickSettingState> {
  const { widget, config, isEditing, isFetching, settingsWrite } = args;
  const shownAt = args.updatedAt?.getTime() ?? null;
  const [pending, setPending] = useState<PendingAnnouncement | null>(null);

  // Announced once the card shows the change; see the module note.
  useEffect(() => {
    if (!pending || !settingsWrite) return;
    if (pending.asksAgain && !pending.seenFetching) {
      if (isFetching) setPending({ ...pending, seenFetching: true });
      return;
    }
    if (isFetching) return;
    // A refused quiet re-ask keeps the answer the card had, and its time with it: the card does
    // not show the change, so it is said as saved but not shown. Only an answer that arrived
    // after the change shows it.
    settingsWrite.announce(
      pending.setting,
      pending.value,
      !pending.asksAgain || shownAt !== pending.shownAt
    );
    setPending(null);
  }, [pending, isFetching, shownAt, settingsWrite]);

  const quick = quickSettingOf(widget.settings);
  // Nothing to draw: no quick setting, or nowhere to save one.
  if (isEditing || !settingsWrite || !quick) return {};
  const settings = widget.settings ?? [];
  const value = resolveWidgetSettings(settings, config)[quick.name];
  const label = quick.label ?? quick.name;

  // One write for both controls: the stored settings with this one changed, only what departs
  // from a default kept, announced once the card shows it.
  const change = (next: string | boolean, reverted: () => void = () => {}) => {
    const values = { ...initialValues(settings, config), [quick.name]: next };
    const stored = toStoredConfig(settings, values, config);
    const asksAgain = changesQuery(widget, config, stored);
    settingsWrite.write(stored, {
      onLanded: () =>
        setPending({
          setting: label,
          value: quickValueLabel(quick, next),
          asksAgain,
          seenFetching: false,
          shownAt,
        }),
      onFailed: reverted,
    });
  };

  return {
    inline: (
      <CardQuickSetting
        setting={quick}
        value={value}
        cardTitle={widget.title}
        disabled={settingsWrite.isWriting}
        {...(settingsWrite.unavailable === undefined
          ? {}
          : { unavailable: settingsWrite.unavailable })}
        onChange={change}
      />
    ),
    menu: { setting: quick, value, change },
  };
}
