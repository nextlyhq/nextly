/**
 * The edit page's read-only SEO lines in its side panel: whether search
 * engines list the page and how many things there are to fix, and whether
 * how results may show it is the site's or the page's own. The SEO tab
 * works the page's answer out; it tells this line what it found, so the two
 * never count the page differently and the line asks the server nothing.
 *
 * @module admin/status
 */
import type { SidebarSectionProps } from "@nextlyhq/plugin-sdk/admin";
import { useSyncExternalStore, type ReactNode } from "react";

import { inSentence } from "./parts";

/** What the line says about one document in one language. */
export interface SeoStatus {
  /** Listed, hidden by the page itself, or hidden with its whole type. */
  listing: "listed" | "page" | "type";
  /** How many things there are to fix on the page. */
  count: number;
  /** The content type's name for one of its pages. */
  typeLabel: string;
  /**
   * How results may show the page: as the site's defaults say, or with a
   * display control the page sets itself.
   */
  display: "site" | "page";
}

const statuses = new Map<string, SeoStatus>();
const listeners = new Set<() => void>();

/** Tells the line what the tab found for the document `key` names. */
export function publishSeoStatus(key: string, status: SeoStatus | null): void {
  const was = statuses.get(key);
  if (status === null) {
    if (was === undefined) return;
    statuses.delete(key);
  } else {
    if (
      was !== undefined &&
      was.listing === status.listing &&
      was.count === status.count &&
      was.typeLabel === status.typeLabel &&
      was.display === status.display
    ) {
      return;
    }
    statuses.set(key, status);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the line says for the document `key` names, once the tab has said. */
function useSeoStatus(key: string | null): SeoStatus | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? undefined : statuses.get(key)),
    () => undefined
  );
}

/** The document a side panel section is on, as the tab keys it. */
export function statusKeyOf(context: SidebarSectionProps["context"]): string {
  if ("single" in context) return `single:${context.single}`;
  return `collection:${context.collection}:${context.entryId ?? ""}`;
}

/** The line itself: `2 to check`, `Listed`, `Hidden from search`. */
export function SeoStatusSection({ context }: SidebarSectionProps): ReactNode {
  const status = useSeoStatus(statusKeyOf(context));
  if (status === undefined) return null;
  return (
    <p
      title="Read-only. Change it in the SEO tab."
      className="m-0 text-[13px] text-foreground"
      data-testid="seo-status"
    >
      {status.listing === "type" ? (
        <>Hidden · all {inSentence(status.typeLabel)} pages</>
      ) : status.listing === "page" ? (
        "Hidden from search"
      ) : status.count > 0 ? (
        <span className="font-medium text-warning-text">
          {status.count} to check
        </span>
      ) : (
        "Listed"
      )}
    </p>
  );
}

/**
 * The second line: `Site defaults` while the page sets none of the search
 * display controls, `Set for this page` once it sets one. Read-only, as the
 * line above it is: the controls are in the SEO tab's Advanced section.
 */
export function SeoDisplaySection({ context }: SidebarSectionProps): ReactNode {
  const status = useSeoStatus(statusKeyOf(context));
  if (status === undefined) return null;
  return (
    <p
      title="Read-only. Change it in the SEO tab, under Advanced."
      className="m-0 text-[13px] text-foreground"
      data-testid="seo-display-status"
    >
      {status.display === "page" ? "Set for this page" : "Site defaults"}
    </p>
  );
}
