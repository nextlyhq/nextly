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
 * template whose collection is no longer listed is asked about by slug, since
 * the list leaves out what the author may not read: one that still exists
 * stays fixed, and one that was renamed or removed may be pointed at
 * another, so the choice is offered there too, with why.
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
  get,
  useController,
  type Control,
  type FieldValues,
  type Path,
  type RefCallBack,
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
import {
  templateCollectionExistsPath,
  type TemplateCollectionExistence,
} from "../templates/template-actions-contract";
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

/**
 * Whether the collection a saved template draws exists, asked by slug where
 * the list does not name it: still being asked, unanswered, or answered.
 */
export type CollectionExistence = "pending" | "failed" | "exists" | "gone";

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

/** Said where a saved template's collection no longer exists under its slug. */
export function removedNote(slug: string): string {
  return `The collection "${slug}" was removed or renamed. Choose the collection this template draws now.`;
}

/** Said where the collections could not be listed. */
export const LIST_FAILED_NOTE =
  "Couldn't list the collections. Reload the page to try again.";

/** Said where a template being made falls back to typing the slug. */
export const TYPE_SLUG_NOTE =
  "Couldn't list the collections. Type the collection's slug, or reload the page to try again.";

/**
 * The control's state from the form's flags, whether the template is saved,
 * the value it holds, the value it was saved with, the list of collections and
 * whether the saved one exists. Its own function so the rule is pinned apart
 * from the render.
 *
 * What is offered is decided by the SAVED value, not the one being edited, so
 * a template pointed at another collection keeps its choice open until it is
 * saved, rather than the control turning read-only under the author's cursor.
 */
