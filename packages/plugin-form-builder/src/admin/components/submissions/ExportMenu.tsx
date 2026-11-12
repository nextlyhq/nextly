"use client";

/**
 * Export, as the submissions list offers it: a CSV with a form's labels as
 * its columns, or JSON, of what the list shows or of the ticked rows alone.
 * Each choice is a link to the export route, so the browser downloads the
 * file the server writes.
 *
 * @module admin/components/submissions/ExportMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Download } from "lucide-react";
import type { JSX } from "react";

import {
  exportAddress,
  type SubmissionListScope,
} from "./submission-list-scope";

export function ExportMenu({
  scope,
  ids,
  heading,
  compact = false,
}: {
  /** What the list shows; a CSV needs its `form`. */
  scope: SubmissionListScope;
  /** Exactly these submissions, when rows are ticked. */
  ids?: readonly string[];
  /** What the export holds, said at the head of the menu. */
  heading: string;
  /** Drawn at the selection bar's smaller size, beside its other actions. */
  compact?: boolean;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "md"}
          className="gap-2 px-3"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {heading}
        </DropdownMenuLabel>
        {scope.form ? (
          <DropdownMenuItem asChild className="cursor-pointer">
            <a href={exportAddress(scope, "csv", ids)} download>
              CSV, with the form&apos;s labels
            </a>
          </DropdownMenuItem>
        ) : (
          // Said in the item itself rather than a tooltip, which a keyboard
          // never reaches on a disabled item.
          <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
            <span>CSV, with the form&apos;s labels</span>
            <span className="text-xs text-muted-foreground">
              Pick one form first: its labels are the columns.
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild className="cursor-pointer">
          <a href={exportAddress(scope, "json", ids)} download>
            JSON
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
