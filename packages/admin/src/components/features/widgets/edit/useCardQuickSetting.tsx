"use client";

/**
 * A card's quick settings: the one its header draws at rest, and the quick popover, which holds
 * its Collection, the settings its widget marks quick and its Size (`quick-setting`).
 *
 * At rest a change is saved at once, for this reader, through the single-card write, and the
 * toast that says so offers Undo, which writes back what the card had just before that change.
 * The toast is the one place the change is said: its region is polite, and the grid's own live
 * region stays silent for it, so a screen reader hears it once.
 * While customising it is staged in the draft with the session's other changes and saved with
 * them, as the customise menu's own changes are. Either way the control shows the chosen value at
 * once, and goes back to the stored one if the save does not land.
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
  type WidgetSizeBounds,
} from "nextly/config";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { toast } from "@admin/components/ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { sizeName } from "../sizes";
import { settingChangedSentence } from "../useGridAnnouncer";
import { askableWith, questionOf } from "../widget-as-asked";

import { sizeAxes } from "./CardActionsMenu";
import { CardQuickSetting } from "./CardQuickSetting";
import { dependentsOf, startingValue } from "./content-settings";
import { collectionOptions } from "./ContentSettingControl";
import {
  popoverSettingsOf,
  quickSettingOf,
  quickValueLabel,
  type PopoverSetting,
} from "./quick-setting";
import type { CardSettingsWriteCallbacks } from "./useCardSettingsWrite";
import { initialValues, toStoredConfig } from "./WidgetSettingsSheet";

/** How a cell at rest saves its card's settings and size, bound to that card by the grid. */
export interface CellSettingsWrite {
  write: (
    config: Record<string, unknown>,
    callbacks: CardSettingsWriteCallbacks
  ) => void;
  /** Save the card's size at once; absent where only its settings can be written. */
  resize?: (size: GridSize, callbacks: CardSettingsWriteCallbacks) => void;
  /** A layout write is in flight anywhere on the dashboard. */
  isWriting: boolean;
  /** Why the card's settings cannot be saved now, when they cannot. */
  unavailable?: string;
}

/** How a cell stages its card's changes while customising: in the draft, kept until Save. */
export interface CellStagedWrite {
  config: (config: Record<string, unknown>) => void;
  size: (size: GridSize) => void;
  /** A layout write is in flight, which every customise control waits for. */
  isWriting: boolean;
}

/** What the quick popover draws and what its controls do; see `CardQuickPopover`. */
export interface CardQuickPopoverModel {
  /** Its settings, in the order drawn (`popoverSettingsOf`). */
  settings: readonly PopoverSetting[];
  /** Each setting's value as the card uses it, a change not yet landed shown at once. */
  values: Readonly<Record<string, unknown>>;
  /** The collections a Collection setting offers: the sheet's own choices (`collectionOptions`). */
  collections: readonly { label: string; value: string }[];
  /** The card's size and its widget's bounds, where it may be resized from the popover. */
  size?: { size: GridSize; bounds: WidgetSizeBounds };
  changeSetting: (setting: PopoverSetting, next: string | boolean) => void;
  changeSize: (size: GridSize) => void;
  /** A write is in flight, so every control waits. */
  disabled: boolean;
  /** Why a change cannot be saved now, when it cannot. */
  unavailable?: string;
}

/** A card's quick settings, for the controls that change them: the header's and the popover's. */
interface CardQuickSettingState {
  /** Drawn in the card's header at rest; the frame decides when. */
  inline?: ReactNode;
  /** The quick popover, where the card has anything for it to hold. */
  popover?: CardQuickPopoverModel;
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

/** What the controls show ahead of a save landing, until the stored card changes. */
interface Shown {
  values?: Record<string, unknown>;
  size?: GridSize;
}

/** How long a change's toast, and its Undo, stays: long enough to find the button. */
const UNDO_SHOWN_MS = 10_000;

/** Whether `config` changes what the card asks, compared with `current`. */
function changesQuery(
  widget: DashboardWidget,
  current: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
  sources: readonly PublishedContentSource[] | undefined
): boolean {
  return (
    questionOf(widget, current, sources) !== questionOf(widget, config, sources)
  );
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

/** What the reader is told a popover setting's value now is. */
function valueLabel(
  setting: PopoverSetting,
  value: unknown,
  sources: readonly PublishedContentSource[] | undefined
): string {
  if (setting.type === "collection") {
    return (
      sources?.find(source => source.collection === value)?.label ??
      String(value)
    );
  }
  return quickValueLabel(setting, value);
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
    id: `card-change-${placementId}`,
    duration: UNDO_SHOWN_MS,
    ...(undo ? { action: { label: "Undo", onClick: undo } } : {}),
  });
}

