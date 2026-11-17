/**
 * One row of the Shared styles tab: its tile and the paint it is drawn from,
 * its accessible name, the row with its popover editor, the dark-mode tip,
 * its content and its reach chip.
 *
 * @module shared-style-row
 */

import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  TooltipProvider,
} from "@nextlyhq/ui";
import { Lock, Moon } from "lucide-react";
import * as React from "react";

import { usePrefersDark } from "./canvas/prefers-dark";
import { ChromeTooltip } from "./chrome-tooltip";
import type { TokenMode } from "./font-library";
import { SharedStyleDetails } from "./shared-style-details";
import {
  sharedStyleTile,
  SHARED_STYLE_DARK_UNREADABLE,
  sharedStylePreview,
  sharedStyleReachChip,
  sharedStyleReachSentence,
  type SharedStyleReach,
  type SharedStyleRow,
  type SharedStyleTile,
} from "./shared-style-library";
import { activeTokenMode } from "./style-colour";

/** What each row's tile is drawn from: the site's variables, in the canvas's mode. */
export interface TilePaint {
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
}

/** The site's variables and the mode the canvas shows, for every row's tile. */
export function usePaint(tokens: SiteTokenSet | undefined): TilePaint {
  return { tokens, mode: activeTokenMode(usePrefersDark()) };
}

/** A row's accessible name: its name, class name, marks and reach in words. */
function rowLabel(
  row: SharedStyleRow,
  name: string,
  sentence: string,
  tile: SharedStyleTile
): string {
  return [
    name,
    row.className,
    ...(row.locked ? ["locked"] : []),
    ...(row.inCode ? ["set in your site’s code"] : []),
    ...(tile.darkUnreadable ? [SHARED_STYLE_DARK_UNREADABLE] : []),
    ...(sentence === "" ? [] : [sentence]),
  ].join(", ");
}

/** What a row's details are handed beside the row and its name. */
type RowDetails = Omit<
  React.ComponentProps<typeof SharedStyleDetails>,
  "row" | "name" | "sentence"
>;

/** One shared style: a row that opens its details beside the panel. */
export function StyleRow({
  row,
  name,
  details,
  paint,
  open,
  onOpenChange,
}: {
  row: SharedStyleRow;
  name: string;
  details: RowDetails;
  /** What the row's preview tile is drawn from. */
  paint: TilePaint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const sentence = sharedStyleReachSentence(details.blocks, details.reach);
  const tile = sharedStyleTile(
    paint.tokens,
    paint.mode,
    sharedStylePreview(row.styles, details.styleContext)
  );
  // A name that can't be changed is not focused, and so not selected, on
  // open: selected text reads as editable. The details take focus instead.
  const fixed = details.readOnly || row.locked || row.inCode;
  const content = React.useRef<HTMLDivElement>(null);
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <DarkModeTip shown={tile.darkUnreadable}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-vars__row nx-shared-styles__row"
              aria-label={rowLabel(row, name, sentence, tile)}
              title={sentence === "" ? undefined : sentence}
              data-shared-style={row.id}
            >
              <RowContent
                row={row}
                name={name}
                reach={details.reach}
                tile={tile}
              />
            </button>
          </PopoverTrigger>
        </DarkModeTip>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor nx-shared-styles__editor"
          aria-label={name}
          ref={content}
          onOpenAutoFocus={
            fixed
              ? event => {
                  event.preventDefault();
                  content.current?.focus();
                }
              : undefined
          }
        >
          <SharedStyleDetails
            {...details}
            row={row}
            name={name}
            sentence={sentence}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

/**
 * The row's "Hard to read in dark mode" tooltip, shown when the row is
 * hovered or focused, so keyboard and touch users meet it too; the row's
 * accessible name says it as well. Nothing is added inside the row button,
 * which is already the one control.
 */
function DarkModeTip({
  shown,
  children,
}: {
  shown: boolean;
  children: React.ReactElement;
}): React.JSX.Element {
  if (!shown) return children;
  return (
    <TooltipProvider delayDuration={300}>
      {/* The editor's own tooltip, which closes as the pointer moves onto the
          canvas; to the right of the row, as before. */}
      <ChromeTooltip side="right" content={SHARED_STYLE_DARK_UNREADABLE}>
        {children}
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** A row's preview, name and class name, lock, and count. */
function RowContent({
  row,
  name,
  reach,
  tile,
}: {
  row: SharedStyleRow;
  name: string;
  reach: SharedStyleReach | undefined;
  tile: SharedStyleTile;
}): React.JSX.Element {
  return (
    <>
      {/* The page under the preview, so its colours read as on the site; the
          light page, marked, where the style is hard to read on the dark. */}
      <span
        className="nx-shared-styles__tile"
        aria-hidden="true"
        style={tile.page}
        data-dark-unreadable={tile.darkUnreadable ? "" : undefined}
      >
        {/* Outlined: its outline is inline, chosen against its own
            background; the class marks it. */}
        <span
          className={
            tile.outlined
              ? "nx-vars__specimen nx-shared-styles__lead nx-shared-styles__lead--outlined"
              : "nx-vars__specimen nx-shared-styles__lead"
          }
          style={tile.specimen}
        >
          Aa
        </span>
        {tile.darkUnreadable ? (
          <Moon className="nx-shared-styles__dark-flag" size={8} />
        ) : null}
      </span>
      <span className="nx-shared-styles__names">
        <span className="nx-vars__name" title={name}>
          {name}
        </span>
        <span className="nx-shared-styles__class">{row.className}</span>
      </span>
      {row.locked ? (
        <Lock className="nx-shared-styles__lock" aria-hidden="true" size={12} />
      ) : null}
      {row.inCode ? (
        <span className="nx-vars__chip" aria-hidden="true">
          In code
        </span>
      ) : null}
      {reach === undefined ? null : <ReachChip reach={reach} />}
    </>
  );
}

/** A row's count, muted while it is a zero not counted yet. */
export function ReachChip({
  reach,
}: {
  reach: SharedStyleReach;
}): React.JSX.Element {
  const chip = sharedStyleReachChip(reach);
  return (
    <span
      className={
        chip.uncounted
          ? "nx-vars__chip nx-shared-styles__count--uncounted"
          : "nx-vars__chip"
      }
      aria-hidden="true"
      // Each kind in words on hover, which "5 places" totals; the row's
      // name says the same to a screen reader.
      title={sharedStyleReachSentence(undefined, reach) || undefined}
    >
      {chip.words}
    </span>
  );
}
