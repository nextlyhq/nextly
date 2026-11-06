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
  siteBaseOf,
  type BlockLookGroup,
  type BlockLookRow,
} from "./block-look-rows";
import { ChromeTooltip } from "./chrome-tooltip";
import { blockLabel } from "./inserter";
import { LookSpecimen } from "./look-tiles-view";

export interface BlockLooksGroupProps {
  readonly groups: readonly BlockLookGroup[];
  readonly library: readonly NamedClass[];
  readonly tokens: SiteTokenSet | undefined;
  readonly mode: TokenMode;
  /** The look being edited in the inspector, whose row shows as chosen. */
  readonly editingId: string | null | undefined;
  /** Edit a look in the inspector. Absent: the rows are shown, not chosen. */
  readonly onEdit?: (lookId: string) => void;
  /** A worn look's count, drawn as the shared styles' counts are. */
  readonly countOf: (row: BlockLookRow) => React.ReactNode;
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
  editingId,
  onEdit,
  countOf,
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
                    chosen={editingId === row.id}
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
                    count={row.own ? null : countOf(row)}
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
  count,
}: {
  readonly row: BlockLookRow;
  readonly title: string;
  readonly chosen: boolean;
  readonly onEdit: ((lookId: string) => void) | undefined;
  readonly specimen: React.ReactNode;
  readonly count: React.ReactNode;
}): React.JSX.Element {
  const description = row.own ? ownLookDescription(title) : undefined;
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
      ) : (
        count
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
      aria-description={description}
      data-block-look={row.id}
      onClick={() => onEdit(row.id)}
    >
      {content}
    </button>
  );
}
