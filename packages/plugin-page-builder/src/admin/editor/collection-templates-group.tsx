"use client";

/**
 * The Pages panel's "Collection templates" group: every collection template,
 * beside the pages and the header & footer sets, each with a small picture of
 * its published design, its collection's name and how many entries it draws.
 * A row opens the template in the builder.
 *
 * "+ New collection template" is offered only while some collection has no
 * template and the author may make one, and offers only those collections;
 * choosing one makes its template and opens it. With no template yet, the
 * group says what one is for.
 *
 * Hidden from an author who may not read templates: the read is refused, and
 * the group is not drawn at all.
 *
 * @module admin/editor/collection-templates-group
 */
import { GroupToggle, type GroupFolds } from "@nextlyhq/builder/shell";
import { navigateTo, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
  type TemplateCollectionChoice,
  type TemplateCollectionChoicesResponse,
} from "../../templates/template-actions-contract";
import {
  TEMPLATES_PANEL_ROUTE_PATH,
  type PanelTemplate,
  type TemplatesPanelResponse,
} from "../../templates/templates-panel-contract";
import {
  builderHref,
  reasonOf,
  runTemplateAction,
} from "../entry-designs-client";
import { useDocumentPictures } from "../header-footer-pictures";
import { useRefreshOnReturn } from "../refresh-on-return";

/** The group's key in the panel's fold memory. */
const TEMPLATES_GROUP = "collection-templates";

/** How many entries a template draws, said as an author reads it. */
function noteOf(template: PanelTemplate): string {
  const { entries } = template.use;
  const use = `Used by ${String(entries)} ${entries === 1 ? "entry" : "entries"}`;
  return template.published ? use : `${use} · Draft`;
}

/** Whether a failed read was the author being refused. */
function refused(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

/**
 * The group, folding as the panel's other groups do.
 *
 * @param folds - the panel's fold memory, kept per author
 */
export function CollectionTemplatesGroup({
  folds,
}: {
  readonly folds: GroupFolds;
}): React.JSX.Element | null {
  const read = usePluginRoute<TemplatesPanelResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATES_PANEL_ROUTE_PATH,
    staleTime: 0,
  });
  // The collections a template may draw, answered only to an author who may
  // make or change templates: the offer of a new one follows from it.
  const choices = usePluginRoute<TemplateCollectionChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
    staleTime: 0,
  });
  const refetchTemplates = read.refetch;
  const refetchChoices = choices.refetch;
  const refresh = React.useCallback(() => {
    refetchTemplates();
    refetchChoices();
  }, [refetchTemplates, refetchChoices]);
  // A template made or published in another tab shows on return.
  useRefreshOnReturn(true, refresh);
  const picture = useDocumentPictures(
    read.data?.meta.definitions ?? {},
    read.data !== undefined
  );
  if (read.error !== null && refused(read.error)) return null;

  const items = read.data?.items ?? [];
  const drawn = new Set(items.map(item => item.collection));
  const without = (choices.data?.items ?? []).filter(
    choice => !drawn.has(choice.slug)
  );
  const open = !folds.folded.has(TEMPLATES_GROUP);
  return (
    <section aria-label="Collection templates" className="grid gap-1.5">
      <GroupToggle
        heading="Collection templates"
        count={items.length}
        open={open}
        onToggle={() => folds.onFold(TEMPLATES_GROUP, open)}
      />
      {open ? (
        <GroupBody read={read} picture={picture} without={without} />
      ) : null}
    </section>
  );
}

/** The group's rows, or what stands in for them while they cannot be shown. */
function GroupBody({
  read,
  picture,
  without,
}: {
  read: ReturnType<typeof usePluginRoute<TemplatesPanelResponse>>;
  picture: ReturnType<typeof useDocumentPictures>;
  without: readonly TemplateCollectionChoice[];
}): React.JSX.Element | null {
  if (read.error !== null) {
    return (
      <div className="grid justify-items-start gap-2 text-sm text-muted-foreground">
        <p>Couldn&rsquo;t load the collection templates.</p>
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
  // Offered to an author who may create a template, for the collections
  // that have none.
  const add =
    !meta.canCreateTemplates || without.length === 0 ? null : (
      <NewTemplateMenu
        collections={without}
        templatesCollection={meta.templatesCollection}
      />
    );
  if (items.length === 0) {
    return (
      <div className="grid justify-items-start gap-1.5 px-1.5 text-sm text-muted-foreground">
        <p>Design every entry of a collection at once.</p>
        {add}
      </div>
    );
  }
  return (
    <ul aria-label="Collection templates" className="grid gap-0.5">
      {items.map(template => (
        <TemplateRow
          key={template.id}
          template={template}
          picture={
            template.document === null ? null : picture([template.document])
          }
          onOpen={() =>
            navigateTo(builderHref(meta.templatesCollection, template.id))
          }
        />
      ))}
      {add === null ? null : <li>{add}</li>}
    </ul>
  );
}

/** One template's row: its picture, its collection and what it draws. */
function TemplateRow({
  template,
  picture,
  onOpen,
}: {
  template: PanelTemplate;
  picture: React.ReactNode;
  onOpen: () => void;
}): React.JSX.Element {
  const note = noteOf(template);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-[color:var(--nx-builder-hover)]"
      >
        <span
          aria-hidden="true"
          className="h-[30px] w-[46px] shrink-0 overflow-hidden rounded-sm border border-[color:var(--nx-builder-border)]"
        >
          {picture}
        </span>
        <span className="grid min-w-0">
          <span className="truncate font-medium">
            {template.collectionLabel}
          </span>
          <span className="truncate text-xs text-muted-foreground">{note}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * "+ New collection template": the collections with no template, and the
 * one chosen given its template, then opened in the builder.
 */
function NewTemplateMenu({
  collections,
  templatesCollection,
}: {
  collections: readonly TemplateCollectionChoice[];
  templatesCollection: string;
}): React.JSX.Element {
  const make = (collection: string) => {
    void runTemplateAction({ kind: "create-template", collection }).then(
      result => {
        const id = result?.template?.id;
        if (id !== undefined) navigateTo(builderHref(templatesCollection, id));
      },
      (error: unknown) =>
        toast.error(
          reasonOf(error, "The collection template could not be made.")
        )
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-[color:var(--nx-builder-hover)] hover:text-[color:var(--nx-builder-text)]"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New collection template
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {collections.map(choice => (
          <DropdownMenuItem
            key={choice.slug}
            onSelect={() => make(choice.slug)}
          >
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
