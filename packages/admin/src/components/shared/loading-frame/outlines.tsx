"use client";

/**
 * Still outlines of the admin's main screens, drawn in the place their real
 * parts take while the screen's data is on its way.
 *
 * Each is the outline of ONE screen, used by every state that waits for it:
 * the frame while the session is checked, the route's code loading, and the
 * screen's own first load. So an outline never gives way to a different
 * outline of the same screen, and the real parts land where it drew them.
 *
 * Nothing here moves: the bars are `Skeleton`'s still variant, never a pulse
 * or a shimmer. `ScreenOutline` holds every outline back for its first 0.4 s,
 * so a fast server never shows one, and reports the wait to the frame, which
 * draws the line under the bar and the slow-start message.
 *
 * @module components/shared/loading-frame/outlines
 */

import {
  Button,
  buttonVariants,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nextlyhq/ui";
import { listCardHeightPx } from "nextly/card-geometry";
import { GRID_COLUMNS, listEntries } from "nextly/config";
import { CORE_DEFAULT_LAYOUT } from "nextly/core-widget-data";
import type { CSSProperties, JSX, ReactNode } from "react";

import {
  BAR_CONTROLS_GAP,
  BAR_ICON_CONTROL,
  PANEL_TOGGLE_RULE,
} from "@admin/components/features/entries/EntryForm/bar-controls";
import {
  cardSpanClass,
  GRID_CLASS,
} from "@admin/components/features/widgets/sizes";
import { MoreHorizontal, PanelRight } from "@admin/components/icons";
import {
  STAND_IN_ATTRIBUTE,
  TopBarPlace,
} from "@admin/components/layout/header/TopBarPlaces";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared/breadcrumbs";
import {
  PAGER_BUTTON_SIZE,
  PAGER_CONTROLS,
  PAGER_FRAME,
} from "@admin/components/shared/pagination/pager-layout";
import {
  FIXED_LAYOUT_TABLE,
  fixedColumnLayout,
  ROW_ACTIONS_COLUMN,
  ROW_ACTIONS_TRIGGER,
  SELECTION_COLUMN,
} from "@admin/components/ui/table/data-table/row-actions";
import {
  LIST_TOOLBAR_CONTROLS,
  LIST_TOOLBAR_ROW,
  LIST_TOOLBAR_SEARCH,
} from "@admin/components/ui/table/list-view/toolbar-layout";
import { MEDIA_GRID_CLASSES } from "@admin/constants/media";
import { cn } from "@admin/lib/utils";

import { LOADING_FRAME_TIMES, useDelayedReveal } from "./delayed-reveal";
import { FIRST_GUESS_ROWS, outlineRowsFor } from "./list-rows";
import { useReportScreenWait } from "./screen-wait";

/**
 * The empty shape of a control (an input, a search box, a toolbar button): its
 * border on the card's surface, at a control's height, with nothing in it.
 * Read against the page in both themes, where a filled bar on the page's own
 * surface would vanish.
 */
function ControlOutline({ className }: { className?: string }): JSX.Element {
  return (
    <div
      className={cn(
        "h-[var(--nx-control-height)] rounded-md border border-border bg-card",
        className
      )}
    />
  );
}

/** One still bar of an outline; `soft` for the lighter, secondary parts (a date, a value). */
function OutlineBar({
  className,
  soft = false,
  style,
}: {
  className?: string;
  soft?: boolean;
  /** A bar's own width, where the outline gives each bar a different one. */
  style?: CSSProperties;
}): JSX.Element {
  return (
    <Skeleton
      still
      className={cn(soft && "bg-muted", className)}
      style={style}
    />
  );
}

/**
 * The wait of one screen (or one part of a screen): reported to the frame while
 * mounted, and drawn as `children` from 0.4 s. Hidden from assistive technology,
 * since the frame's status line is what speaks for a long wait.
 *
 * Before 0.4 s the outline is laid out but not drawn, so it holds the place its
 * parts will take from the first paint: a part of a screen that answers late
 * (a list's rows) keeps what sits under it where it will stay, rather than
 * drawing it up into the empty place and pushing it back down.
 */
export function ScreenOutline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  useReportScreenWait(true);
  const shown = useDelayedReveal(true, LOADING_FRAME_TIMES.outline);
  return (
    <div
      data-testid="screen-outline"
      data-outline-shown={shown ? "" : undefined}
      aria-hidden="true"
      className={cn(className, !shown && "invisible")}
    >
      {children}
    </div>
  );
}

