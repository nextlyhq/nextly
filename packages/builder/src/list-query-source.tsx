"use client";

/**
 * A collection list's Source field: the menu of collections, relations and
 * custom sources, what each choice changes, and the hint and foot under it.
 *
 * @module list-query-source
 */
import { NAMED_QUERY_TEXT, type ListQuery } from "@nextlyhq/blocks-engine";
import { Label } from "@nextlyhq/ui";
import { Link2, TriangleAlert } from "lucide-react";
import * as React from "react";

import type { ListedChoice } from "./choice-list";
import {
  alphabetical,
  LoopPicker,
  type LoopCollections,
} from "./collection-loop-controls";
import type { LoopCollection } from "./content-controls";
import { FieldCaution, FieldError } from "./list-query-parts";
import type {
  ListQueryReading,
  Related,
  RelatedSource,
} from "./list-query-reading";
import { CUSTOM_SOURCE_MARK, CustomSourceRow } from "./named-query-controls";
import {
  sourceSearchText,
  type CustomSource,
  type StoredParams,
} from "./named-query-model";

/** One row of the Source menu. */
export interface SourceChoice extends ListedChoice {
  readonly pick:
    | { readonly kind: "collection"; readonly slug: string | undefined }
    | { readonly kind: "related"; readonly source: RelatedSource }
    | { readonly kind: "custom"; readonly source: CustomSource };
}

/** A pick that names a collection or a related source, not a custom one. */
type CollectionPick = Exclude<SourceChoice["pick"], { kind: "custom" }>;

/** The props a new source writes: a new collection clears what named the old. */
export function sourceChanges(
  query: ListQuery,
  pick: CollectionPick
): Record<string, unknown> {
  const collection =
    pick.kind === "collection" ? pick.slug : pick.source.collection;
  const relation =
    pick.kind === "related"
      ? { of: pick.source.of, field: pick.source.field }
      : undefined;
  // Filters and sort name the old collection's fields, which the new one may
  // not have, so a save would refuse them: they go with it, in the same edit.
  return {
    collection,
    relation,
    // A collection or a related source is the list's whole source: a custom
    // one goes in the same edit.
    namedQuery: undefined,
    ...(collection === query.collection
      ? {}
      : { filters: undefined, sort: undefined }),
  };
}

/** What the Source button shows, and whether it is a prompt or a lost value. */
function sourceShown(
  listed: LoopCollections,
  query: ListQuery,
  related: RelatedSource | undefined,
  current: LoopCollection | undefined,
  named: ShownNamed | undefined
): { words: string; state: "value" | "prompt" | "unknown" } {
  if (listed.kind === "loading") {
    return { words: "Loading collections…", state: "prompt" };
  }
  if (named !== undefined) {
    if (named.source !== undefined) {
      return { words: named.source.declaration.label, state: "value" };
    }
    return named.loading
      ? { words: "Loading sources…", state: "prompt" }
      : { words: `${named.name} · not available`, state: "unknown" };
  }
  // No collection could be listed: a stored one is shown by its name, as
  // it is not known to be gone, and an unset one asks for a custom source.
  if (listed === NO_COLLECTIONS) {
    const stored = query.relation?.field ?? query.collection;
    return stored === undefined
      ? { words: "Choose a custom source", state: "prompt" }
      : { words: stored, state: "value" };
  }
  if (query.relation !== undefined) {
    return related === undefined
      ? {
          words: `${query.relation.field} · not available here`,
          state: "unknown",
        }
      : { words: related.words, state: "value" };
  }
  if (query.collection === undefined) {
    return { words: "Choose a collection", state: "prompt" };
  }
  return current === undefined
    ? { words: `${query.collection} · not available`, state: "unknown" }
    : { words: current.label, state: "value" };
}

/** The Source menu's rows: related sources first, then the collections. */
function sourceChoices(
  related: Related,
  collections: readonly LoopCollection[] | undefined,
  customs: readonly CustomSource[]
): SourceChoice[] {
  const relatedRow = (source: RelatedSource): SourceChoice => ({
    key: `${source.of}:${source.field}`,
    label: source.words,
    group: source.of,
    pick: { kind: "related", source },
  });
  return [
    ...related.entry.map(relatedRow),
    ...related.item.map(relatedRow),
    // A site's own queries, above its collections: few, made for this site,
    // and kept in view above a collection list that may scroll.
    ...customs.map(
      (source): SourceChoice => ({
        key: `custom:${source.declaration.name}`,
        label: source.declaration.label,
        group: "custom",
        // Searched by its line too, which the row draws under its name.
        search: sourceSearchText(source.declaration),
        pick: { kind: "custom", source },
      })
    ),
    // No collection row, nor any collection, where none could be listed.
    ...(collections === undefined
      ? []
      : [
          {
            key: "collection:",
            label: "No collection",
            group: "collections",
            pick: { kind: "collection", slug: undefined },
          } satisfies SourceChoice,
        ]),
    ...alphabetical(collections ?? []).map(
      (each): SourceChoice => ({
        key: `collection:${each.slug}`,
        label: each.label,
        group: "collections",
        pick: { kind: "collection", slug: each.slug },
      })
    ),
  ];
}

