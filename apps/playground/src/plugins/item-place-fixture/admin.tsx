"use client";

/**
 * The item place fixtures' admin components, registered by a side-effect
 * import, as a real app loads a plugin's admin components.
 *
 * Both are drawn only with classes the admin already draws itself with (the
 * rail foot's Inbox button, its tooltips, its dialogs' text), so they are in
 * its stylesheet without a safelist entry, and with `--nx-*` tokens only, so
 * light and dark come from the admin's theme.
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { RELEASE_NOTES_BUTTON_PATH, WHATS_NEW_DIALOG_PATH } from "./constants";

/** The same box, hover and focus ring as the rail foot's Inbox button. */
const RAIL_FOOT_BUTTON =
  "relative flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group";

/** A newspaper, drawn as the admin's line icons are: 24px grid, 2px stroke. */
function NewspaperIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors"
    >
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  );
}

/**
 * The release notes, from the rail's foot: a quiet icon link named for what
 * it opens, with the rail's tooltip. Its own tooltip provider, so it needs
 * nothing from the page around it.
 */
export function ReleaseNotesButton(): JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <a
            href="https://github.com/nextlyhq/nextly/releases"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Release notes"
            className={RAIL_FOOT_BUTTON}
          >
            <NewspaperIcon />
          </a>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="bg-primary border-border text-primary-foreground"
        >
          Release notes
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** What the What's new item opens: a few lines, and a way out. */
export function WhatsNewDialogBody({
  onClose,
}: {
  onClose?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 text-sm text-foreground">
      <p className="text-muted-foreground">
        The latest changes to your admin, in brief.
      </p>
      <ul className="flex flex-col gap-2">
        <li>Plugins can place their own item at the rail&apos;s foot.</li>
        <li>Help links and plugin items share one menu group.</li>
        <li>Panels remember whether you folded them.</li>
      </ul>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

registerComponents({
  [RELEASE_NOTES_BUTTON_PATH]: ReleaseNotesButton,
  [WHATS_NEW_DIALOG_PATH]: WhatsNewDialogBody,
});
