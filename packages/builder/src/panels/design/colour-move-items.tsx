"use client";

/**
 * A colour row's moves in its ⋯ menu: Move up, Move down, and Move to
 * group…, which lists the site's other named groups. Each one writes only the
 * colour's display group and the colour order, never its code name or value.
 *
 * @module colour-move-items
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { ColourGroupHostContext, useColourGroupNames } from "./colour-group-ui";
import { colourGroups, moveColour, moveColourToGroup } from "./colour-groups";

/** Where a colour sits: whether anything is above it, or below it. */
function edgesOf(
  tokens: SiteTokenSet,
  identity: string
): { first: boolean; last: boolean; group: string | undefined } {
  const flat = colourGroups(tokens).flatMap(group =>
    group.identities.map(id => ({ id, group: group.name }))
  );
  const at = flat.findIndex(entry => entry.id === identity);
  return {
    first: at <= 0,
    last: at === -1 || at === flat.length - 1,
    group: flat[at]?.group,
  };
}

export function ColourMoveItems({
  row,
  tokens,
  onChange,
}: {
  row: { readonly key: string; readonly identity: string };
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const { identity } = row;
  const host = React.useContext(ColourGroupHostContext);
  // Each move tells the panel after, so the row keeps the focus where it is
  // drawn now, in another group as well.
  const moved = (next: SiteTokenSet): void => {
    onChange(next);
    host?.onMoved?.(row, next);
  };
  const { first, last, group } = edgesOf(tokens, identity);
  // The groups there are, and any new one no colour is in yet.
  const named = useColourGroupNames();
  const others = (
    named.length > 0
      ? named
      : colourGroups(tokens).map(candidate => candidate.name)
  ).filter(name => name !== group);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={first}
        onSelect={() => moved(moveColour(tokens, identity, -1))}
      >
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={last}
        onSelect={() => moved(moveColour(tokens, identity, 1))}
      >
        Move down
      </DropdownMenuItem>
      {others.length === 0 ? null : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to group…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="nx-vars__menu">
            {others.map(name => (
              <DropdownMenuItem
                key={name}
                onSelect={() =>
                  moved(moveColourToGroup(tokens, identity, name))
                }
              >
                {name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  );
}