/** The Source menu's headings, for the groups that hold a row. */
function sourceGroups(
  related: Related,
  customs: readonly CustomSource[],
  collectionsOffered: boolean
): { group: string; heading: string }[] {
  return [
    ...(related.entry.length === 0
      ? []
      : [{ group: "entry", heading: related.entryHeading }]),
    ...(related.item.length === 0
      ? []
      : [{ group: "item", heading: related.itemHeading }]),
    ...(customs.length === 0
      ? []
      : [{ group: "custom", heading: "Custom sources" }]),
    ...(collectionsOffered
      ? [{ group: "collections", heading: "Collections" }]
      : []),
  ];
}

/** A Source menu row as drawn: a custom source on two lines, any other on one. */
function sourceRow(choice: SourceChoice): React.ReactNode {
  return choice.pick.kind === "custom" ? (
    <CustomSourceRow declaration={choice.pick.source.declaration} />
  ) : (
    choice.label
  );
}

/** The Source menu's note where no related source can be offered. */
function NoRelated({
  inEmptyState,
}: {
  inEmptyState: boolean;
}): React.JSX.Element {
  return (
    <div className="nx-list-query__menu-note">
      <p className="nx-vars__group-name nx-font-pick__heading">
        Related entries
      </p>
      <p className="nx-list-query__menu-text">
        {inEmptyState ? (
          <>
            Not available in When empty: it only shows when the list has no
            entries, so there&apos;s no entry to relate to.
          </>
        ) : (
          <>
            Not available here. On a collection&apos;s entry, or inside another
            list, a list can show the entry&apos;s related entries, such as its
            categories or tags.
          </>
        )}
      </p>
    </div>
  );
}

/** What a related source shows, said under Source. */
function SourceHint({
  id,
  source,
  collections,
}: {
  id: string;
  source: RelatedSource;
  collections: readonly LoopCollection[];
}): React.JSX.Element {
  const whose =
    source.of === "entry"
      ? "chosen on the entry this page shows"
      : "of each entry the list around this one shows";
  const fields =
    collections.find(each => each.slug === source.collection)?.label ??
    source.collection;
  return (
    <p id={id} className="nx-inspector__note nx-list-query__hint">
      The {source.what} {whose}. Filters and sort use the fields of {fields}.
    </p>
  );
}

/** The mark a related source wears in the Source control. */
const RELATED_MARK = (
  <Link2 aria-hidden="true" size={14} className="nx-list-query__icon" />
);

/** The related source a stored relation names, among those offered. */
function relatedSourceOf(
  offered: readonly RelatedSource[],
  relation: ListQuery["relation"]
): RelatedSource | undefined {
  return relation === undefined
    ? undefined
    : offered.find(
        each => each.of === relation.of && each.field === relation.field
      );
}

/** The Source menu's key for what is stored: a relation, or a collection. */
function sourceKey(query: ListQuery, named: ShownNamed | undefined): string {
  if (named !== undefined) return `custom:${named.name}`;
  return query.relation === undefined
    ? `collection:${query.collection ?? ""}`
    : `${query.relation.of}:${query.relation.field}`;
}

/**
 * The custom source a list shows in its inspector: the one it stores, or the
 * one just picked and waiting for an input, with its inputs as shown and the
 * source the site offers under that name, if it still does.
 */
export interface ShownNamed {
  readonly name: string;
  readonly params: StoredParams;
  readonly source: CustomSource | undefined;
  /** Picked but not written yet: an input it needs is still empty. */
  readonly drafted: boolean;
  /** The site's sources are still being read, so `source` is not known yet. */
  readonly loading: boolean;
}

/** What a custom source's Source hint says: the developer's line. */
function NamedHint({
  id,
  named,
}: {
  id: string;
  named: ShownNamed;
}): React.JSX.Element | null {
  const description = named.source?.declaration.description;
  const hidden = named.source?.readsHidden ?? [];
  if (description === undefined && hidden.length === 0) return null;
  return (
    <div id={id} className="nx-list-query__hints">
      {description === undefined ? null : (
        <p className="nx-inspector__note nx-list-query__hint">{description}</p>
      )}
      {hidden.map(read => (
        <FieldCaution key={read.collection}>
          <TriangleAlert aria-hidden="true" size={12} />
          {NAMED_QUERY_TEXT.readsHidden(read.label, read.fields)}
        </FieldCaution>
      ))}
    </div>
  );
}

