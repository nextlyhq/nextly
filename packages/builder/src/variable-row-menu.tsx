/**
 * A variable row's ⋯ menu: Rename, Duplicate, a colour's moves, the dark
 * value, and Remove or, for a variable the site's code supplies, Reset to
 * built-in.
 *
 * Remove opens the row's editor at its confirm rather than removing from the
 * menu, so the one removal there is, with its check of where the variable
 * is used, is the one that runs. The menu is told when an item hands focus
 * to something else (the name field, an editor) so closing it does not take
 * focus back to the ⋯.
 *
 * @module variable-row-menu
 */
import type { SiteToken, SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Ellipsis } from "lucide-react";
import * as React from "react";

import { ColourMoveItems } from "./colour-move-items";
import {
  clearDarkValue,
  setTokenValue,
  type VariableEntry,
} from "./tokens-studio";
import { partsOf, removalPlan, resetParts } from "./variable-removal";
import type { VariableUsageHere } from "./variable-usage-view";

/** What the row does for the menu's items that leave the menu. */
export interface RowMenuActions {
  /** Edit the name in place in the row. */
  readonly onRename: () => void;
  /** Add a copy right below, and open it. */
  readonly onDuplicate: () => void;
  /** Open the row's editor; `removing` starts its Remove. */
  readonly onEdit: (removing: boolean) => void;
}

/** The kinds a dark value is offered on: what reads differently in dark. */
const DARK_KINDS: ReadonlySet<string> = new Set(["color", "shadow"]);

export function RowMenu({
  entry,
  token,
  tokens,
  suppliedOf,
  usage,
  label,
  open,
  onOpenChange,
  onChange,
  actions,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  suppliedOf: (identity: string) => SiteToken | undefined;
  usage: VariableUsageHere | undefined;
  /** The row's name as it is read, for the ⋯ button's own name. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (tokens: SiteTokenSet) => void;
  actions: RowMenuActions;
}): React.JSX.Element {
  const plan = removalPlan(
    entry,
    partsOf(entry, token, tokens, suppliedOf),
    usage
  );
  // Set by an item that moves focus elsewhere, read as the menu closes.
  const handingOff = React.useRef(false);
  const handOff = (then: () => void) => () => {
    handingOff.current = true;
    then();
  };
  const at = entry.row.at;
  const dark = token.values.dark !== undefined;
  const builtIn = plan.removable.length === 0;
  return (
    // Not modal: a modal menu marks the panel around it aria-hidden while
    // its rows stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-vars__icon-button nx-vars__more"
          aria-label={`More actions for ${label}`}
        >
          <Ellipsis aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="nx-vars__menu"
        onCloseAutoFocus={event => {
          if (!handingOff.current) return;
          handingOff.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={handOff(actions.onRename)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handOff(actions.onDuplicate)}>
          Duplicate
        </DropdownMenuItem>
        {entry.row.kind === "color" ? (
          <ColourMoveItems
            identity={entry.row.identity}
            tokens={tokens}
            onChange={onChange}
          />
        ) : null}
        {dark ? (
          // Offered on any kind that holds one, as an import can leave on
          // a size, so it can be taken away; it is used until it is.
          <DropdownMenuItem
            onSelect={() => onChange(clearDarkValue(tokens, at))}
          >
            Remove dark value
          </DropdownMenuItem>
        ) : DARK_KINDS.has(entry.row.kind) ? (
          <DropdownMenuItem
            onSelect={handOff(() => {
              // Starts as light, so nothing changes until the author picks
              // the dark value in the editor that opens.
              onChange(setTokenValue(tokens, at, "dark", token.values.light));
              actions.onEdit(false);
            })}
          >
            Add dark value
          </DropdownMenuItem>
        ) : null}
        {builtIn ? null : (
          <DropdownMenuItem onSelect={handOff(() => actions.onEdit(true))}>
            {plan.label}
          </DropdownMenuItem>
        )}
        {plan.changed.length === 0 && !builtIn ? null : (
          <DropdownMenuItem
            disabled={plan.changed.length === 0}
            onSelect={() => onChange(resetParts(tokens, plan.changed))}
          >
            Reset to built-in
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
