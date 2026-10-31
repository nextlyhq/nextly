"use client";

/**
 * MediaUsedIn
 *
 * Where an item is used: each document the reader may open, as a link to it,
 * with its collection or Single, the fields that use the item, and the
 * languages when only some use it; then how many more documents use it that
 * the reader may not open, never naming them. The details panel, the viewer
 * and the delete dialog all show it the same way.
 */

import * as React from "react";

import { Loader2 } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";

import type { MediaUsage, MediaUse } from "../media-library-api";
import { useMediaUsage } from "../media-library-queries";

/** The admin page a document using the item opens at. */
function mediaUseHref(use: MediaUse): string {
  if (use.kind === "single") {
    return buildRoute(ROUTES.SINGLE_EDIT, { slug: use.slug });
  }
  if (use.kind === "email-template") {
    return buildRoute(ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT, {
      id: use.documentId,
    });
  }
  return buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
    slug: use.slug,
    id: use.documentId,
  });
}

/** The fields that use the item, with the languages where only some do. */
function fieldsText(use: MediaUse): string {
  return use.fields
    .map(field =>
      field.locales.length > 0
        ? `${field.path} (${field.locales.map(l => l.toUpperCase()).join(", ")})`
        : field.path
    )
    .join(", ");
}

/** "N places", for a heading or a sentence. */
export function placesText(count: number): string {
  return `${count} ${count === 1 ? "place" : "places"}`;
}

/**
 * The documents the reader may not open, counted and never named: "And 2
 * more places you can't open", or on their own, "Used in 1 place you can't
 * open".
 */
function hiddenUsesText(hidden: number, afterOthers: boolean): string {
  return afterOthers
    ? `And ${hidden} more ${hidden === 1 ? "place" : "places"} you can't open.`
    : `Used in ${placesText(hidden)} you can't open.`;
}

/** How many uses there are in all, the ones not shown included. */
export function usageTotal(usage: MediaUsage): number {
  return usage.items.length + usage.hidden;
}

/** The list of uses, from an answer already in hand. */
export function MediaUsageList({
  usage,
}: {
  usage: MediaUsage;
}): React.JSX.Element {
  if (usageTotal(usage) === 0) {
    return (
      <p className="text-sm text-muted-foreground">Not used anywhere yet.</p>
    );
  }
  return (
    <div className="flex flex-col">
      {usage.items.length > 0 && (
        <ul className="flex flex-col">
          {usage.items.map(use => (
            <li
              key={`${use.kind} ${use.slug} ${use.documentId}`}
              className="border-b border-border last:border-b-0"
            >
              <Link
                href={mediaUseHref(use)}
                className="flex flex-col gap-0.5 rounded-sm py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {use.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {use.owner}
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {fieldsText(use)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {usage.hidden > 0 && (
        <p className="pt-2 text-xs text-muted-foreground">
          {hiddenUsesText(usage.hidden, usage.items.length > 0)}
        </p>
      )}
    </div>
  );
}

/** Where an item is used, as the library has asked for it. */
export interface MediaUsageState {
  data?: MediaUsage;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

/** The library's answer for one item, in the shape the details take. */
export function useMediaUsageState(mediaId: string | null): MediaUsageState {
  const { data, isLoading, isError, refetch } = useMediaUsage(mediaId);
  return {
    data,
    isLoading,
    isError,
    retry: () => void refetch(),
  };
}

/** The Used in section of an item's details. */
export function MediaUsedIn({
  usage,
}: {
  usage: MediaUsageState;
}): React.JSX.Element {
  const { data, isLoading, isError, retry } = usage;
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3
        id={headingId}
        className="text-xs font-semibold text-muted-foreground"
      >
        Used in{data ? ` ${usageTotal(data)}` : ""}
      </h3>
      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Finding where it is used…
        </p>
      )}
      {isError && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load where this is used.{" "}
          <button
            type="button"
            onClick={retry}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      )}
      {data && <MediaUsageList usage={data} />}
    </section>
  );
}
