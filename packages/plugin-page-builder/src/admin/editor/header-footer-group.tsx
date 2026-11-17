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
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";

import {
  LAYOUT_CHOICES_ROUTE_PATH,
  layoutChoicesPath,
  type LayoutChoice,
  type LayoutChoicesResponse,
} from "../../layout-choices-contract";
import {
  LAYOUT_COUNTS_ROUTE_PATH,
  type LayoutPageCount,
  type LayoutPageCountsResponse,
} from "../../layout-counts-contract";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import { useSetPictures } from "../header-footer-pictures";
import { duplicateLayout, renameLayout } from "../layout-writes-client";
import {
  useMakeDefaultFlow,
  type MakeDefaultAsked,
} from "../make-default-action";
import { useRefreshOnReturn } from "../refresh-on-return";
import { useRemoveLayout } from "../RemoveLayoutAction";

import { RenameField } from "./rename-field";

/** The group's key in the panel's fold memory. */
const HEADER_FOOTER_GROUP = "header-footer";

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
function setNote(
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

/**
 * Whether a cached read is one of this plugin's set choices reads, by the
 * key the admin keeps a plugin route's read under: `["plugin-route", path]`.
 */
function isChoicesRead(key: readonly unknown[]): boolean {
  const path = key[1];
  return (
    key[0] === "plugin-route" &&
    typeof path === "string" &&
    path.includes(PAGE_BUILDER_PLUGIN_NAME) &&
    path.includes(LAYOUT_CHOICES_ROUTE_PATH)
  );
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
    // Never served from an earlier answer: a set made, renamed or published
    // in its form's tab is shown when the author comes back (below).
    staleTime: 0,
  });
  const counts = usePluginRoute<LayoutPageCountsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LAYOUT_COUNTS_ROUTE_PATH,
    staleTime: 0,
  });
  // A set's row and "+ New header & footer" open its form in another tab,
  // and the admin asks no read again on focus, so both are asked here.
  const refetchChoices = choices.refetch;
  const refetchCounts = counts.refetch;
  const refresh = React.useCallback(() => {
    refetchChoices();
    refetchCounts();
  }, [refetchChoices, refetchCounts]);
  useRefreshOnReturn(true, refresh);
  // After a write here, every set choices read is asked again too, the
  // canvas's own among them: a new default, a removed set or a published one
  // changes the header and footer the page being edited is drawn inside.
  const queryClient = useQueryClient();
  const afterWrite = React.useCallback(() => {
    refresh();
    void queryClient.invalidateQueries({
      predicate: query => isChoicesRead(query.queryKey),
    });
  }, [refresh, queryClient]);
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
        <GroupBody
          read={choices}
          counts={counts.data}
          picture={picture}
          reread={afterWrite}
        />
      ) : null}
    </section>
  );
}