/** What describes the Source control: its error, else its hint, else none. */
function sourceDescribedBy(state: {
  readonly refused: boolean;
  readonly hinted: boolean;
  readonly errorId: string;
  readonly hintId: string;
}): string | undefined {
  if (state.refused) return state.errorId;
  return state.hinted ? state.hintId : undefined;
}

/** The collections where none could be listed: the custom sources stand alone. */
export const NO_COLLECTIONS: LoopCollections = {
  kind: "ready",
  collections: [],
};

/** The mark the Source control's value wears: a custom or a related source's. */
function sourceMark(
  query: ListQuery,
  named: ShownNamed | undefined
): React.JSX.Element | undefined {
  if (named !== undefined) return CUSTOM_SOURCE_MARK;
  return query.relation === undefined ? undefined : RELATED_MARK;
}

/** Whether a custom source has a line to say under Source: its own, or a caution. */
function namedHinted(named: ShownNamed | undefined): boolean {
  const source = named?.source;
  return (
    source !== undefined &&
    (source.declaration.description !== undefined ||
      source.readsHidden.length > 0)
  );
}

/** Under the Source control: its error, or the hint for what it names. */
function SourceFoot({
  ids,
  problems,
  related,
  named,
  collections,
}: {
  ids: { readonly error: string; readonly hint: string };
  problems: readonly string[];
  related: RelatedSource | undefined;
  named: ShownNamed | undefined;
  collections: readonly LoopCollection[];
}): React.JSX.Element | null {
  if (problems.length > 0) {
    return <FieldError id={ids.error}>{problems.join(" ")}</FieldError>;
  }
  if (related !== undefined) {
    return (
      <SourceHint id={ids.hint} source={related} collections={collections} />
    );
  }
  return named === undefined ? null : <NamedHint id={ids.hint} named={named} />;
}

/** The Source control: a collection, a relation where one can be read, or a custom source. */
export function SourceField({
  id,
  reading,
  listed,
  named,
  disabled,
  problems,
  onPick,
}: {
  id: string;
  reading: ListQueryReading;
  listed: LoopCollections;
  named: ShownNamed | undefined;
  disabled: boolean;
  problems: readonly string[];
  onPick: (pick: SourceChoice["pick"]) => void;
}): React.JSX.Element {
  const { query, collections, customs, related, collectionsOffered } = reading;
  const labelId = `${id}-label`;
  const ids = { error: `${id}-error`, hint: `${id}-hint` };
  const all = [...related.entry, ...related.item];
  const currentRelated =
    named === undefined ? relatedSourceOf(all, query.relation) : undefined;
  const shown = sourceShown(
    listed,
    query,
    currentRelated,
    collections.find(each => each.slug === query.collection),
    named
  );
  const refused = problems.length > 0;
  const hinted =
    !refused && (currentRelated !== undefined || namedHinted(named));
  return (
    <div className="nx-inspector__field" data-content-control="listSource">
      <Label id={labelId} htmlFor={id}>
        Show entries from
      </Label>
      <LoopPicker
        id={id}
        labelId={labelId}
        value={{
          ...shown,
          icon: sourceMark(query, named),
          invalid: refused,
          describedBy: sourceDescribedBy({
            refused,
            hinted,
            errorId: ids.error,
            hintId: ids.hint,
          }),
        }}
        disabled={disabled || listed.kind === "loading"}
        list={{
          choices: sourceChoices(
            related,
            collectionsOffered ? collections : undefined,
            customs
          ),
          groups: sourceGroups(related, customs, collectionsOffered),
          currentKey: sourceKey(query, named),
          label: "Sources",
          searchLabel: "Search sources",
          noMatch: "No source matches.",
          searchFrom: 1,
          renderChoice: sourceRow,
          // Two-line rows need the room; a menu of collections alone keeps
          // its control's width.
          wide: customs.length > 0,
        }}
        around={{
          // Where no collection could be listed, no related entry could be
          // either, and the note above says why.
          above:
            all.length > 0 || !collectionsOffered ? undefined : (
              <NoRelated inEmptyState={related.inEmptyState === true} />
            ),
        }}
        onPick={choice => onPick(choice.pick)}
      />
      <SourceFoot
        ids={ids}
        problems={problems}
        related={currentRelated}
        named={named}
        collections={collections}
      />
    </div>
  );
}
