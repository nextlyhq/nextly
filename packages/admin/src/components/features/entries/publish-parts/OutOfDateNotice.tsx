"use client";

/**
 * The notice after a publish that left translations out of date: which languages, how many
 * fields, and a link to translate each. It stays until dismissed rather than timing out, so a
 * keyboard user reaches its links; it is a status, not an alert, since nothing is wrong with the
 * publish itself.
 *
 * Neutral, as the editor's other notices are: being out of date is said in words, and the
 * admin's colours are kept for status marks.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/OutOfDateNotice
 */

import type { JSX } from "react";

import { Languages, X } from "@admin/components/icons";
import { Button } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import type { OutOfDateNoticeContent } from "./out-of-date";

export interface OutOfDateNoticeProps {
  /** What to say, or null to draw nothing. */
  notice: OutOfDateNoticeContent | null;
  onDismiss: () => void;
  className?: string;
}

export function OutOfDateNotice({
  notice,
  onDismiss,
  className,
}: OutOfDateNoticeProps): JSX.Element | null {
  if (notice === null) return null;
  return (
    <div
      role="status"
      data-out-of-date-notice=""
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm",
        className
      )}
    >
      <Languages
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-foreground">{notice.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {notice.languages.map(language => (
          <Button key={language.locale} asChild size="sm" variant="outline">
            <Link href={language.href}>Translate {language.label}</Link>
          </Button>
        ))}
        {/* Named for assistive technology: an unlabelled X reads as "button" alone. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss the out-of-date notice"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