/** The group's rows, or what stands in for them while they cannot be shown. */
function GroupBody({
  read,
  counts,
  picture,
  reread,
}: {
  read: ReturnType<typeof usePluginRoute<LayoutChoicesResponse>>;
  counts: LayoutPageCountsResponse | undefined;
  picture: ReturnType<typeof useSetPictures>;
  /** Reads the sets and their counts again, after a write here. */
  reread: () => void;
}): React.JSX.Element | null {
  // The names renamed here, as saved: a published set's rename is saved as a
  // change not yet published, and the list reads the live name, so the row
  // keeps the saved one for as long as the panel is open.
  const [renamed, setRenamed] = React.useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  // Who may choose the site default, as the Header & footer list asks it.
  const settings = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
    staleTime: 0,
  });
  // The list's own Make site default flow, its question included, so both
  // places ask the same and write the same; the panel reads its sets again.
  const makeDefault = useMakeDefaultFlow({ published: reread, made: reread });
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
    <>
      {makeDefault.dialog}
      <ul aria-label="Header & footer sets" className="grid gap-0.5">
        {items.map(set => (
          <SetRow
            key={set.id}
            set={set}
            href={formHref(meta.layoutsCollection, set.id)}
            note={setNote(set, meta.defaultLayout, counts?.[set.id])}
            picture={picture(set.regions)}
            isDefault={set.id === meta.defaultLayout}
            may={{
              rename: meta.canUpdateAnyLayout ?? meta.canUpdateLayouts,
              duplicate: meta.canCreateLayouts === true,
              makeDefault: settings.data?.mayChooseDefaultLayout === true,
              remove: meta.canDeleteAnyLayout === true,
            }}
            onMakeDefault={makeDefault.start}
            shownTitle={renamed.get(set.id) ?? set.title}
            onRenamed={title => {
              setRenamed(current => new Map(current).set(set.id, title));
            }}
            onWritten={reread}
          />
        ))}
        {meta.more ? (
          <li>
            <a
              href={`/admin/collections/${encodeURIComponent(meta.layoutsCollection)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md px-1.5 py-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Showing the first {items.length}. See every header & footer set
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ) : null}
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
    </>
  );
}

/** What a refused write says: core's own words, or a plain fallback. */
function refusalOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The header & footer set could not be changed. Try again.";
}

/**
 * One set's row: its picture, name and note, opening its form in a new tab,
 * and its ⋯ menu. Rename edits the name in place; each action is offered only
 * to an author with the right it needs.
 */
function SetRow({
  set,
  isDefault,
  onMakeDefault,
  shownTitle,
  href,
  note,
  picture,
  may,
  onRenamed,
  onWritten,
}: {
  set: LayoutChoice;
  /** Whether this set is the site default. */
  isDefault: boolean;
  onMakeDefault: (asked: MakeDefaultAsked) => void;
  /** The name the row shows: the saved one after a rename here. */
  shownTitle: string;
  href: string;
  note: string;
  picture: React.ReactNode;
  may: {
    readonly rename: boolean;
    readonly duplicate: boolean;
    readonly makeDefault: boolean;
    readonly remove: boolean;
  };
  onRenamed: (title: string) => void;
  onWritten: () => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = React.useState(false);
  // Rename starts once the menu has CLOSED, as a page's does: started while
  // it closes, the menu's focus return would end the rename at once.
  const renameAfterClose = React.useRef(false);
  // The set's own Remove dialog, as its form opens it; the panel stays.
  const removal = useRemoveLayout({
    entryId: set.id,
    published: set.published,
    leave: onWritten,
    closeOnLeave: true,
  });
  const write = (run: () => Promise<unknown>) => {
    void run().then(onWritten, (error: unknown) =>
      toast.error(refusalOf(error))
    );
  };
  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-[color:var(--nx-builder-hover)]">
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1 text-sm">
          <SetPicture>{picture}</SetPicture>
          <RenameField
            title={shownTitle}
            label="Header & footer set name"
            onDone={title => {
              setRenaming(false);
              if (title !== null && title !== shownTitle) {
                write(async () => {
                  const saved = await renameLayout(set.id, title);
                  onRenamed(saved.title);
                });
              }
            }}
          />
        </div>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1 text-sm"
        >
          <SetPicture>{picture}</SetPicture>
          <span className="grid min-w-0">
            <span className="truncate font-medium">{shownTitle}</span>
            <span className="truncate text-xs text-muted-foreground">
              {note}
            </span>
          </span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${shownTitle}`}
            className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={event => {
            if (!renameAfterClose.current) return;
            renameAfterClose.current = false;
            event.preventDefault();
            setRenaming(true);
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              window.open(href, "_blank", "noopener,noreferrer");
            }}
          >
            Open
          </DropdownMenuItem>
          {may.makeDefault && !isDefault ? (
            <DropdownMenuItem
              onSelect={() =>
                onMakeDefault({
                  id: set.id,
                  title: shownTitle,
                  published: set.published,
                })
              }
            >
              {set.published
                ? "Make site default"
                : "Publish it, then make default"}
            </DropdownMenuItem>
          ) : null}
          {may.rename ? (
            <DropdownMenuItem
              onSelect={() => {
                renameAfterClose.current = true;
              }}
            >
              Rename
            </DropdownMenuItem>
          ) : null}
          {may.duplicate ? (
            <DropdownMenuItem
              onSelect={() =>
                write(async () => {
                  const copy = await duplicateLayout(set.id);
                  toast.success(`${copy.title} was made.`);
                })
              }
            >
              Duplicate
            </DropdownMenuItem>
          ) : null}
          {may.remove ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  // The default is taken down only once another set is the
                  // default: said here, before any check is asked.
                  if (isDefault) {
                    toast.error(
                      `${shownTitle} is the site default. Make another set the default before deleting it.`
                    );
                    return;
                  }
                  removal.open();
                }}
              >
                Delete…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {removal.dialog}
    </li>
  );
}

/** A set's small picture, at the size the panel's rows draw it. */
function SetPicture({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="h-[30px] w-[46px] shrink-0 overflow-hidden rounded-sm border border-[color:var(--nx-builder-border)]"
    >
      {children}
    </span>
  );
}
