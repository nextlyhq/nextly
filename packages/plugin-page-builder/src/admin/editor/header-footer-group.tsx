"use client";

/**
 * The Pages panel's "Header & footer" group: every header & footer set,
 * beside the pages they wrap, each with a small picture of its published
 * header above its footer, its name, and a note saying how many pages show
 * it, with the site default marked and a set's state where it is not plainly
 * published. "+ New header & footer" closes the list.
 *
 * A set's row and "+ New header & footer" open the set's admin form in a new
 * tab, so the page being edited and its undo history stay as they are.
 *
 * Hidden from an author who may not read sets: the read is refused, and the
 * group is not drawn at all rather than drawn empty.
 *
 * @module admin/editor/header-footer-group
 */
import { GroupToggle, type GroupFolds } from "@nextlyhq/builder/shell";
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import {
  layoutChoicesPath,
  type LayoutChoice,
  type LayoutChoicesResponse,
} from "../../layout-choices-contract";
import {
  LAYOUT_COUNTS_ROUTE_PATH,
  type LayoutPageCount,
  type LayoutPageCountsResponse,
} from "../../layout-counts-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import { useSetPictures } from "../header-footer-pictures";

/** The group's key in the panel's fold memory. */
export const HEADER_FOOTER_GROUP = "header-footer";

/** How many pages show a set, said as an author reads it. */
function pagesNote(count: LayoutPageCount | undefined): string {
  if (count === undefined) return "";
  const pages = count.pages;
  if (count.floor) return `At least ${String(pages)} pages`;
  if (pages === 0) return "Not used";
  return pages === 1 ? "1 page" : `${String(pages)} pages`;
}

/**
 * A set's note: the site default named first, how many pages show it, then
 * its state where it is not plainly published.
 */
export function setNote(
  set: Pick<LayoutChoice, "id" | "published" | "draftChangesNotLive">,
  defaultLayout: string | null,
  count: LayoutPageCount | undefined
): string {
  const reach = pagesNote(count);
  const parts =
    set.id === defaultLayout
      ? [reach === "" ? "Site default" : `Site default · ${reach}`]
      : reach === ""
        ? []
        : [reach];
  if (!set.published) parts.push("Draft");
  else if (set.draftChangesNotLive) parts.push("Changes not published");
  return parts.join(" · ");
}

/** Whether a failed read was the author being refused the sets. */
function refused(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

/** Where a set's admin form, or a new set's, opens. */
function formHref(collection: string, id?: string): string {
  const base = `/admin/collections/${encodeURIComponent(collection)}`;
  return id === undefined
    ? `${base}/create`
    : `${base}/${encodeURIComponent(id)}`;
}

/**
 * The group, folding as the panel's other groups do.
 *
 * @param folds - the panel's fold memory, kept per author
 */
export function HeaderFooterGroup({
  folds,
}: {
  readonly folds: GroupFolds;
}): React.JSX.Element | null {
  const choices = usePluginRoute<LayoutChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    // Every listed set's picture and its changes not published, which only
    // this list asks for, so the page's own menu read stays small.
    path: layoutChoicesPath(null, { pictures: true, drafts: true }),
  });
  const counts = usePluginRoute<LayoutPageCountsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LAYOUT_COUNTS_ROUTE_PATH,
  });
  const picture = useSetPictures(
    choices.data?.meta.regionDefinitions ?? {},
    choices.data !== undefined
  );
  if (choices.error !== null && refused(choices.error)) return null;

  const items = choices.data?.items ?? [];
  const open = !folds.folded.has(HEADER_FOOTER_GROUP);
  return (
    <section aria-label="Header & footer" className="grid gap-1.5">
      <GroupToggle
        heading="Header & footer"
        count={items.length}
        open={open}
        onToggle={() => folds.onFold(HEADER_FOOTER_GROUP, open)}
      />
      {open ? (
        <GroupBody read={choices} counts={counts.data} picture={picture} />
      ) : null}
    </section>
  );
}

/** The group's rows, or what stands in for them while they cannot be shown. */
function GroupBody({
  read,
  counts,
  picture,
}: {
  read: ReturnType<typeof usePluginRoute<LayoutChoicesResponse>>;
  counts: LayoutPageCountsResponse | undefined;
  picture: ReturnType<typeof useSetPictures>;
}): React.JSX.Element | null {
  if (read.error !== null) {
    return (
      <div className="grid justify-items-start gap-2 text-sm text-muted-foreground">
        <p>Couldn&rsquo;t load the header & footer sets.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={read.refetch}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (read.data === undefined) return null;
  const { items, meta } = read.data;
  return (
    <ul aria-label="Header & footer sets" className="grid gap-0.5">
      {items.map(set => (
        <li key={set.id}>
          <a
            href={formHref(meta.layoutsCollection, set.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-[color:var(--nx-builder-hover)]"
          >
            <span
              aria-hidden="true"
              className="h-[30px] w-[46px] shrink-0 overflow-hidden rounded-sm border border-[color:var(--nx-builder-border)]"
            >
              {picture(set.regions)}
            </span>
            <span className="grid min-w-0">
              <span className="truncate font-medium">{set.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {setNote(set, meta.defaultLayout, counts?.[set.id])}
              </span>
            </span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
      <li>
        <a
          href={formHref(meta.layoutsCollection)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-[color:var(--nx-builder-hover)] hover:text-[color:var(--nx-builder-text)]"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New header & footer
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </li>
    </ul>
  );
}
