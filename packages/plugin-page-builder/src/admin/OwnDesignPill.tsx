"use client";

/**
 * The one mark of an entry's own design, the same on the entry list, the
 * entry's Design section and the template's list: "Own design", or, while
 * its design is not published, a dashed "Own design · not published" that
 * says what visitors see instead.
 *
 * One pill rather than a design pill beside a status pill: whether the
 * design is published is part of what the mark says, so a second pill would
 * repeat it. Never colour alone: the brush icon and the words carry it, and
 * the dashed outline repeats "not published" for a sighted reader skimming a
 * column. Drawn from the admin's primary tokens, so it holds in both themes.
 *
 * @module admin/OwnDesignPill
 */
import { Brush } from "lucide-react";
import type { JSX } from "react";

import { OWN_DESIGN_WORDS } from "./entry-designs-client";

export interface OwnDesignPillProps {
  /** Whether the own design is published, so visitors see it. */
  readonly published: boolean;
  /**
   * The collection template's title, which visitors see while the own design
   * is not published; null where there is none to name.
   */
  readonly template: string | null;
}

export function OwnDesignPill({
  published,
  template,
}: OwnDesignPillProps): JSX.Element {
  const explained = published
    ? undefined
    : OWN_DESIGN_WORDS.unpublishedExplained(template);
  return (
    <span
      className={[
        "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold text-primary",
        published
          ? "bg-primary/10 ring-1 ring-inset ring-primary/30 dark:bg-primary/20"
          : "border border-dashed border-primary bg-transparent",
      ].join(" ")}
      // The pointer's explanation; a reader is told it in the words below.
      {...(explained === undefined ? {} : { title: explained })}
      data-own-design={published ? "published" : "unpublished"}
    >
      <Brush className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {published ? OWN_DESIGN_WORDS.pill : OWN_DESIGN_WORDS.pillUnpublished}
      </span>
      {explained === undefined ? null : (
        <span className="sr-only">{`. ${explained}.`}</span>
      )}
    </span>
  );
}
