"use client";

/**
 * One cell of the grid: its size, its spacing, its customise controls and the
 * widget inside it.
 *
 * Its own component because the split is by SUBJECT: everything here is about
 * one card, and everything left in the grid is about the set.
 *
 * @module components/features/widgets/edit/ArrangedCell
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import type { GridSize } from "nextly/config";
import {
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
  type JSX,
} from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "../archetypes/types";
import type { MoveDirection } from "../layout-editor";
import { cardRowStyle, cardSpanClass, drawnSize } from "../sizes";
import {
  settingsAsAsked,
  titleAsAsked,
  widgetAsAsked,
} from "../widget-as-asked";
import { WidgetRenderer } from "../WidgetRenderer";

import { CardActionsMenu, CardSizeLabel } from "./CardActionsMenu";
import { CardMenu } from "./CardMenu";
import {
  CardControlsOverlay,
  CardControlsSpace,
  CustomizingFence,
} from "./CustomizingFence";
import { DismissWidgetButton } from "./DismissWidgetButton";
import { DraggableWidgetCell, type CellDrag } from "./DraggableWidgetCell";
import { SettingsPreview } from "./SettingsPreview";
import {
  useCardQuickSetting,
  type CellSettingsWrite,
} from "./useCardQuickSetting";
import type { ArrangedWidget } from "./useDashboardArrangement";
import { WidgetSettingsSheet } from "./WidgetSettingsSheet";

export interface ArrangedCellProps {
  row: ArrangedWidget;
  isEditing: boolean;
  /** The card just placed: moved, resized, added or put back. */
  highlighted?: boolean;
  /** Its handle's drag, while dragging is on; absent at one column. */
  drag?: CellDrag;
  /** Lists the card menu's sizes in the menu itself: where the dashboard draws one column. */
  sizesInPlace?: boolean;
  /**
   * Whether a layout write is in flight anywhere on this dashboard.
   *
   * Dashboard-wide rather than per-card, because every write is a whole-layout
   * snapshot guarded by one cached version: two in flight at once carry the
   * same guard, so the server honours one and refuses the other as a conflict
   * the reader never caused.
   */
  isWriting: boolean;
  /**
   * Why a single-card write is unavailable right now, or absent when it is
   * available. Present while the stored layout is unreadable.
   */
  singleCardWriteBlocked?: string;
  /** Which of the four moves would move this card. */
  can: Record<MoveDirection, boolean>;
  /**
   * What the batch answered for this card, or its absence.
   *
   * One group because it is one answer: the renderer takes all four together,
   * and `updatedAt`/`isFetching` are `null`/`false` for a card that took no
   * part in the batch rather than being separately meaningful.
   */
  data: {
    slot: WidgetSlot | undefined;
    /** How a `stats` card reaches each cell's answer; absent otherwise. */
    slotFor?: CellSlotLookup;
    /** `null` when this card took no part in the batch. */
    updatedAt: Date | null;
    isFetching: boolean;
    /** The tier the answer shown was fetched at; see `WidgetRenderer`'s own. */
    answerTier?: SizeTier;
    /** Reload this card's data on its own, offered in its error state. */
    onRetry?: () => void;
  };
  /**
   * How this card's settings are saved at once, outside customise mode: its quick setting.
   * ABSENT while customising, where a change waits for the dashboard's Save, and before an
   * arrangement has been read, when there is no stored placement to write into.
   */
  settingsWrite?: CellSettingsWrite | undefined;
  /** Registers the card's controls, so focus can be sent back to them. */
  refs: {
    menu: (element: HTMLElement | null) => void;
    dismiss: (element: HTMLElement | null) => void;
  };
  /**
   * What acting on this card does, each already bound to this placement by
   * the caller: the writes are keyed by placement, and the cell should not
   * have to know how the editor addresses one.
   */
  on: {
    move: (direction: MoveDirection) => void;
    setSize: (size: GridSize) => void;
    remove: () => void;
    /**
     * Send this card away from the card itself, outside customise mode.
     *
     * 🔴 ABSENT rather than present-and-inert before an arrangement has been
     * read: the rows drawn then carry no stored placement to remove, so a
     * control drawn then would answer a click by doing nothing at all.
     */
    dismiss?: () => void;
    /** Records what a reader chose for THIS card. */
    saveSettings: (config: Record<string, unknown>) => void;
  };
}

