/**
 * The Design panel's Block looks group: every block type's looks, its own
 * look first, each drawn as a small block of its type. Choosing a row edits
 * that look in the inspector, with no block selected.
 *
 * @module block-looks-group
 * @experimental Settles with the Design panel's Block looks group.
 */

import type {
  NamedClass,
  SiteTokenSet,
  TokenMode,
} from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import * as React from "react";

import {
  ownLookDescription,
  sameLook,
  siteBaseOf,
  type BlockLookGroup,
  type BlockLookRow,
  type LookKey,
} from "./block-look-rows";
import { ChromeTooltip } from "./chrome-tooltip";
import { blockLabel } from "./inserter";
import { LookSpecimen } from "./look-tiles-view";
import {
  sharedStyleReachSentence,
  type SharedStyleReach,
} from "./shared-style-library";

export interface BlockLooksGroupProps {
  readonly groups: readonly BlockLookGroup[];
  readonly library: readonly NamedClass[];
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
  /** The look being edited in the inspector, whose row shows as chosen. */
  readonly editing: LookKey | null | undefined;
  /** Edit a look in the inspector. Absent: the rows are shown, not chosen. */
  readonly onEdit?: (look: LookKey) => void;
  /** A worn look's reach, as the tab's usage read has it, or `undefined`. */
  readonly reachOf: (row: BlockLookRow) => SharedStyleReach | undefined;
  /** A reach drawn as the shared styles' counts are. */
  readonly chip: (reach: SharedStyleReach) => React.ReactNode;
}

/** How many looks a block type has, as its heading counts them. */
function lookCount(count: number): string {
  return count === 1 ? "1 look" : `${count} looks`;
}

export function BlockLooksGroup({
  groups,
  library,
  tokens,
  mode,
  editing,
  onEdit,
  reachOf,
  chip,
}: BlockLooksGroupProps): React.JSX.Element | null {
  const headingId = React.useId();
  if (groups.length === 0) return null;
  return (
    <section
      className="nx-vars__group nx-block-looks"
      aria-labelledby={headingId}
    >
      <div className="nx-vars__group-head">
        <h3 id={headingId} className="nx-vars__group-name">
          Block looks
        </h3>
      </div>
      {groups.map(group => {
        const title = blockLabel(group.blockType);
        const base = siteBaseOf(library, group.blockType);
        return (
          <div key={group.blockType} className="nx-block-looks__type">
            <p className="nx-block-looks__type-head">
              <span className="nx-block-looks__type-name">{title}</span>
              <span className="nx-block-looks__type-count">
                {` · ${lookCount(group.rows.length)}`}
              </span>
            </p>
            <ul className="nx-block-looks__rows" aria-label={`${title} looks`}>
              {group.rows.map(row => (
                <li key={row.id}>
                  <LookRow
                    row={row}
                    title={title}
                    chosen={sameLook(row, editing)}
                    onEdit={onEdit}
                    specimen={
                      <LookSpecimen
                        blockType={group.blockType}
                        // The own look's specimen is the site's base itself;
                        // a worn look is drawn over it.
                        base={base}
                        styles={row.own ? undefined : row.styles}
                        tokens={tokens}
                        mode={mode}
                      />
                    }
                    reach={row.own ? undefined : reachOf(row)}
                    chip={chip}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function LookRow({
  row,
  title,
  chosen,
  onEdit,
  specimen,
  reach,
  chip,
}: {
  readonly row: BlockLookRow;
  readonly title: string;
  readonly chosen: boolean;
  readonly onEdit: ((look: LookKey) => void) | undefined;
  readonly specimen: React.ReactNode;
  readonly reach: SharedStyleReach | undefined;
  readonly chip: (reach: SharedStyleReach) => React.ReactNode;
}): React.JSX.Element {
  const description = row.own ? ownLookDescription(title) : undefined;
  // The row's name says what the eye reads, the chips included, since the
  // count chip is hidden from assistive technology as a shared style's is.
  const label = [
    row.name,
    row.own ? "own look" : row.className,
    ...(reach === undefined
      ? []
      : [sharedStyleReachSentence(undefined, reach)]),
  ]
    .filter(part => part !== "")
    .join(", ");
  const content = (
    <>
      <span className="nx-block-looks__specimen">{specimen}</span>
      <span className="nx-shared-styles__names">
        <span className="nx-vars__name" title={row.name}>
          {row.name}
        </span>
        <span className="nx-shared-styles__class">
          {row.own ? "own look" : row.className}
        </span>
      </span>
      {row.own ? (
        // The own look has no count of its own: the chip says what it
        // covers, on hover and to a screen reader.
        <TooltipProvider delayDuration={300}>
          <ChromeTooltip side="bottom" align="end" content={description}>
            <span className="nx-vars__chip nx-block-looks__default">
              Default
            </span>
          </ChromeTooltip>
        </TooltipProvider>
      ) : reach === undefined ? null : (
        chip(reach)
      )}
    </>
  );
  if (onEdit === undefined) {
    return <div className="nx-vars__row nx-block-looks__row">{content}</div>;
  }
  return (
    <button
      type="button"
      className="nx-vars__row nx-block-looks__row"
      aria-pressed={chosen}
      aria-label={label}
      aria-description={description}
      data-block-look={row.id}
      onClick={() => onEdit({ id: row.id, blockType: row.blockType })}
    >
      {content}
    </button>
  );
}
