/**
 * One row of a dashboard list: the single layout every list card draws its rows with.
 *
 * Five slots, always in this order:
 * - **leading**: an icon, avatar, thumbnail, date chip or severity icon, one size per density;
 * - **title**: one line, cut with "…", whose full text shows on hover and on focus and is read
 *   whole by assistive technology (the cut is CSS, so the text itself is never shortened);
 * - **meta**: up to three fields joined by " · ", on a second line, or after the title when
 *   compact;
 * - **trailing**: a status badge and/or a relative time;
 * - **actions**: a "…" menu named for its row, shown on hover and always on keyboard focus and
 *   on touch.
 *
 * The whole row is one link to what it names, with the menu and the one visible action outside
 * it, so nothing interactive sits inside another. A row with nowhere to go is plain text.
 *
 * @module components/features/widgets/frame/entity-row
 */

import type { ListDensity } from "nextly/config";
import { Fragment, type JSX, type ReactNode } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import { LIST_ROW_HEIGHT_CLASS } from "./geometry";

/** One entry of a row's "…" menu. */
export interface EntityRowMenuItem {
  id: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

export interface EntityRowProps {
  /** The leading slot's content, drawn at the density's leading size. */
  leading?: ReactNode;
  /** The row's title as text: drawn on one line, and read whole by assistive technology. */
  title: string;
  /**
   * What assistive technology hears for the whole row, where its visible text would read badly
   * aloud: a count beside a label ("Overdue releases: 3"), or a separator the eye reads as a
   * pause (", 12 times" for " · 12 times"). The link's name on a linked row; on a plain row, read
   * in place of the row's visible text.
   */
  spoken?: string;
  /** Up to three fields for the meta line; any beyond three are not drawn. */
  meta?: readonly ReactNode[];
  /** The trailing slot: a status and/or a relative time. */
  trailing?: ReactNode;
  /** Where the row leads; a row without one is plain text, never a link that goes nowhere. */
  href?: string;
  /** The one visible action a widget may declare, drawn in the trailing slot. */
  action?: { label: string; href: string };
  /** The row's "…" menu; no menu is drawn when there is nothing in it. */
  menu?: readonly EntityRowMenuItem[];
  density: ListDensity;
}

/** The most fields a meta line holds. */
export const MAX_META_FIELDS = 3;

/**
 * A row's leading slot's size at each density; its height is the geometry's. The table form sizes
 * its leading content by the same classes, so a chip or avatar is one size in both forms.
 */
export const ENTITY_LEADING_CLASS: Readonly<Record<ListDensity, string>> = {
  default: "size-6.5",
  compact: "size-5",
};

export function EntityRow({
  leading,
  title,
  spoken,
  meta = [],
  trailing,
  href,
  action,
  menu = [],
  density,
}: EntityRowProps): JSX.Element {
  const compact = density === "compact";
  const metaLine = joinedMeta(meta);
  const body = (
    <>
      {leading !== undefined && (
        <span
          data-testid="entity-row-leading"
          className={cn(
            "flex shrink-0 items-center justify-center",
            ENTITY_LEADING_CLASS[density]
          )}
        >
          {leading}
        </span>
      )}
      <span
        className={cn(
          "flex min-w-0 flex-1",
          compact ? "items-baseline gap-2" : "flex-col justify-center"
        )}
      >
        <span
          data-testid="entity-row-title"
          className="truncate text-sm font-medium text-foreground"
        >
          {title}
        </span>
        {metaLine !== undefined && (
          <span
            data-testid="entity-row-meta"
            className="truncate text-xs text-muted-foreground"
          >
            {metaLine}
          </span>
        )}
      </span>
      {trailing !== undefined && (
        <span
          data-testid="entity-row-trailing"
          className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
        >
          {trailing}
        </span>
      )}
    </>
  );
  const rowBox = "flex min-w-0 flex-1 items-center gap-2.5";
  // What the row says aloud: its visible text, or the spoken form in its place, so a linked
  // row's name and a plain row's text are both what assistive technology hears.
  const content =
    spoken === undefined ? (
      body
    ) : (
      <>
        <span aria-hidden="true" className="contents">
          {body}
        </span>
        <span className="sr-only">{spoken}</span>
      </>
    );

  return (
    <div
      data-testid="entity-row"
      className={cn(
        "group flex min-w-0 items-center gap-2",
        LIST_ROW_HEIGHT_CLASS[density]
      )}
    >
      {/* The full title on hover and on focus, since the line may cut it, whether or not the row
          leads anywhere. Its own provider, so a row draws its tooltip wherever it is used. */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            {href === undefined ? (
              // Focusable, so a keyboard reaches the full title as a pointer does.
              <div
                tabIndex={0}
                className={cn(
                  rowBox,
                  "h-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {content}
              </div>
            ) : (
              <Link
                href={href}
                className={cn(
                  rowBox,
                  "h-full rounded-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {content}
              </Link>
            )}
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <EntityRowActions title={title} action={action} menu={menu} />
    </div>
  );
}

/**
 * A row's one visible action and its "…" menu, outside its link: drawn by the stacked row and by
 * the table form's last cell alike.
 */
export function EntityRowActions({
  title,
  action,
  menu = [],
}: Pick<EntityRowProps, "title" | "action" | "menu">): JSX.Element | null {
  if (action === undefined && menu.length === 0) return null;
  return (
    <>
      {action !== undefined && (
        <Button asChild size="sm" variant="outline" className="h-7 shrink-0">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
      {menu.length > 0 && <RowMenu title={title} items={menu} />}
    </>
  );
}

/** The meta line's fields, at most three, joined by " · "; nothing for none. */
function joinedMeta(meta: readonly ReactNode[]): ReactNode | undefined {
  const fields = meta
    .filter(field => field !== undefined && field !== null && field !== "")
    .slice(0, MAX_META_FIELDS);
  if (fields.length === 0) return undefined;
  return fields.map((field, index) => (
    // The position, because a meta line is replaced whole and its fields hold no state.
    <Fragment key={index}>
      {index > 0 && " · "}
      {field}
    </Fragment>
  ));
}

/**
 * A row's "…" menu: hidden until the row is hovered, and always shown to keyboard focus and on
 * touch, where there is no hover to reveal it. Named for its row, so a screen reader hears whose
 * actions these are.
 */
function RowMenu({
  title,
  items,
}: {
  title: string;
  items: readonly EntityRowMenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${title}`}
          className="size-7 shrink-0 opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map(item => (
          <DropdownMenuItem
            key={item.id}
            onSelect={item.onSelect}
            className={cn(item.destructive && "text-destructive")}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