/**
 * This card's header controls at rest: its dismiss control, where its author offered one, and
 * its menu, in that order at the header's right end. Nothing while customising, where Remove in
 * the customise menu does the same thing and the controls are drawn over the header.
 *
 * 🔴 `=== true`, not truthiness. A registration arrives over the wire from a
 * server that may be a different version and the admin copies the field
 * verbatim, so a malformed `dismissible: "false"` would otherwise DRAW the
 * control, which is the one reading the declaration cannot have meant.
 */
function dismissAffordance(
  widget: DashboardWidget,
  props: Pick<
    ArrangedCellProps,
    "isEditing" | "isWriting" | "singleCardWriteBlocked" | "refs"
  >,
  dismiss: (() => void) | undefined,
  /** The card's menu at rest, drawn beside the dismiss control when both are offered. */
  menu?: ReactNode
): ReactNode | undefined {
  const dismissible =
    dismiss !== undefined && !props.isEditing && widget.dismissible === true;
  if (!dismissible && !menu) return undefined;
  const button = dismissible ? (
    <DismissWidgetButton
      title={widget.title}
      isDismissing={props.isWriting}
      unavailableReason={props.singleCardWriteBlocked}
      buttonRef={props.refs.dismiss}
      onDismiss={dismiss}
    />
  ) : null;
  return menu ? (
    <span className="flex items-center gap-1">
      {button}
      {menu}
    </span>
  ) : (
    button
  );
}

/** A card's size and its one menu, side by side, while customising. */
function CardEditActions(props: {
  row: ArrangedCellProps["row"];
  /** The size the card is drawn at. */
  size: GridSize;
  can: ArrangedCellProps["can"];
  isWriting: boolean;
  refs: ArrangedCellProps["refs"];
  on: ArrangedCellProps["on"];
  /** Present only when the widget offers settings. */
  openSettings?: () => void;
  sizesInPlace: boolean;
}) {
  const { row, size, can, isWriting, refs, on, openSettings } = props;
  return (
    <span className="flex items-center gap-1" data-testid="card-edit-actions">
      <CardSizeLabel size={size} />
      <CardActionsMenu
        title={row.widget.title}
        size={size}
        bounds={row.widget.size}
        can={can}
        disabled={isWriting}
        triggerRef={refs.menu}
        sizesInPlace={props.sizesInPlace}
        on={{
          move: on.move,
          setSize: on.setSize,
          remove: on.remove,
          ...(openSettings ? { openSettings } : {}),
        }}
      />
    </span>
  );
}

/** The widget itself, at rest or while customising. */
function CardBody(props: {
  widget: DashboardWidget;
  /** The widget's own name under the title, when the title names the card's subject. */
  subtitle: string | undefined;
  placement: ComponentProps<typeof WidgetRenderer>["placement"];
  headerAction: ReactNode;
  /** The card's quick setting, at rest; the frame decides when to draw it. */
  quick: ReactNode;
  data: ArrangedCellProps["data"];
  isEditing: boolean;
}) {
  const { widget, placement, headerAction, quick, data, isEditing } = props;
  const { subtitle } = props;
  if (isEditing) {
    // While customising: drawn, and out of reach. A different element from
    // the resting cell's, so entering and leaving customise mode mounts the
    // widget afresh.
    return (
      <CustomizingFence>
        <WidgetRenderer
          definition={widget}
          placement={placement}
          headerAction={headerAction}
          customizing
          subtitle={subtitle}
          {...data}
        />
      </CustomizingFence>
    );
  }
  return (
    <WidgetRenderer
      definition={widget}
      placement={placement}
      headerAction={headerAction}
      quick={quick}
      subtitle={subtitle}
      {...data}
    />
  );
}

/**
 * What a card offers at rest: its quick setting, its dismiss control and menu in its header, and
 * where its sheet's Done goes.
 */
function useRestingControls(
  props: ArrangedCellProps,
  widget: DashboardWidget,
  hasSettings: boolean,
  setSettingsOpen: (open: boolean) => void
) {
  // From the DECLARED widget, so the change is judged against the reader's stored settings.
  const quick = useCardQuickSetting({
    widget: props.row.widget,
    config: props.row.config,
    isEditing: props.isEditing,
    isFetching: props.data.isFetching,
    updatedAt: props.data.updatedAt,
    settingsWrite: props.settingsWrite,
  });
  const menu = restingMenuFor(props, widget, hasSettings, quick, () =>
    setSettingsOpen(true)
  );
  return {
    quick,
    header: dismissAffordance(widget, props, props.on.dismiss, menu),
    done: doneFor(props),
  };
}