/** The collections a card's Collection setting offers: those it can be asked of, as in the sheet. */
function offeredCollections(
  widget: DashboardWidget,
  settings: readonly PopoverSetting[],
  sources: readonly PublishedContentSource[] | undefined
): { label: string; value: string }[] {
  const collection = settings.find(setting => setting.type === "collection");
  if (collection?.type !== "collection") return [];
  return collectionOptions(
    collection,
    (sources ?? []).filter(source =>
      askableWith(
        widget,
        { [collection.name]: source.collection },
        sources ?? undefined
      )
    )
  );
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
    if (pending.asksAgain && !pending.seenFetching) {
      if (isFetching) setPending({ ...pending, seenFetching: true });
      return;
    }
    if (isFetching) return;
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

/**
 * What the controls show ahead of the save, cleared whenever the stored card changes: the stored
 * values take over again once a change lands, and a failed one goes back to them.
 */
function useShownAhead(
  config: Record<string, unknown> | undefined,
  size: GridSize
) {
  const [shown, setShown] = useState<Shown>({});
  // By value: a stored config read again arrives as a new object holding the same settings.
  const storedKey = `${JSON.stringify(config ?? {})}|${size.w}x${size.h}`;
  useEffect(() => setShown({}), [storedKey]);
  return [shown, setShown] as const;
}

/** What a change to one card needs: the card, where it is kept, and how the controls follow. */
interface ChangeContext {
  placementId: string;
  title: string;
  widget: DashboardWidget;
  settings: readonly AnyWidgetSetting[];
  config: Record<string, unknown> | undefined;
  /** The card's stored settings as they are when asked, which a later save may have changed. */
  latestConfig: () => Record<string, unknown> | undefined;
  size: GridSize;
  sources: readonly PublishedContentSource[] | undefined;
  /** Absent while customising, where `staged` keeps the change. */
  atRest: CellSettingsWrite | undefined;
  staged: CellStagedWrite;
  setShown: (update: (ahead: Shown) => Shown) => void;
  /** Say the change once the card shows it, offering `undo` with it. */
  announceLater: (
    setting: string,
    value: string,
    asksAgain: boolean,
    undo?: () => void
  ) => void;
}

/** One quick setting changed to `next`: staged while customising, saved with Undo at rest. */
function changeSetting(
  ctx: ChangeContext,
  setting: PopoverSetting,
  next: string | boolean,
  reverted: () => void = () => {}
) {
  const { settings, config, sources, atRest } = ctx;
  const stored = quickChangeConfig(
    settings,
    config,
    setting.name,
    next,
    sources
  );
  if (!atRest) {
    ctx.staged.config(stored);
    return;
  }
  const label = setting.label ?? setting.name;
  // Captured now: Undo puts back what this setting was just before THIS change.
  const previous = config ?? {};
  const asksAgain = changesQuery(ctx.widget, config, stored, sources);
  const said = (value: unknown) => valueLabel(setting, value, sources);
  ctx.setShown(ahead => ({
    ...ahead,
    values: { ...ahead.values, [setting.name]: next },
  }));
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
    onFailed: () => {
      ctx.setShown(ahead => ({ ...ahead, values: {} }));
      reverted();
    },
  });
}

/** The card's size changed to `next`: staged while customising, saved with Undo at rest. */
function changeSize(ctx: ChangeContext, next: GridSize) {
  const { atRest } = ctx;
  if (!atRest) {
    ctx.staged.size(next);
    return;
  }
  const { resize } = atRest;
  if (!resize) return;
  const previous = ctx.size;
  ctx.setShown(ahead => ({ ...ahead, size: next }));
  resize(next, {
    // Said at once: the card is drawn at its new size as soon as the write lands.
    onLanded: () =>
      ctx.announceLater("Size", sizeName(next), false, () =>
        resize(previous, {
          onLanded: () => ctx.announceLater("Size", sizeName(previous), false),
        })
      ),
    onFailed: () => ctx.setShown(ahead => ({ ...ahead, size: undefined })),
  });
}

