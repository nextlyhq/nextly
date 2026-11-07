"use client";

/**
 * The template form's collection control: the collection a template draws,
 * by its name ("Posts") rather than its slug.
 *
 * The admin draws the field's label, description and error around it, as it
 * does around every plugin field editor. A saved template keeps its
 * collection, so it is shown read-only there, as the name with the slug
 * beside it. A template being made chooses one from the collections the
 * author may read that have an address to serve an entry at. A saved
 * template whose collection is no longer listed, renamed or removed, may be
 * pointed at another, so the choice is offered there too, with why.
 *
 * It decides nothing: the template guard judges every collection a write
 * names, whichever control wrote it, and refuses the rest in its own words.
 * Where the collections cannot be listed, a template being made falls back to
 * typing the slug, as the form drew it before.
 *
 * @module admin/TemplateCollectionField
 */
import {
  useDocumentIdentity,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useId, type JSX } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

// The CONTRACTS, not the routes: the routes reach server-only modules.
import {
  PAGE_COLLECTION_ROUTE_PATH,
  type PageCollectionResponse,
} from "../layout-choices-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  loopCollectionsPath,
  type LoopCollectionItem,
  type LoopCollectionsResponse,
} from "../loop-collections-contract";
import { TEMPLATE_ENTRY_ADDRESS_FIELD } from "../templates/template-preview-contract";

import { loopCollectionsOf } from "./loop-collections-client";

export interface TemplateCollectionFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads and writes. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
  /** The field's declaration, as the admin passes it to a plugin field editor. */
  field?: { label?: unknown };
  /** The document is being read, not edited. */
  readOnly?: boolean;
  /** The field is unavailable: no permission, or a form mid-submit. */
  disabled?: boolean;
}

/** One collection a template may be made for, as the choice names it. */
export interface CollectionChoice {
  readonly slug: string;
  readonly label: string;
}

/** Where the list of collections stands. */
export type CollectionChoices =
  | { readonly state: "pending" }
  | { readonly state: "failed" }
  | {
      readonly state: "answered";
      /** Every collection listed, by slug and name. */
      readonly named: ReadonlyMap<string, string>;
      /** The ones a template may be made for, by name. */
      readonly offered: readonly CollectionChoice[];
    };

/** What the control draws. */
export type CollectionFieldView =
  /** The collection, read-only: its name where known, and its slug. */
  | {
      readonly kind: "fixed";
      readonly label: string | null;
      readonly slug: string;
      readonly note: string | null;
    }
  /** A choice of collections, by name. */
  | {
      readonly kind: "choose";
      readonly options: readonly CollectionChoice[];
      readonly loading: boolean;
      readonly note: string | null;
    }
  /** The slug typed, where the collections could not be listed. */
  | { readonly kind: "type"; readonly note: string };

/** Said where a saved template's collection is not among those listed. */
export function unlistedNote(slug: string): string {
  return `"${slug}" isn't among the collections you can see, so it is shown by its slug.`;
}

/** Said where the collections could not be listed. */
export const LIST_FAILED_NOTE =
  "Couldn't list the collections. Reload the page to try again.";

/** Said where a template being made falls back to typing the slug. */
export const TYPE_SLUG_NOTE =
  "Couldn't list the collections. Type the collection's slug, or reload the page to try again.";

/**
 * The control's state from the form's flags, whether the template is saved,
 * the value it holds and the list of collections. Its own function so the
 * rule is pinned apart from the render.
 */
export function collectionFieldView(
  flags: {
    readonly readOnly?: boolean;
    readonly saved: boolean;
    readonly value: string;
  },
  choices: CollectionChoices
): CollectionFieldView {
  const { value } = flags;
  const name =
    choices.state === "answered" ? (choices.named.get(value) ?? null) : null;
  // A version being read changes nothing, whatever the template is.
  if (flags.readOnly === true) {
    return { kind: "fixed", label: name, slug: value, note: null };
  }
  if (flags.saved && value !== "") {
    switch (choices.state) {
      // The slug alone for the moment the names take, rather than a choice
      // that turns into text under the author's cursor.
      case "pending":
        return { kind: "fixed", label: null, slug: value, note: null };
      case "failed":
        return {
          kind: "fixed",
          label: null,
          slug: value,
          note: LIST_FAILED_NOTE,
        };
      // Kept as saved even where the list does not name it: the list leaves
      // out collections this author may not read, so its absence does not
      // say the collection is gone, and the guard refuses a change of a
      // collection that still exists.
      case "answered":
        return name === null
          ? {
              kind: "fixed",
              label: null,
              slug: value,
              note: unlistedNote(value),
            }
          : { kind: "fixed", label: name, slug: value, note: null };
    }
  }
  switch (choices.state) {
    case "pending":
      return { kind: "choose", options: [], loading: true, note: null };
    case "failed":
      return { kind: "type", note: TYPE_SLUG_NOTE };
    case "answered":
      return {
        kind: "choose",
        options: choices.offered,
        loading: false,
        note: null,
      };
  }
}