export function collectionFieldView(
  flags: {
    readonly readOnly?: boolean;
    readonly saved: boolean;
    readonly value: string;
    /** The collection the template was saved with. */
    readonly stored: string;
  },
  choices: CollectionChoices,
  existence: CollectionExistence
): CollectionFieldView {
  const { value, stored } = flags;
  const name =
    choices.state === "answered" ? (choices.named.get(value) ?? null) : null;
  // A version being read changes nothing, whatever the template is.
  if (flags.readOnly === true) {
    return { kind: "fixed", label: name, slug: value, note: null };
  }
  if (flags.saved && stored !== "") {
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
      case "answered":
        if (choices.named.has(stored)) {
          return { kind: "fixed", label: name, slug: value, note: null };
        }
        return unlistedView(value, stored, choices.offered, existence);
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
 * A saved template whose collection the list does not name. The list leaves
 * out collections this author may not read, so only the existence answer says
 * whether it is gone: the guard refuses a change of a collection that still
 * exists and allows one where it does not. Kept fixed by its slug until that
 * answer says gone, so a failed or slow answer offers nothing that cannot
 * save.
 */
function unlistedView(
  value: string,
  stored: string,
  offered: readonly CollectionChoice[],
  existence: CollectionExistence
): CollectionFieldView {
  switch (existence) {
    case "gone":
      return {
        kind: "choose",
        options: offered,
        loading: false,
        note: removedNote(stored),
      };
    // No note for the moment the answer takes, rather than one that changes
    // under the author's eyes.
    case "pending":
      return { kind: "fixed", label: null, slug: value, note: null };
    case "exists":
    case "failed":
      return {
        kind: "fixed",
        label: null,
        slug: value,
        note: unlistedNote(value),
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
  if (listed.error !== null || resolved.error !== null) {
    return { state: "failed" };
  }
  // Answered only once both reads have: before the pages slug arrives, Pages
  // would be offered, and a template for it cannot be saved.
  if (listed.data === undefined || resolved.data === undefined) {
    return { state: "pending" };
  }
  const collections =
    listed.data === null ? undefined : loopCollectionsOf(listed.data);
  const pagesCollection = fieldOf(resolved.data, "pagesCollection");
  if (collections === undefined || typeof pagesCollection !== "string") {
    return { state: "failed" };
  }
  return {
    state: "answered",
    named: new Map(collections.map(item => [item.slug, item.label])),
    offered: offeredCollections(collections, pagesCollection),
  };
}

/**
 * Whether the collection `slug` exists, asked only where `ask` says the list
 * leaves it out. Asked again on every mount, as the list is.
 */
function useCollectionExistence(
  slug: string,
  ask: boolean
): CollectionExistence {
  const read = usePluginRoute<TemplateCollectionExistence>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: templateCollectionExistsPath(slug),
    enabled: ask,
    staleTime: 0,
  });
  if (read.error !== null) return "failed";
  if (read.data === undefined) return "pending";
  const exists = fieldOf(read.data, "exists");
  return typeof exists === "boolean" ? (exists ? "exists" : "gone") : "failed";
}

/** One property of a route's answer, which may be any JSON a server sent. */
function fieldOf(answer: unknown, key: string): unknown {
  return typeof answer === "object" && answer !== null
    ? (answer as Record<string, unknown>)[key]
    : undefined;
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
  const { field, fieldState, formState } = useController({ name, control });
  const value = typeof field.value === "string" ? field.value : "";
  // The form starts again from the stored row on load and after each save,
  // so its defaults hold the collection the template is saved with. A form
  // that keeps no default for the field is read by its value, as before.
  const savedValue: unknown = get(formState.defaultValues, name);
  const stored = typeof savedValue === "string" ? savedValue : value;
  const { view, busy } = useCollectionFieldState(readOnly, value, stored);
  const noteId = useId();
  const handed: CollectionControlProps = {
    label: declaredLabel(declaration),
    describedBy: view.note === null ? undefined : noteId,
    value,
    invalid: fieldState.invalid,
    disabled,
    onChange: next => field.onChange(next),
    onBlur: field.onBlur,
    inputRef: field.ref,
  };

  return (
    <div className="flex flex-col gap-1.5">
      {view.kind === "fixed" ? (
        <FixedCollection view={view} busy={busy} {...handed} />
      ) : view.kind === "choose" ? (
        <ChooseCollection view={view} {...handed} />
      ) : (
        <TypedCollection {...handed} />
      )}
      {view.note === null ? null : (
        <p id={noteId} className="text-xs text-muted-foreground">
          {view.note}
        </p>
      )}
    </div>
  );
}

/**
 * The control's view and whether it is still waiting, from the template's
 * identity, the collection list and, for a saved collection the list does
 * not name, whether it still exists.
 */
function useCollectionFieldState(
  readOnly: boolean,
  value: string,
  stored: string
): { view: CollectionFieldView; busy: boolean } {
  const identity = useDocumentIdentity();
  const choices = useCollectionChoices();
  const saved =
    typeof identity?.documentId === "string" && identity.documentId !== "";
  const askExistence =
    !readOnly &&
    saved &&
    stored !== "" &&
    choices.state === "answered" &&
    !choices.named.has(stored);
  const existence = useCollectionExistence(stored, askExistence);
  return {
    view: collectionFieldView(
      { readOnly, saved, value, stored },
      choices,
      existence
    ),
    busy:
      choices.state === "pending" || (askExistence && existence === "pending"),
  };
}

/** What each of the control's three forms is handed. */
interface CollectionControlProps {
  readonly label: string;
  readonly describedBy: string | undefined;
  readonly value: string;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: string) => void;
  readonly onBlur: () => void;
  readonly inputRef: RefCallBack;
}

/** The collection as text: its name with its slug, read-only. */
function FixedCollection({
  view,
  busy,
  label,
  describedBy,
}: CollectionControlProps & {
  readonly view: Extract<CollectionFieldView, { kind: "fixed" }>;
  readonly busy: boolean;
}): JSX.Element {
  return (
    <div
      role="textbox"
      aria-readonly="true"
      // The wrapper's label is not tied to a plugin editor's control, so
      // the value carries its own name.
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
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
  );
}

/** What the choice says while it has nothing chosen. */
function choosePlaceholder(
  view: Extract<CollectionFieldView, { kind: "choose" }>
): string {
  if (view.loading) return "Loading collections…";
  return view.options.length === 0
    ? "No collection can have a template"
    : "Choose a collection";
}

/** The collections offered by name, to choose one. */
function ChooseCollection({
  view,
  label,
  describedBy,
  value,
  invalid,
  disabled,
  onChange,
  onBlur,
  inputRef,
}: CollectionControlProps & {
  readonly view: Extract<CollectionFieldView, { kind: "choose" }>;
}): JSX.Element {
  return (
    <Select
      // A value none of the options holds, as a removed collection's slug,
      // shows the placeholder rather than an empty trigger.
      value={
        view.options.some(option => option.slug === value) ? value : undefined
      }
      onValueChange={onChange}
      disabled={disabled || view.loading}
    >
      <SelectTrigger
        ref={inputRef}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-busy={view.loading || undefined}
        onBlur={onBlur}
        className="[&>span]:min-w-0 [&>span]:truncate [&>span]:text-left"
      >
        <SelectValue placeholder={choosePlaceholder(view)} />
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
  );
}

/** The slug typed, where the collections could not be listed. */
function TypedCollection({
  label,
  describedBy,
  value,
  invalid,
  disabled,
  onChange,
  onBlur,
  inputRef,
}: CollectionControlProps): JSX.Element {
  return (
    <Input
      ref={inputRef}
      type="text"
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={event => onChange(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      className="font-mono"
    />
  );
}
