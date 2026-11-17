"use client";

/**
 * The block panel's options menu (⋯), beside its tabs: Expand all and
 * Collapse all fold every section of the tab that is showing, and Show CSS
 * names prints what each control writes under its label.
 *
 * @module panel-options
 */
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Ellipsis } from "lucide-react";
import * as React from "react";

import { useCssNames } from "./css-names-context";
import { withTabFold } from "./panel-folds";
import { usePanelFolds } from "./panel-folds-context";

/** The ⋯ menu for the tab that is showing. */
export function PanelOptions({ tab }: { tab: string }): React.JSX.Element {
  const { change } = usePanelFolds();
  const cssNames = useCssNames();
  const foldAll = (open: boolean) =>
    change(current => withTabFold(current, tab, open));
  return (
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-inspector__options"
          aria-label="Panel options"
        >
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => foldAll(true)}>
          Expand all
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => foldAll(false)}>
          Collapse all
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* For developers: each control's CSS property names, printed
            small under its label. */}
        <DropdownMenuCheckboxItem
          checked={cssNames.shown}
          onCheckedChange={shown => cssNames.set(shown === true)}
        >
          Show CSS names
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
