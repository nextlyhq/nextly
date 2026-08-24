"use client";

/**
 * The request line: method, URL, and Send.
 *
 * Pinned above both panes because it is the one part of the page that is
 * always relevant — it says what will be sent, and sends it. It used to sit at
 * the foot of the request pane, so a long parameter list pushed the URL and
 * the Send button off-screen exactly when the request was worth checking.
 *
 * The URL is derived from the action and the parameters rather than typed, so
 * it reads as output: selectable and copyable, but not an input.
 *
 * @module components/entries/APIPlayground/RequestBar
 */

import { Button } from "@nextlyhq/ui";

import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Play,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { HttpMethod } from "./APIPlayground";

/**
 * Method colours, by what the verb does to your data.
 *
 * Exported so the action list reads the same as the bar: a verb that means
 * "destroys a row" should not be one colour in the menu and another once
 * chosen.
 */
export const METHOD_TONE: Record<HttpMethod, string> = {
  GET: "text-foreground",
  POST: "text-success",
  PATCH: "text-warning",
  DELETE: "text-destructive",
};

/**
 * The same meanings as a chip, for the request line.
 *
 * The verb is the first thing read on that line and bare coloured text is easy
 * to skim past, which matters most for the one that destroys a row.
 *
 * The COLOUR is carried by the fill and the ink stays neutral, which is forced
 * rather than chosen. This chip is `text-xs`, so it owes 4.5:1, and at that
 * size nothing coloured in this palette clears it: `text-success` reaches
 * 4.35:1 on a light page, and even the theme's own declared pairs are built for
 * large text -- measured, `success-foreground` on `bg-success` is 3.43:1 in
 * dark and `warning-foreground` on `bg-warning` is 3.27:1 in light.
 *
 * A translucent role fill flips with the mode because the role token does, and
 * `foreground` flips with it, so one pair serves both. GET stays neutral
 * because a read is not an event; the other three are things that happen to
 * your data.
 */
export const METHOD_PILL: Record<HttpMethod, string> = {
  GET: "bg-muted text-foreground",
  POST: "bg-success/15 text-foreground",
  PATCH: "bg-warning/15 text-foreground",
  DELETE: "bg-destructive/15 text-foreground",
};

export interface RequestBarProps {
  method: HttpMethod;
  /** The absolute URL that will be requested. */
  url: string;
  /**
   * The endpoint picker.
   *
   * Passed in rather than built here: it is the control that decides both the
   * method and the path, so it belongs on the line that shows them — the same
   * place every API client puts its method dropdown.
   */
  action: React.ReactNode;
  isLoading: boolean;
  copied: boolean;
  onSend: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onOpen: () => void;
}

export function RequestBar({
  method,
  url,
  action,
  isLoading,
  copied,
  onSend,
  onCancel,
  onCopy,
  onOpen,
}: RequestBarProps) {
  return (
    <div className="flex shrink-0 items-stretch gap-px overflow-hidden rounded-lg border border-border-strong bg-border-strong">
      <div className="w-52 shrink-0 bg-background">{action}</div>

      <div className="flex flex-1 items-center gap-3 bg-background px-4 py-2.5 min-w-0">
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide",
            METHOD_PILL[method]
          )}
        >
          {method}
        </span>
        {/* select-all: the whole URL is the unit worth copying, and it is one
            double-click away rather than a careful drag. */}
        <code className="min-w-0 flex-1 select-all truncate font-mono text-xs text-muted-foreground">
          {url}
        </code>
      </div>

      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "URL copied" : "Copy request URL"}
        title="Copy request URL"
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      <button
        type="button"
        onClick={onOpen}
        aria-label="Open request URL in a new tab"
        title="Open in a new tab"
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>

      <Button
        type="button"
        onClick={isLoading ? onCancel : onSend}
        // The shortcut is on the label because a control you can only reach
        // with the mouse teaches nobody it has a keyboard.
        title={isLoading ? "Cancel (Esc)" : "Send request (⌘↵)"}
        // Square deliberately: the bar clips to its own corner now, so a
        // rounded button inside it would draw a second curve just inside the
        // first. This is the overlapped-strip case theme.css names, not an
        // element that missed the radius knob.
        className="w-40 shrink-0 gap-2 rounded-none"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cancel
            <kbd className="font-mono text-xs opacity-60">Esc</kbd>
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            Send
            <kbd className="font-mono text-xs opacity-60">⌘↵</kbd>
          </>
        )}
      </Button>
    </div>
  );
}