/**
 * The collections a template may be made for: those with a `slug` field, an
 * entry's part of its address, other than the page builder's own pages,
 * which are served as themselves. By name, then slug, so two collections
 * of one name keep one order.
 */
export function offeredCollections(
  listed: readonly LoopCollectionItem[],
  pagesCollection: string | undefined
): CollectionChoice[] {
  return listed
    .filter(
      item =>
        item.slug !== pagesCollection &&
        item.declared.includes(TEMPLATE_ENTRY_ADDRESS_FIELD) &&
        slugIsText(item)
    )
    .map(item => ({ slug: item.slug, label: item.label }))
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.slug.localeCompare(b.slug)
    );
}

/**
 * Whether the collection's `slug` field holds text, as an entry's address
 * needs. Its type is known where visitors can read the field; elsewhere
 * the collection is offered and the guard judges the field on save.
 */
function slugIsText(item: LoopCollectionItem): boolean {
  const slug = item.readable.find(
    field => field.name === TEMPLATE_ENTRY_ADDRESS_FIELD
  );
  return slug === undefined || slug.type === "text";
}

/** The list of collections, asked once per form, with the pages slug. */
function useCollectionChoices(): CollectionChoices {
  const listed = usePluginRoute<LoopCollectionsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: loopCollectionsPath(),
    // Asked again on every mount: collections are added, renamed and
    // removed in the Schema Builder, whose writes do not refresh this read.
    staleTime: 0,
  });
  const resolved = usePluginRoute<PageCollectionResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PAGE_COLLECTION_ROUTE_PATH,
  });
  if (listed.error !== null) return { state: "failed" };
  if (listed.data === undefined || listed.data === null) {
    return { state: "pending" };
  }
  const collections = loopCollectionsOf(listed.data);
  if (collections === undefined) return { state: "failed" };
  // The pages slug only narrows what is offered: without it Pages is offered
  // and the guard refuses it in its own words.
  return {
    state: "answered",
    named: new Map(collections.map(item => [item.slug, item.label])),
    offered: offeredCollections(
      collections,
      resolved.data?.pagesCollection ?? undefined
    ),
  };
}

/** The field's label, as its declaration gives it. */
function declaredLabel(
  declaration: TemplateCollectionFieldProps["field"]
): string {
  return typeof declaration?.label === "string"
    ? declaration.label
    : "Collection";
}

export function TemplateCollectionField<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  control,
  field: declaration,
  readOnly = false,
  disabled = false,
}: TemplateCollectionFieldProps<TFieldValues>): JSX.Element {
  const { field, fieldState } = useController({ name, control });
  const identity = useDocumentIdentity();
  const choices = useCollectionChoices();
  const value = typeof field.value === "string" ? field.value : "";
  const saved =
    typeof identity?.documentId === "string" && identity.documentId !== "";
  const view = collectionFieldView({ readOnly, saved, value }, choices);
  const noteId = useId();
  const label = declaredLabel(declaration);
  const { note } = view;
  const describedBy = note === null ? undefined : noteId;

  return (
    <div className="flex flex-col gap-1.5">
      {view.kind === "fixed" ? (
        <div
          role="textbox"
          aria-readonly="true"
          // The wrapper's label is not tied to a plugin editor's control, so
          // the value carries its own name.
          aria-label={label}
          aria-describedby={describedBy}
          aria-busy={choices.state === "pending" || undefined}
          className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm"
        >
          {view.slug === "" ? (
            <span className="text-muted-foreground">No collection</span>
          ) : (
            <>
              <span className="min-w-0 truncate text-foreground">
                {view.label ?? view.slug}
              </span>
              {/* The slug beside the name, as the API and code name it, with
                  a space between for a screen reader. */}
              {view.label === null || view.label === view.slug ? null : (
                <>
                  {" "}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {view.slug}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      ) : view.kind === "choose" ? (
        <Select
          value={value === "" ? undefined : value}
          onValueChange={next => field.onChange(next)}
          disabled={disabled || view.loading}
        >
          <SelectTrigger
            ref={field.ref}
            aria-label={label}
            aria-describedby={describedBy}
            aria-invalid={fieldState.invalid || undefined}
            aria-busy={view.loading || undefined}
            onBlur={field.onBlur}
            className="[&>span]:min-w-0 [&>span]:truncate [&>span]:text-left"
          >
            <SelectValue
              placeholder={
                view.loading
                  ? "Loading collections…"
                  : view.options.length === 0
                    ? "No collection can have a template"
                    : "Choose a collection"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {view.options.map(option => (
              <SelectItem key={option.slug} value={option.slug}>
                {/* A space between, so the option reads "Posts posts". */}
                {option.label}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {option.slug}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          ref={field.ref}
          type="text"
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={fieldState.invalid || undefined}
          value={value}
          onChange={event => field.onChange(event.target.value)}
          onBlur={field.onBlur}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
      )}
      {note === null ? null : (
        <p id={noteId} className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