/** The header's quick control at rest, where the widget marks one the header can draw. */
function inlineControl(
  ctx: ChangeContext,
  resolved: Readonly<Record<string, unknown>>
): ReactNode | undefined {
  const quick = quickSettingOf(ctx.settings);
  const { atRest } = ctx;
  if (!atRest || !quick) return undefined;
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

/** The quick popover's model, or `undefined` when the card has nothing for it to hold. */
function popoverModel(
  ctx: ChangeContext,
  resolved: Readonly<Record<string, unknown>>,
  shown: Shown
): CardQuickPopoverModel | undefined {
  const { widget, size } = ctx;
  const settings = popoverSettingsOf(ctx.settings);
  const resizable = isResizableHere(ctx);
  if (settings.length === 0 && !resizable) return undefined;
  return {
    settings,
    values: { ...resolved, ...shown.values },
    collections: offeredCollections(widget, settings, ctx.sources),
    ...(resizable
      ? { size: { size: shown.size ?? size, bounds: widget.size } }
      : {}),
    changeSetting: (setting, next) => changeSetting(ctx, setting, next),
    changeSize: next => changeSize(ctx, next),
    ...writeState(ctx.atRest, ctx.staged),
  };
}

/**
 * Whether the card may be resized from the popover: where it may be from its menu, while
 * customising and at rest where the grid offers the size write, and only where its widget's
 * bounds allow more than one size.
 */
function isResizableHere(ctx: ChangeContext): boolean {
  const { atRest, widget, size } = ctx;
  if (atRest !== undefined && atRest.resize === undefined) return false;
  return sizeAxes(size, widget.size, () => {}).length > 0;
}

/** Whether the popover waits for a write, and why it cannot save one, when it cannot. */
function writeState(
  atRest: CellSettingsWrite | undefined,
  staged: CellStagedWrite
): Pick<CardQuickPopoverModel, "disabled" | "unavailable"> {
  if (!atRest) return { disabled: staged.isWriting };
  return {
    disabled: atRest.isWriting,
    ...(atRest.unavailable === undefined
      ? {}
      : { unavailable: atRest.unavailable }),
  };
}

export function useCardQuickSetting(args: {
  placementId: string;
  /** The widget as declared, before its settings apply. */
  widget: DashboardWidget;
  /** The card's title as drawn, which the controls' names and the toast say. */
  title: string;
  config: Record<string, unknown> | undefined;
  /** The size the card is drawn at. */
  size: GridSize;
  isEditing: boolean;
  /** This card's own request is in flight. */
  isFetching: boolean;
  /** When the answer this card shows arrived. */
  updatedAt: Date | null;
  /** Absent while customising, and before an arrangement has been read. */
  settingsWrite: CellSettingsWrite | undefined;
  /** How a change is staged while customising. */
  staged: CellStagedWrite;
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
  const [shown, setShown] = useShownAhead(args.config, args.size);
  // The stored settings as last drawn, for an Undo pressed after a later save. Kept after each
  // commit: Undo is pressed later, never while the card is drawing.
  const latestConfig = useRef(args.config);
  useEffect(() => {
    latestConfig.current = args.config;
  });

  // Nowhere to keep a change: at rest before an arrangement has been read.
  if (!isEditing && !settingsWrite) return {};
  const settings = args.widget.settings ?? [];
  const ctx: ChangeContext = {
    placementId: args.placementId,
    title: args.title,
    widget: args.widget,
    settings,
    config: args.config,
    latestConfig: () => latestConfig.current,
    size: args.size,
    sources,
    atRest: isEditing ? undefined : settingsWrite,
    staged: args.staged,
    setShown,
    announceLater: (setting, value, asksAgain, undo) =>
      setPending({
        setting,
        value,
        asksAgain,
        seenFetching: false,
        shownAt,
        undo,
      }),
  };
  const resolved = resolveWidgetSettings(settings, args.config);
  const inline = inlineControl(ctx, resolved);
  const popover = popoverModel(ctx, resolved, shown);
  return {
    ...(inline ? { inline } : {}),
    ...(popover ? { popover } : {}),
  };
}

/** Whether a card's quick popover is open, and where focus goes back to when it closes. */
interface QuickPopoverOpening {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open it from a control other than its own trigger, focus going back there on close. */
  openFrom: (opener: HTMLElement | null) => void;
  /** The control focus goes back to: the one it was opened from, else the card's title. */
  returnFocusTo: () => HTMLElement | null;
  /** Registers the card's title button, the popover's own trigger. */
  titleRef: (element: HTMLElement | null) => void;
}

/**
 * The quick popover's open state, kept by the card so its menu's Settings can open it as well
 * as its title. Opened from the title, focus goes back to the title; from a menu, to that
 * menu's button, since the menu has closed by then.
 */
export function useQuickPopoverOpening(): QuickPopoverOpening {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLElement | null>(null);
  const onOpenChange = useCallback((next: boolean) => {
    // Opened by its trigger: focus goes back to the title.
    if (next) opener.current = null;
    setOpen(next);
  }, []);
  const openFrom = useCallback((from: HTMLElement | null) => {
    opener.current = from;
    setOpen(true);
  }, []);
  const returnFocusTo = useCallback(() => opener.current ?? title.current, []);
  const titleRef = useCallback((element: HTMLElement | null) => {
    title.current = element;
  }, []);
  return { open, onOpenChange, openFrom, returnFocusTo, titleRef };
}