/** Whether a card's settings cannot be saved at rest right now: a write is in flight, or none is possible. */
function settingsBlocked(write: CellSettingsWrite | undefined): boolean {
  return (
    write !== undefined && (write.isWriting || write.unavailable !== undefined)
  );
}

/**
 * What the card's menu at rest offers: its quick setting where the header has no room for it,
 * Settings where its settings can be saved there, and Refresh where it asks for data. Nothing
 * while customising, where the customise menu stands in its place, nor for a card that would
 * offer nothing in it.
 */
function restingMenuItems(
  props: ArrangedCellProps,
  hasSettings: boolean,
  quick: ReturnType<typeof useCardQuickSetting>,
  openSettings: () => void
) {
  if (props.isEditing) return undefined;
  const items = {
    quick: quick.menu,
    onOpenSettings:
      props.settingsWrite !== undefined && hasSettings
        ? openSettings
        : undefined,
    onRefresh: props.data.onRetry,
  };
  const offersSomething = Object.values(items).some(item => item !== undefined);
  return offersSomething
    ? { ...items, settingsDisabled: settingsBlocked(props.settingsWrite) }
    : undefined;
}

/** The card's menu at rest, in the same place on every card, or none (`restingMenuItems`). */
function restingMenuFor(
  props: ArrangedCellProps,
  widget: DashboardWidget,
  hasSettings: boolean,
  quick: ReturnType<typeof useCardQuickSetting>,
  openSettings: () => void
): ReactNode | undefined {
  const items = restingMenuItems(props, hasSettings, quick, openSettings);
  return items ? <CardMenu title={widget.title} {...items} /> : undefined;
}

/**
 * Where the sheet's Done goes, decided by where the reader is when they press it, since the
 * sheet stays open across a change of mode. While customising it is recorded in the draft, kept
 * with the dashboard's other unsaved changes, and the sheet closes. Outside it, it is saved at
 * once through the same write as the quick setting, and the sheet hears how that ended: it
 * closes when the save lands and says why in place when it does not.
 */
function doneFor(props: ArrangedCellProps): {
  done: ComponentProps<typeof WidgetSettingsSheet>["onDone"];
  blocked: string | undefined;
} {
  const write = props.settingsWrite;
  if (props.isEditing || !write) {
    return {
      done: (config, settled) => {
        props.on.saveSettings(config);
        settled.saved();
      },
      blocked: undefined,
    };
  }
  return {
    done: (config, settled) =>
      write.write(config, {
        onLanded: settled.saved,
        onFailed: settled.failed,
        showsFailure: true,
      }),
    blocked: write.unavailable,
  };
}

/** The cell's classes: its columns, its leaving the grid while hidden, and its spacing. */
function cellClassName(size: GridSize, isEditing: boolean): string {
  return cn(
    // `relative` so the drag handle, which is absolutely positioned, lands
    // on this cell rather than on the grid. `min-h-0` and `overflow-hidden`
    // so a body taller than the card's rows stays inside them: the card is as
    // tall as its `h`, never as tall as its content.
    "relative min-h-0 overflow-hidden",
    // 🔴 The PLACEMENT's size, drawn at the nearest size its widget's bounds
    // allow. The stored size IS the reader's arrangement, so it is never
    // replaced by the declaration's default here.
    cardSpanClass(size.w),
    // A card whose widget hides when empty leaves the grid while its answer is: the frame marks
    // it (`data-hidden-empty`) only outside customise mode, so the cell needs no state of its own.
    "has-[[data-hidden-empty]]:hidden",
    // Room above each control as it takes focus, so scrolling it into view
    // stops below the customise bar stuck to the top rather than under
    // it. On the controls rather than the cell, because the margin that
    // counts is the focused element's own.
    isEditing && "[&_button]:scroll-mt-40"
  );
}

/** The card's size and menu while customising, or nothing at rest. */
function editActionsOf(
  props: ArrangedCellProps,
  size: GridSize,
  openSettings: (() => void) | undefined
): ReactNode {
  if (!props.isEditing) return null;
  const { row, can, isWriting, refs, on } = props;
  return (
    <CardEditActions
      {...{ row, size, can, isWriting, refs, on }}
      sizesInPlace={props.sizesInPlace === true}
      {...(openSettings ? { openSettings } : {})}
    />
  );
}

