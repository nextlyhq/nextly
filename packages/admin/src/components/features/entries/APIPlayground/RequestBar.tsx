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
 * What each verb does to your data, and the two ways that is shown.
 *
 * ONE record rather than two. The action list and the request line are two
 * VIEWS of a single classification -- "this verb destroys a row" -- and a verb
 * that reads as destructive in the menu must not read as neutral once chosen.
 * Two `Record<HttpMethod, string>` maps agree on the day they are written and
 * nothing keeps them agreeing: the compiler checks that each lists every verb,
 * never that POST means success in both.
 *
 * On the chip, the COLOUR is carried by the fill and the ink stays neutral,
 * which is forced rather than chosen. The chip is `text-xs`, so it owes 4.5:1,
 * and at that size nothing coloured in this palette clears it: `text-success`
 * reaches 4.35:1 on a light page, and even the theme's own declared pairs are
 * built for large text -- measured, `success-foreground` on `bg-success` is
 * 3.43:1 in dark and `warning-foreground` on `bg-warning` is 3.27:1 in light.
 *
 * A translucent role fill flips with the mode because the role token does, and
 * `foreground` flips with it, so one pair serves both. GET stays neutral
 * because a read is not an event; the other three are things that happen to
 * your data.
 */
export const METHOD_SEMANTICS = {
  GET: { tone: "text-foreground", pill: "bg-muted text-foreground" },
  POST: { tone: "text-success", pill: "bg-success/15 text-foreground" },
  PATCH: { tone: "text-warning", pill: "bg-warning/15 text-foreground" },
  DELETE: {
    tone: "text-destructive",
    pill: "bg-destructive/15 text-foreground",
  },
} as const satisfies Record<HttpMethod, { tone: string; pill: string }>;

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
    // `overflow-hidden` is what makes the strip clip to its own rounded
    // corner, and it also clips anything a child paints outside its box --
    // which is where a focus ring lives. Every control that touches an edge
    // therefore draws its ring INSIDE, or keyboard focus disappears on the
    // outermost ones.
    <div className="flex shrink-0 items-stretch gap-px overflow-hidden rounded-lg border border-border-strong bg-border-strong">
      <div className="w-52 shrink-0 bg-background">{action}</div>

      <div className="flex flex-1 items-center gap-3 bg-background px-4 py-2.5 min-w-0">
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide",
            METHOD_SEMANTICS[method].pill
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
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
        // `ring-inset` for the same reason the icon buttons carry it: the bar
        // clips to its own rounded corner, and a ring painted outside the
        // button's box is cut off exactly where the button meets that edge.
        className="w-40 shrink-0 gap-2 rounded-none focus-visible:ring-inset"
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
