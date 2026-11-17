"use client";

/**
 * The block panel's options menu (⋯), beside its tabs: Expand all and
 * Collapse all fold every section of the tab that is showing.
 *
 * @module panel-options
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Ellipsis } from "lucide-react";
import * as React from "react";

import { withTabFold } from "./panel-folds";
import { usePanelFolds } from "./panel-folds-context";

/** The ⋯ menu for the tab that is showing. */
export function PanelOptions({ tab }: { tab: string }): React.JSX.Element {
  const { change } = usePanelFolds();
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