/** The card's size and menu while customising, drawn over its header's right end. */
function CellEditActions({ actions }: { actions: ReactNode }) {
  if (!actions) return null;
  return <CardControlsOverlay>{actions}</CardControlsOverlay>;
}

/**
 * The card's settings sheet, beside the card as the sheet's values would draw it: the declared
 * widget, the reader's stored settings it was asked with, and the answer it shows now.
 */
function CellSettings({
  row,
  widget,
  data,
  done,
  open,
  onOpenChange,
}: {
  row: ArrangedCellProps["row"];
  widget: DashboardWidget;
  data: ArrangedCellProps["data"];
  done: ReturnType<typeof doneFor>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <WidgetSettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      title={widget.title}
      settings={widget.settings ?? []}
      // The declaration, not the card as asked: each candidate collection is
      // judged from it, so this card's own grouping is not carried to another.
      widget={row.widget}
      config={row.config}
      onDone={done.done}
      {...(done.blocked === undefined ? {} : { blocked: done.blocked })}
      renderPreview={draft => (
        <SettingsPreview
          widget={row.widget}
          placementId={row.placementId}
          stored={row.config}
          draft={draft}
          shown={data}
        />
      )}
    />
  );
}

export function ArrangedCell(props: ArrangedCellProps): JSX.Element {
  const { row, isEditing, data } = props;
  /*
   * Open state lives with the CELL rather than with the grid: the sheet belongs
   * to one card, and hoisting it would make the grid track which of many is
   * open for no benefit to either.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = (row.widget.settings?.length ?? 0) > 0;
  // Drawn as it was asked: the query the batch sent, with the reader's settings applied.
  const sources = useBranding().widgetSources;
  const heading = useMemo(
    () => titleAsAsked(row.widget, row.config, sources),
    [row.widget, row.config, sources]
  );
  const widget = useMemo(() => {
    const asked = widgetAsAsked(row.widget, row.config, sources);
    return heading.title === asked.title
      ? asked
      : { ...asked, title: heading.title };
  }, [row.widget, row.config, sources, heading.title]);
  // The size the card is drawn at: its stored size, held to its widget's
  // current bounds. One reading for its span, its rows, its menu and the size
  // a declared component is handed.
  const size = useMemo(
    () => drawnSize(row.size, row.widget.size),
    [row.size, row.widget.size]
  );
  /*
   * Resolved HERE, the one place a card's declaration and its reader's stored
   * config are both in scope. Only DECLARED names are returned, so a component
   * cannot act on a key its widget never offered, and each as the card's query
   * was asked with it, so a link the component builds matches its answer.
   */
  const placement = useMemo(
    () => ({
      id: row.placementId,
      settings: settingsAsAsked(row.widget, row.config, sources),
      size,
    }),
    [row.placementId, row.widget, row.config, size, sources]
  );
  const {
    quick,
    header: restingControls,
    done,
  } = useRestingControls(props, widget, hasSettings, setSettingsOpen);

  // While customising, the card's size and its one menu, side by side, over
  // its own header's right end, outside the fence that puts the card's own
  // content out of reach.
  const editActions = editActionsOf(
    props,
    size,
    hasSettings ? () => setSettingsOpen(true) : undefined
  );
  // While customising, the card's header keeps the room its controls are drawn
  // over; at rest it holds the dismiss control and the menu.
  const headerAction = isEditing ? <CardControlsSpace /> : restingControls;

  return (
    <DraggableWidgetCell
      id={row.placementId}
      title={widget.title}
      isEditing={isEditing}
      highlighted={props.highlighted}
      {...(props.drag === undefined ? {} : { drag: props.drag })}
      data-testid={`widget-cell-${widget.id}`}
      className={cellClassName(size, isEditing)}
      style={cardRowStyle(size.h)}
    >
      <CellEditActions actions={editActions} />
      {/* Mounted whenever the widget offers settings, not only while
          customising. A closed `Sheet` renders nothing, so this costs a card
          nothing — and it is what lets the panel outlive customise mode rather
          than being torn out from under a reader still filling it in. */}
      {hasSettings ? (
        <CellSettings
          {...{ row, widget, data, done }}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}
      <CardBody
        {...{ widget, placement, headerAction, data, isEditing }}
        subtitle={heading.subtitle}
        quick={quick.inline}
      />
    </DraggableWidgetCell>
  );
}
