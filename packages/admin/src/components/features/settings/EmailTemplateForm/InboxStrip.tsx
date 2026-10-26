"use client";

/**
 * The email as an inbox lists it: who it's from, the subject, and the preview
 * text after it. The three fields an author writes for this one line, seen
 * together above the fields themselves.
 */

/** The display name of a From value: `Name <address>` gives the name. */
import type { JSX } from "react";

function senderName(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  return (named ? named[1] : from).trim();
}

/** The three fields of the inbox line. */
export interface InboxLine {
  subject: string;
  preheader: string;
  from: string;
}

/**
 * What the inbox line shows: the server's render once there is one, a field
 * that renders empty included, since that is what a reader sees; the text as
 * written only until the first render arrives.
 */
export function shownInboxLine(
  written: InboxLine,
  rendered: { subject: string; preheader: string; from: string | null } | null
): InboxLine {
  if (!rendered) return written;
  return {
    subject: rendered.subject,
    preheader: rendered.preheader,
    from: rendered.from ?? "",
  };
}

export function InboxStrip({
  from,
  subject,
  preheader,
}: {
  /** The template's From, or empty when the provider's sender is used. */
  from: string;
  subject: string;
  preheader: string;
}): JSX.Element {
  const sender = from.trim() ? senderName(from) : "Your default sender";
  return (
    <div
      data-testid="inbox-strip"
      aria-label="How the email appears in an inbox"
      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3"
    >
      <div
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold"
      >
        {sender.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{sender}</div>
        <div className="truncate text-sm">
          <span className="font-medium">{subject || "(no subject)"}</span>
          {preheader ? (
            <span className="text-muted-foreground"> — {preheader}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
