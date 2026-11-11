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
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nextlyhq/ui";
import { cardHeightPx } from "nextly/card-geometry";
import { GRID_COLUMNS } from "nextly/config";
import { CORE_DEFAULT_LAYOUT } from "nextly/core-widget-data";
import type { CSSProperties, JSX, ReactNode } from "react";

import {
  cardSpanClass,
  GRID_CLASS,
} from "@admin/components/features/widgets/sizes";
import {
  ChevronDown,
  Eye,
  History,
  MoreHorizontal,
  PanelRight,
} from "@admin/components/icons";
import { TopBarPlace } from "@admin/components/layout/header/TopBarPlaces";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared/breadcrumbs";
import { cn } from "@admin/lib/utils";

import { LOADING_FRAME_TIMES, useDelayedReveal } from "./delayed-reveal";
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
      className={className}
    >
      {shown ? children : null}
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
 * A table with its real head where its columns are known, and five outline
 * rows: a title, then shorter, softer values in the other columns.
 */
export function TableOutline({
  headers,
}: {
  /** The column heads, when the columns are known. */
  headers?: readonly ReactNode[];
}): JSX.Element {
  const columns: readonly ReactNode[] = headers ?? [null, null, null];
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((header, index) => (
              <TableHead
                key={index}
                className={cn("py-3", NARROW_HIDDEN(index))}
              >
                {header ?? (
                  <OutlineBar
                    soft
                    className={cn("h-3", index === 0 ? "w-16" : "w-12")}
                  />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROW_TITLE_WIDTHS.map((width, row) => (
            <TableRow key={row} className="border-b border-border">
              {columns.map((_, index) => (
                <TableCell
                  key={index}
                  className={cn("h-12 py-3", NARROW_HIDDEN(index))}
                >
                  {index === 0 ? (
                    <OutlineBar
                      className="block h-3 max-w-full"
                      style={{ width }}
                    />
                  ) : (
                    <OutlineBar
                      soft
                      className={cn("block h-3", index === 1 ? "w-16" : "w-11")}
                    />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A collection's (or any list's) page: its head, then its table. */
export function ListOutline({
  title,
  headers,
  actions = [72, 112],
  framed = true,
}: {
  title?: string;
  headers?: readonly ReactNode[];
  actions?: readonly number[];
  /** `false` where the screen draws the outline inside its own container. */
  framed?: boolean;
}): JSX.Element {
  return (
    <ScreenOutline>
      <PageFrame framed={framed}>
        <div className="flex flex-col gap-8">
          <PageHeadOutline title={title} actions={actions} />
          {/* The list's toolbar (its search, then Filter and Columns) above
              the table, at the list's own spacing. */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <ControlOutline className="w-full max-w-[384px]" />
              <div className="flex gap-2 max-sm:hidden">
                <ControlOutline className="w-[106px]" />
                <ControlOutline className="w-[130px]" />
              </div>
            </div>
            <TableOutline headers={headers} />
          </div>
        </div>
      </PageFrame>
    </ScreenOutline>
  );
}

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
            // A card of the default's four rows; the real card is as tall as
            // its content, which no outline can know.
            // The height a real card of four rows takes, from the grid's own
            // geometry, so the outline stands as tall as the card it precedes.
            style={{ minHeight: cardHeightPx(4) }}
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
          <div className="grid grid-cols-2 gap-4 @2xl/content:grid-cols-4 @5xl/content:grid-cols-6">
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

/** A disabled control of the editor bar's outline. */
function BarButton({
  children,
  primary = false,
  label,
  joined,
  narrow = false,
}: {
  children: ReactNode;
  primary?: boolean;
  label?: string;
  /** Which half of a split button this is. */
  joined?: "start" | "end";
  /** An icon on the bar's tight padding, as More and the panel toggle are. */
  narrow?: boolean;
}): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={primary ? "default" : "outline"}
      disabled
      aria-disabled="true"
      aria-label={label}
      className={cn(
        "gap-1.5",
        narrow && "px-2",
        joined === "start" && "rounded-r-none",
        joined === "end" &&
          "rounded-l-none border-l border-primary-foreground/20 px-2"
      )}
    >
      {children}
    </Button>
  );
}

/**
 * The editor's bar while its document loads: the same right-hand controls the
 * real bar draws (History, Preview, the Publish split, More, the panel toggle),
 * disabled, so the bar keeps their width and nothing in it moves when the
 * document arrives. Drawn at once, as part of the frame, not after 0.4 s.
 */
function EditorBarOutline(): JSX.Element {
  return (
    <TopBarPlace name="end">
      <div
        data-testid="editor-bar-outline"
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-3"
      >
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
        <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
          {/* History and Preview as the bar draws them beside a document's
              trail: their icons, their words stepped aside. */}
          <span className="contents max-lg:hidden">
            <BarButton label="History">
              <History className="h-4 w-4" aria-hidden="true" />
            </BarButton>
            <BarButton label="Preview">
              <Eye className="h-4 w-4" aria-hidden="true" />
            </BarButton>
          </span>
          {/* The primary action and its menu, joined as the real split is. */}
          <span className="flex">
            <BarButton primary joined="start">
              Publish
            </BarButton>
            <BarButton primary joined="end" label="More publishing actions">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </BarButton>
          </span>
          <BarButton label="More" narrow>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </BarButton>
          <span className="contents max-lg:hidden">
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <BarButton label="Document panel" narrow>
              <PanelRight className="h-4 w-4" aria-hidden="true" />
            </BarButton>
          </span>
        </div>
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
}: {
  /** The document panel's width beside the fields, in pixels. */
  sideWidth?: number;
  /** The editor's field column inset, from the editor itself. */
  columnClassName?: string;
  /** The editor's field column measure, from the editor itself. */
  columnStyle?: CSSProperties;
}): JSX.Element {
  return (
    <>
      <EditorBarOutline />
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
