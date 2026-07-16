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
    <div className="flex shrink-0 items-stretch gap-px border border-border-strong bg-border-strong">
      <div className="w-52 shrink-0 bg-background">{action}</div>

      <div className="flex flex-1 items-center gap-3 bg-background px-4 py-2.5 min-w-0">
        <span
          className={cn(
            "shrink-0 font-mono text-xs font-semibold tracking-wide",
            METHOD_TONE[method]
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
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
        className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>

      <Button
        type="button"
        onClick={isLoading ? onCancel : onSend}
        // The shortcut is on the label because a control you can only reach
        // with the mouse teaches nobody it has a keyboard.
        title={isLoading ? "Cancel (Esc)" : "Send request (⌘↵)"}
        className="w-40 shrink-0 gap-2 rounded-none"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cancel
            <kbd className="font-mono text-[10px] opacity-60">Esc</kbd>
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            Send
            <kbd className="font-mono text-[10px] opacity-60">⌘↵</kbd>
          </>
        )}
      </Button>
    </div>
  );
}