/**
 * The page's container around an outline drawn in place of a whole screen;
 * nothing around one a screen draws inside its own container.
 */
function PageFrame({
  framed,
  children,
}: {
  framed: boolean;
  children: ReactNode;
}): JSX.Element {
  return framed ? <PageContainer>{children}</PageContainer> : <>{children}</>;
}

/**
 * A page head with its real title, or a bar where the title is not known yet,
 * and outlines of its action buttons. A subtitle line is kept empty only where
 * the screen's head draws one: an admin list's head has none, and an empty
 * line there would leave the parts below to jump up when the head arrives.
 */
function PageHeadOutline({
  title,
  actions = [],
  subtitle = false,
}: {
  title?: string;
  /** The widths of the head's action buttons, in pixels. */
  actions?: readonly number[];
  /** Whether the real head has a subtitle line under its title. */
  subtitle?: boolean;
}): JSX.Element {
  return (
    <PageHeader
      className="m-0"
      // A title not known yet keeps the title's line (a no-break space) with
      // a bar beside it, in the head's own row for chips.
      title={title ?? "\u00a0"}
      meta={
        title === undefined ? <OutlineBar className="h-6 w-40" /> : undefined
      }
      // The subtitle's line is kept empty, so the parts below sit where they
      // will sit under a real one.
      description={subtitle ? <span>&nbsp;</span> : undefined}
      actions={
        actions.length > 0 ? (
          <div className="flex items-center gap-2">
            {actions.map((width, index) => (
              <OutlineBar
                key={index}
                className="h-[var(--nx-control-height)] rounded-md"
                // A width per button, so the row keeps the real row's length.
                style={{ width }}
              />
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * Every column past the title steps aside on a narrow content column, where
 * a list draws each row as a card under its title.
 */
const NARROW_HIDDEN = (index: number): string | undefined =>
  index >= 1 ? "hidden @lg/content:table-cell" : undefined;

/** The widths of an outline row's title bars, in order. */
const ROW_TITLE_WIDTHS = [200, 240, 160, 130, 110] as const;

/**
 * One outline bar on the line a cell's text takes: an empty text run beside it
 * gives the line the table's own font, so the row is as tall as a row of text
 * without the outline naming a height.
 */
function CellLine({
  className,
  soft,
  style,
}: {
  className?: string;
  soft?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span className="flex items-center">
      {"\u200b"}
      <OutlineBar soft={soft} className={className} style={style} />
    </span>
  );
}

/**
 * The pager under a table, as its frame and the shapes of its controls: the
 * pager's own classes (`pagination/pager-layout`), so it stands as tall as the
 * pager that replaces it at every width. What it will say (the rows shown, the
 * page count) is not known, so bars hold its words.
 */
function PagerOutline(): JSX.Element {
  return (
    <div className={PAGER_FRAME}>
      {/* The summary's line, after the controls where the two stack. */}
      <span className="order-2 flex items-center @2xl/content:order-1">
        {"\u200b"}
        <OutlineBar soft className="h-3 w-36" />
      </span>
      <div className={PAGER_CONTROLS}>
        <div className="flex gap-1">
          {Array.from({ length: 3 }, (_, index) => (
            <ControlOutline key={index} className={PAGER_BUTTON_SIZE} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A table with its real head where its columns are known, and outline rows: a
 * title, then shorter, softer values in the other columns. Each row ends in
 * the row actions' column as the table draws it, whose trigger is the row's
 * tallest part, so an outline row is as tall as a real one; and the table's
 * pager follows the rows, inside the table's card, as the table's own does.
 * As many rows as the list drew when this person last opened it
 * (`outlineRowsFor`), so the pager and whatever sits under the table stay
 * where they will be.
 */
export function TableOutline({
  headers,
  rowActions = true,
  rows = FIRST_GUESS_ROWS,
  selection = false,
  columnWidths,
}: {
  /** The column heads, when the columns are known. */
  headers?: readonly ReactNode[];
  /** Whether the table's rows end in their actions, as every list's do. */
  rowActions?: boolean;
  /** How many outline rows to draw. */
  rows?: number;
  /** Whether the table's rows start with a selection box, as a selectable list's do. */
  selection?: boolean;
  /**
   * Each column's width, where the table lays its columns out by them
   * (`fixedColumnLayout`): the outline then stands its columns where the
   * table's stand.
   */
  columnWidths?: readonly (number | undefined)[];
}): JSX.Element {
  const columns: readonly ReactNode[] = headers ?? [null, null, null];
  const fixed = columnWidths !== undefined && fixedColumnLayout(columnWidths);
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {/* The head and the rows, named as the table names its own, so a test
          can hold the two to one box. */}
      <div data-frame-part="list-rows">
        <Table className={cn(fixed && FIXED_LAYOUT_TABLE)}>
          <TableHeader>
            <TableRow>
              {selection ? <TableHead className={SELECTION_COLUMN} /> : null}
              {columns.map((header, index) => (
                <TableHead
                  key={index}
                  className={cn("py-3", NARROW_HIDDEN(index))}
                  style={fixed ? { width: columnWidths?.[index] } : undefined}
                >
                  {header ?? (
                    <OutlineBar
                      soft
                      className={cn("h-3", index === 0 ? "w-16" : "w-12")}
                    />
                  )}
                </TableHead>
              ))}
              {rowActions ? <TableHead className={ROW_ACTIONS_COLUMN} /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, row) => (
              <TableRow key={row} className="border-b border-border">
                {selection ? <TableCell className={SELECTION_COLUMN} /> : null}
                {columns.map((_, index) => (
                  <TableCell key={index} className={NARROW_HIDDEN(index)}>
                    {index === 0 ? (
                      <CellLine
                        className="h-3 max-w-full"
                        style={{
                          width:
                            ROW_TITLE_WIDTHS[row % ROW_TITLE_WIDTHS.length],
                        }}
                      />
                    ) : (
                      <CellLine
                        soft
                        className={cn("h-3", index === 1 ? "w-16" : "w-11")}
                      />
                    )}
                  </TableCell>
                ))}
                {rowActions ? (
                  <TableCell className={ROW_ACTIONS_COLUMN}>
                    {/* The trigger's own box, empty and unseen: the row's
                      height is the real trigger's. Set at the line's top, as
                      an empty box on the text's baseline would add the
                      line's descent below it. */}
                    <span
                      className={cn(
                        buttonVariants(ROW_ACTIONS_TRIGGER),
                        "invisible align-top"
                      )}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PagerOutline />
    </div>
  );
}

/**
 * A list's toolbar: its search, then Filter and Columns, laid out by the
 * toolbar's own classes (`list-view/toolbar-layout`), so at every width it
 * stands as tall as the toolbar that replaces it.
 */
export function ListToolbarOutline(): JSX.Element {
  return (
    <div className={LIST_TOOLBAR_ROW}>
      <div className={LIST_TOOLBAR_SEARCH}>
        <ControlOutline className="w-full" />
      </div>
      <div className={LIST_TOOLBAR_CONTROLS}>
        <ControlOutline className="w-[106px]" />
        <ControlOutline className="w-[130px]" />
      </div>
    </div>
  );
}

/** A collection's (or any list's) page: its head, then its table. */
export function ListOutline({
  title,
  headers,
  actions = [72, 112],
  framed = true,
  list,
  selection,
  columnWidths,
  subtitle = false,
}: {
  title?: string;
  headers?: readonly ReactNode[];
  actions?: readonly number[];
  /** `false` where the screen draws the outline inside its own container. */
  framed?: boolean;
  /** The list's name (its `registryKey`), for how many rows it last drew. */
  list?: string;
  /** Whether the list's rows start with a selection box. */
  selection?: boolean;
  /** Each column's width, where the list lays its columns out by them. */
  columnWidths?: readonly (number | undefined)[];
  /** Whether the list's head has a subtitle line under its title. */
  subtitle?: boolean;
}): JSX.Element {
  return (
    <ScreenOutline>
      <PageFrame framed={framed}>
        <div className="flex flex-col gap-8">
          <PageHeadOutline
            title={title}
            actions={actions}
            subtitle={subtitle}
          />
          {/* The list's toolbar above the table, at the list's own spacing. */}
          <div className="space-y-4">
            <ListToolbarOutline />
            <TableOutline
              headers={headers}
              rows={outlineRowsFor(list)}
              selection={selection}
              columnWidths={columnWidths}
            />
          </div>
        </div>
      </PageFrame>
    </ScreenOutline>
  );
}

/**
 * How tall a dashboard card is first drawn, in pixels, while its answer is on
 * its way: a list card's skeleton, holding its default "Number of entries"
 * (`listEntries` of no setting) at the default density.
 */
const FIRST_DRAWN_CARD_HEIGHT = listCardHeightPx(
  listEntries(undefined),
  "default"
);

/** The widths of the dashboard's recent-list rows, in order. */
const RECENT_ROW_WIDTHS = [180, 220, 140, 160] as const;

/**
 * Core's own default dashboard, as each card's width in columns: what a reader
 * with no saved arrangement is drawn, so the widths the outline stands in for
 * when the reader's own arrangement is not known yet. Read from core's
 * declaration of it, never copied. A card stating no width takes its widget's
 * starting width, which only the widget knows; half the row stands in.
 */
const DEFAULT_CARD_WIDTHS: readonly number[] = CORE_DEFAULT_LAYOUT.map(
  card => card.w ?? GRID_COLUMNS / 2
);

/**
 * The dashboard's cards, each a titled card with a few rows, on the
 * dashboard's own grid: the grid's classes (`GRID_CLASS`) and each card's
 * span classes for its width (`cardSpanClass`), the ones its real card takes,
 * so at every dashboard width the outline's cards stand where the real ones
 * land. The widths are the reader's arrangement where it is known, and core's
 * default otherwise.
 */
export function DashboardCardsOutline({
  widths = DEFAULT_CARD_WIDTHS,
}: {
  /** Each card's width in the grid's twelve columns, in order. */
  widths?: readonly number[];
}): JSX.Element {
  return (
    <div data-testid="dashboard-cards-outline" className={GRID_CLASS}>
      {widths.map((w, index) => {
        const span = cardSpanClass(w);
        return (
          <div
            // Cards are told apart only by their place: an outline names none.
            key={index}
            data-testid="dashboard-card-outline"
            data-span={span}
            className={cn(
              span,
              "flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            )}
            // A card is as tall as its content, which no outline can know,
            // so it stands as tall as the cards that replace it are first
            // drawn: a list card loading its default number of entries, the
            // frame and the rows by core's own card geometry. A row of the
            // default dashboard is that tall until its cards' answers land.
            style={{ minHeight: FIRST_DRAWN_CARD_HEIGHT }}
          >
            <OutlineBar className="h-3.5 w-[120px]" />
            {RECENT_ROW_WIDTHS.map(width => (
              <div key={width} className="flex min-h-[22px] items-center gap-3">
                <OutlineBar className="h-3 max-w-[60%]" style={{ width }} />
                <OutlineBar soft className="ml-auto h-3 w-12" />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The dashboard: its greeting row, held at its real height with a bar where
 * the greeting goes, then its cards. The page's own container and measure, so
 * the real greeting and cards land on the outline's lines.
 */
export function DashboardOutline(): JSX.Element {
  return (
    <>
      {/* The bar's crumb, as the dashboard draws it, at once with the frame. */}
      <Breadcrumbs items={[{ label: "Dashboard" }]} />
      <ScreenOutline>
        <PageContainer>
          <div className="mx-auto max-w-[1600px] @container/dashboard">
            <div className="mb-[18px] flex min-h-[34px] items-center">
              <OutlineBar className="h-5 w-56 max-w-full" />
            </div>
            <DashboardCardsOutline />
          </div>
        </PageContainer>
      </ScreenOutline>
    </>
  );
}

/**
 * One field's outline: its label, then its input as a soft filled box, the
 * way the editor's inputs sit on their card. `tall` for a long text.
 */
function FieldOutline({
  labelWidth,
  tall = false,
}: {
  labelWidth: number;
  tall?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <OutlineBar className="h-3" style={{ width: labelWidth }} />
      <OutlineBar
        soft
        className={cn("w-full rounded-md", tall ? "h-20" : "h-10")}
      />
    </div>
  );
}

/** The fields of a form on their card: a long text, then two short inputs. */
function FieldsOutline(): JSX.Element {
  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-6">
      <FieldOutline labelWidth={56} tall />
      <FieldOutline labelWidth={72} />
      <FieldOutline labelWidth={96} />
    </div>
  );
}

/** A form page (settings, an account): its head, then a card of fields. */
export function FormOutline({
  title,
  framed = true,
}: {
  title?: string;
  /** `false` where the screen draws the outline inside its own container. */
  framed?: boolean;
}): JSX.Element {
  return (
    <ScreenOutline>
      <PageFrame framed={framed}>
        <div className="flex flex-col gap-8">
          <PageHeadOutline title={title} />
          <FieldsOutline />
        </div>
      </PageFrame>
    </ScreenOutline>
  );
}

/** The media library: its head, then a grid of square tiles. */
export function MediaOutline(): JSX.Element {
  return (
    <ScreenOutline>
      <PageContainer>
        <div className="flex flex-col gap-8">
          <PageHeadOutline title="Media" actions={[112]} />
          {/* The media grid's own classes, so each tile stands where a real one lands. */}
          <div className={MEDIA_GRID_CLASSES}>
            {Array.from({ length: 12 }, (_, tile) => (
              <OutlineBar
                key={tile}
                className="aspect-square w-full rounded-lg"
              />
            ))}
          </div>
        </div>
      </PageContainer>
    </ScreenOutline>
  );
}

/**
 * The height of the bar's controls: the height class of the button size they
 * are drawn at (`BAR_ICON_CONTROL`), read from the button's own sizes.
 */
const BAR_CONTROL_HEIGHT = buttonVariants({ size: BAR_ICON_CONTROL.size })
  .split(/\s+/)
  .find(name => name.startsWith("h-"));

/**
 * The editor's bar while its document loads, drawn at once, as part of the
 * frame, not after 0.4 s. Laid out from the bar's right end, as the real
 * controls are, and standing in the bar on its own rather than in the place
 * the real bar fills (`STAND_IN_ATTRIBUTE`): the document's trail, whose
 * width only the document's title decides, arrives with the real bar and
 * moves nothing drawn here.
 *
 * Only the controls that stand in the same place whatever the document's state
 * are drawn as controls: for a saved document, More, then the rule and the
 * panel toggle at the far end, where the wide layout draws them. The ones
 * before them depend on the document (History where it keeps versions, a
 * preview where it has one, Publish for a draft beside Save draft, Save alone
 * for a published one) and so on what no outline can know, so one still bar
 * holds their place, and the real controls replace it rather than shifting
 * across it. A new document's bar has only its verbs, so its outline is the
 * bar alone.
 */
function EditorBarOutline({ creating }: { creating: boolean }): JSX.Element {
  return (
    <TopBarPlace name="end">
      <div
        data-testid="editor-bar-outline"
        {...{ [STAND_IN_ATTRIBUTE]: "" }}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-end",
          BAR_CONTROLS_GAP
        )}
      >
        <OutlineBar
          soft
          className={cn(BAR_CONTROL_HEIGHT, "w-24 rounded-md lg:w-48")}
        />
        {creating ? null : (
          <>
            <Button
              type="button"
              {...BAR_ICON_CONTROL}
              disabled
              aria-disabled="true"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="contents max-lg:hidden">
              <span className={PANEL_TOGGLE_RULE} aria-hidden="true" />
              <Button
                type="button"
                {...BAR_ICON_CONTROL}
                disabled
                aria-disabled="true"
                aria-label="Document panel"
              >
                <PanelRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </span>
          </>
        )}
      </div>
    </TopBarPlace>
  );
}

/**
 * A document editor (an entry, a new entry, a Single): its bar's controls at
 * once, then from 0.4 s the field column and the side card beside it, at the
 * editor's own geometry: the field column inset and measured as the editor's,
 * the side panel at its width, so the fields land where the outline drew them.
 */
export function EditorOutline({
  sideWidth = 320,
  columnClassName,
  columnStyle,
  creating = false,
}: {
  /** Whether the document is a new one, whose bar has only its verbs. */
  creating?: boolean;
  /** The document panel's width beside the fields, in pixels. */
  sideWidth?: number;
  /** The editor's field column inset, from the editor itself. */
  columnClassName?: string;
  /** The editor's field column measure, from the editor itself. */
  columnStyle?: CSSProperties;
}): JSX.Element {
  return (
    <>
      <EditorBarOutline creating={creating} />
      <ScreenOutline>
        <PageContainer type="editor">
          <div className="flex flex-col items-stretch lg:min-h-[calc(100vh-var(--admin-bar-height))] lg:flex-row">
            <div
              className={cn(
                "mx-auto w-full min-w-0 flex-1 pt-6 lg:pt-8",
                columnClassName
              )}
              style={columnStyle}
            >
              {/* The document's title line and its address under it, then
                  its fields' card, as the editor draws them. */}
              <OutlineBar className="h-10 w-2/3 max-w-[480px]" />
              <OutlineBar className="mt-3 h-3 w-48" />
              <div className="mt-8">
                <FieldsOutline />
              </div>
            </div>
            <div
              // Beside the fields from the wide layout up; below it the
              // editor folds its panel into a sheet, so none is drawn.
              className="hidden w-full shrink-0 flex-col border-border bg-card p-6 lg:flex lg:w-(--editor-side-width) lg:border-l"
              style={
                { "--editor-side-width": `${sideWidth}px` } as CSSProperties
              }
            >
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <OutlineBar className="h-3.5 w-[60px]" />
                <OutlineBar soft className="h-3 w-full" />
                <OutlineBar soft className="h-3 w-4/5" />
              </div>
            </div>
          </div>
        </PageContainer>
      </ScreenOutline>
    </>
  );
}

/** A screen with no outline of its own: a head and one card. */
export function GenericOutline({ title }: { title?: string }): JSX.Element {
  return (
    <ScreenOutline>
      <PageContainer>
        <div className="flex flex-col gap-8">
          <PageHeadOutline title={title} />
          <div className="min-h-[220px] rounded-lg border border-border bg-card p-6">
            <OutlineBar className="h-3.5 w-[120px]" />
          </div>
        </div>
      </PageContainer>
    </ScreenOutline>
  );
}
