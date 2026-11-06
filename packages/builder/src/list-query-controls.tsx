"use client";

/**
 * A collection list's query in the Content tab, as one group of controls:
 * where its entries come from, the filters that narrow them, the order they
 * come in, how many show, and what the canvas shows when none match.
 *
 * - **Source**: a collection, or a to-many relation of the page's entry or
 *   of each item of the list this one sits in. A relation is offered only
 *   where it can be read, and the menu says why when none is.
 * - **Filters**: one sentence per row ("Category is any of News, Guides")
 *   that opens in place into its field, operator and value. A new filter
 *   opens already open. A row is written once it is complete; until then it
 *   is kept here and says what it lacks, and the canvas keeps the last
 *   query that read.
 * - **Sort**: a row per key, each with a drag handle, its field, its
 *   direction in words for the field's kind, and a menu to move or remove
 *   it. Alt+↑ and Alt+↓ move the focused row, as they move a block in Layers.
 * - **How many**: the number of items and the entries to skip, each refused
 *   inline while it is not one a save takes.
 * - **When nothing matches**: whether the canvas draws the entries or the
 *   empty state, which is editor state and never stored.
 *
 * Everything stored is read by the engine's `readListQuery`, and every
 * problem shown is the engine's `listQueryIssues`, so what this says and what
 * a save refuses are one judgement. Each action is one write of the block's
 * props, so it is one undo step. Only fields visitors can see are offered,
 * and none holding several values: the host's list is the public's.
 *
 * @module list-query-controls
 */
import {
  COLLECTION_LIST_TYPE,
  findNode,
  LIST_ENTRY_SLOT,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  listKindSortable,
  listPageCount,
  listQueryIssues,
  locateNode,
  outerListOf,
  readListQuery,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type ListFieldKind,
  type ListFieldSource,
  type ListFilter,
  type ListFilterOp,
  type ListQuery,
  type ListRelation,
  type ListSortKey,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import * as React from "react";

import { ChoiceList, type ListedChoice } from "./choice-list";
import {
  alphabetical,
  LoopPicker,
  useLoopCollections,
  type LoopCollections,
  type PickerList,
} from "./collection-loop-controls";
import {
  SegmentedChoice,
  type ContentServices,
  type ListEntriesCount,
  type LoopCollection,
  type LoopListField,
} from "./content-controls";
import type { EditableProp } from "./inspector";
import {
  completedFilter,
  directionWords,
  filterLine,
  filterSentence,
  firstDirection,
  movedKey,
  OPERATORS,
  operatorOf,
  readBound,
  sortValue,
  takesList,
  valueFor,
  withFilter,
  type DraftFilter,
  type FilterSentence,
} from "./list-query-model";
import { RelationControl } from "./relation-control";

/** The props a list's query is stored in, in the order the group draws them. */
export const LIST_QUERY_PROPS = [
  "collection",
  "relation",
  "filters",
  "sort",
  "limit",
  "offset",
  "paginate",
] as const;

/** What the group is drawn with: the Content tab's group context. */
export interface ListQueryFieldProps {
  readonly props: readonly EditableProp[];
  readonly writable: (name: string) => boolean;
  readonly services: ContentServices | undefined;
  readonly onCommitMany: (
    changes: Readonly<Record<string, unknown>>
  ) => BlockDocument | null | void;
  /** The document the list is in, for the list around it and its judgement. */
  readonly document: BlockDocument;
  readonly nodeId: string;
  /** Whether the canvas draws this list's empty state. */
  readonly showsEmpty: boolean;
  /**
   * The count of the latest ask, from the list's canvas note, to fix its
   * sort: each new count takes the author to its first sort row.
   */
  readonly sortFieldAsked?: number | undefined;
  /** Draw its empty state, or its entries; absent where nothing can. */
  readonly onShowEmpty?: ((empty: boolean) => void) | undefined;
}

/** The note under a field that says what is wrong with it. */
function FieldError({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p id={id} className="nx-inspector__error nx-list-query__error">
      {children}
    </p>
  );
}

/** A group's title, as the Advanced summary is titled. */
function GroupTitle({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h3 id={id} className="nx-list-query__title">
      {children}
    </h3>
  );
}

/**
 * A collection's fields in the engine's terms, for judging a list against:
 * the public's fields as the host read them for the save's own judgement,
 * so what is said here is what a save would refuse. A host that names none
 * is judged by what it offers, which a save may judge more widely.
 */
function fieldSourceOf(
  collections: readonly LoopCollection[]
): ListFieldSource {
  const bySlug = new Map(collections.map(each => [each.slug, each]));
  return {
    fieldsOf: slug => {
      const found = bySlug.get(slug);
      if (found === undefined) return undefined;
      const readable: BindingFieldShape[] = [
        ...(found.readable ?? offeredShapes(found)),
      ];
      return {
        declared: new Set([
          ...(found.declared ?? []),
          ...readable.map(shape => shape.name),
        ]),
        readable,
        // The name the Source menu shows, for the engine's words.
        label: found.label,
      };
    },
  };
}

/**
 * A field type of each list kind, the one the engine's `listFieldKind` reads
 * back as that kind: a kind's own name is not always a field type (a choice
 * is a `select`, a yes/no a `checkbox`), and a type the engine does not know
 * has no kind, so its filters and sorts would be refused.
 */
const FIELD_TYPE_OF_KIND: Readonly<Record<ListFieldKind, string>> = {
  text: "text",
  number: "number",
  date: "date",
  boolean: "checkbox",
  choice: "select",
  entry: "relationship",
};

/** The shapes of what a collection offers, for a host naming no others. */
function offeredShapes(found: LoopCollection): BindingFieldShape[] {
  return [
    { name: "id", type: "text" },
    ...found.fields.map(field => ({
      name: field.name,
      type: FIELD_TYPE_OF_KIND[field.kind],
      ...(field.relationTo === undefined
        ? {}
        : { relationTo: field.relationTo }),
    })),
    ...(found.relations ?? []).map(relation => ({
      name: relation.field,
      type: "relationship",
      hasMany: true,
      relationTo: relation.collection,
    })),
  ];
}

/** The problems the engine finds with one list, as a save would. */
type Issues = ReturnType<typeof listQueryIssues>;

/** The issues about one prop of the list, by the path's last step. */
function issuesAt(issues: Issues, props: readonly string[]): string[] {
  return issues
    .filter(issue => props.some(prop => issue.path.endsWith(`/props/${prop}`)))
    .map(issue => issue.message);
}

/**
 * The engine's judgement of one part of a list on its own: the list with
 * only that part, inside the same surroundings, so a row's own problem is
 * said beside that row.
 */
function partIssues(
  node: BlockNode,
  part: Readonly<Record<string, unknown>>,
  fields: ListFieldSource | undefined
): Issues {
  const props = node.props;
  return listQueryIssues(
    [
      {
        ...node,
        props: { collection: props.collection, ...part },
        slots: {},
      },
    ],
    fields === undefined ? {} : { fields }
  ).filter(issue => issue.severity === "error");
}

/** A relation as the menu offers it, of the page's entry or the outer item. */
interface RelatedSource {
  readonly of: ListRelation["of"];
  readonly field: string;
  readonly collection: string;
  /** "This post's categories", "Each category's featured posts". */
  readonly words: string;
  /** What the relation holds, in words: "categories". */
  readonly what: string;
}

/** The words for a relation source, by whose relation it is. */
function relatedWords(
  of: ListRelation["of"],
  owner: LoopCollection | undefined,
  relationLabel: string
): string {
  const one = (owner?.singular ?? owner?.label ?? "entry").toLowerCase();
  const what = relationLabel.toLowerCase();
  return of === "entry" ? `This ${one}'s ${what}` : `Each ${one}'s ${what}`;
}

/** The related sources a list may show where it sits, with their headings. */
interface Related {
  readonly entry: readonly RelatedSource[];
  readonly item: readonly RelatedSource[];
  /** "Related to this post", over the entry's relations. */
  readonly entryHeading: string;
  /** "Related to each category", over the outer item's relations. */
  readonly itemHeading: string;
  /**
   * Whether the nearest list around this one holds it in its empty state,
   * which is drawn only when that list has no entries, so with none to
   * relate to.
   */
  readonly inEmptyState?: boolean;
}

/** Whether the nearest list around `id` holds it anywhere but per entry. */
function inListEmptyState(nodes: BlockNode[], id: string): boolean {
  let at = locateNode(nodes, id);
  // Bounded by the document's depth: each step moves one parent out.
  while (at?.parent !== undefined) {
    const parent = at.parent;
    if (parent.type === COLLECTION_LIST_TYPE) {
      return at.slot !== LIST_ENTRY_SLOT;
    }
    at = locateNode(nodes, parent.id);
  }
  return false;
}

/** The related sources a list may show where it sits. */
function relatedSources(
  collections: readonly LoopCollection[],
  entryCollection: string | null | undefined,
  outer: ListQuery | undefined
): Related {
  const ownerOf = (slug: string | null | undefined) =>
    collections.find(each => each.slug === slug);
  const one = (owner: LoopCollection | undefined) =>
    (owner?.singular ?? owner?.label ?? "entry").toLowerCase();
  const sources = (
    of: ListRelation["of"],
    owner: LoopCollection | undefined
  ): RelatedSource[] =>
    (owner?.relations ?? []).map(relation => ({
      of,
      field: relation.field,
      collection: relation.collection,
      words: relatedWords(of, owner, relation.label),
      what: relation.label.toLowerCase(),
    }));
  const entryOwner = ownerOf(entryCollection);
  // Related entries go one level deep: a list inside a list that already
  // shows related entries is offered none of its own.
  const itemOwner =
    outer === undefined || outer.relation !== undefined
      ? undefined
      : ownerOf(outer.collection);
  return {
    entry: sources("entry", entryOwner),
    item: sources("item", itemOwner),
    entryHeading: `Related to this ${one(entryOwner)}`,
    itemHeading: `Related to each ${one(itemOwner)}`,
  };
}

/** One row of the Source menu. */
interface SourceChoice extends ListedChoice {
  readonly pick:
    | { readonly kind: "collection"; readonly slug: string | undefined }
    | { readonly kind: "related"; readonly source: RelatedSource };
}

/** The props a new source writes: a new collection clears what named the old. */
function sourceChanges(
  query: ListQuery,
  pick: SourceChoice["pick"]
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
  current: LoopCollection | undefined
): { words: string; state: "value" | "prompt" | "unknown" } {
  if (listed.kind === "loading") {
    return { words: "Loading collections…", state: "prompt" };
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
  collections: readonly LoopCollection[]
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
    {
      key: "collection:",
      label: "No collection",
      group: "collections",
      pick: { kind: "collection", slug: undefined },
    },
    ...alphabetical(collections).map(
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
function sourceGroups(related: Related): { group: string; heading: string }[] {
  return [
    ...(related.entry.length === 0
      ? []
      : [{ group: "entry", heading: related.entryHeading }]),
    ...(related.item.length === 0
      ? []
      : [{ group: "item", heading: related.itemHeading }]),
    { group: "collections", heading: "Collections" },
  ];
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
function sourceKey(query: ListQuery): string {
  return query.relation === undefined
    ? `collection:${query.collection ?? ""}`
    : `${query.relation.of}:${query.relation.field}`;
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

/** The Source control: a collection, or a relation where one can be read. */
function SourceField({
  id,
  query,
  listed,
  collections,
  related,
  disabled,
  problems,
  onPick,
}: {
  id: string;
  query: ListQuery;
  listed: LoopCollections;
  collections: readonly LoopCollection[];
  related: Related;
  disabled: boolean;
  problems: readonly string[];
  onPick: (pick: SourceChoice["pick"]) => void;
}): React.JSX.Element {
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const all = [...related.entry, ...related.item];
  const currentRelated = relatedSourceOf(all, query.relation);
  const shown = sourceShown(
    listed,
    query,
    currentRelated,
    collections.find(each => each.slug === query.collection)
  );
  const refused = problems.length > 0;
  const hinted = !refused && currentRelated !== undefined;
  return (
    <div className="nx-inspector__field" data-content-control="listSource">
      <Label id={labelId} htmlFor={id}>
        Source
      </Label>
      <LoopPicker
        id={id}
        labelId={labelId}
        value={{
          ...shown,
          icon: query.relation === undefined ? undefined : RELATED_MARK,
          invalid: refused,
          describedBy: sourceDescribedBy({ refused, hinted, errorId, hintId }),
        }}
        disabled={disabled || listed.kind === "loading"}
        list={{
          choices: sourceChoices(related, collections),
          groups: sourceGroups(related),
          currentKey: sourceKey(query),
          label: "Sources",
          searchLabel: "Search sources",
          noMatch: "No source matches.",
          searchFrom: 1,
        }}
        around={{
          above:
            all.length > 0 ? undefined : (
              <NoRelated inEmptyState={related.inEmptyState === true} />
            ),
        }}
        onPick={choice => onPick(choice.pick)}
      />
      {refused ? (
        <FieldError id={errorId}>{problems.join(" ")}</FieldError>
      ) : null}
      {hinted ? (
        <SourceHint
          id={hintId}
          source={currentRelated}
          collections={collections}
        />
      ) : null}
    </div>
  );
}

/** The titles of entries a filter names, read once each through the host. */
function useEntryTitles(
  find: ContentServices["findEntries"],
  fields: readonly LoopListField[],
  rows: readonly DraftFilter[]
): (id: string) => string | undefined {
  const [titles, setTitles] = React.useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  // Each entry field's ids, by its collection, as text: what is asked, so a
  // render asking the same ids reads nothing again.
  const asked = JSON.stringify(
    [...entryIdsByCollection(fields, rows)].map(([collection, ids]) => [
      collection,
      [...ids].sort(),
    ])
  );
  React.useEffect(() => {
    const wanted = JSON.parse(asked) as [string, string[]][];
    if (find === undefined || wanted.length === 0) return;
    let live = true;
    for (const [collection, ids] of wanted) {
      find({ collection, ids, limit: ids.length }).then(
        found => {
          if (!live) return;
          setTitles(current => {
            const next = new Map(current);
            for (const entry of found) next.set(entry.id, entry.title);
            return next;
          });
        },
        () => undefined
      );
    }
    return () => {
      live = false;
    };
  }, [find, asked]);
  return id => titles.get(id);
}

/** The entry ids the rows name, by the collection each field points at. */
function entryIdsByCollection(
  fields: readonly LoopListField[],
  rows: readonly DraftFilter[]
): Map<string, Set<string>> {
  const byCollection = new Map<string, Set<string>>();
  for (const row of rows) {
    const named = entryIdsOf(row, fields);
    if (named === undefined) continue;
    const set = byCollection.get(named.collection) ?? new Set<string>();
    for (const id of named.ids) set.add(id);
    byCollection.set(named.collection, set);
  }
  return byCollection;
}

/**
 * The entry ids one row names and the collection they are entries of, when
 * the row filters an entry field; nothing for any other row.
 */
function entryIdsOf(
  row: DraftFilter,
  fields: readonly LoopListField[]
): { readonly collection: string; readonly ids: string[] } | undefined {
  const field = fields.find(each => each.name === row.field);
  if (field?.kind !== "entry" || field.relationTo === undefined) {
    return undefined;
  }
  const values = Array.isArray(row.value) ? row.value : [row.value];
  return {
    collection: field.relationTo,
    ids: values.filter(
      (id): id is string => typeof id === "string" && id !== ""
    ),
  };
}

/** A value typed as text, committed when the field is left or Enter pressed. */
function TypedValue({
  id,
  labelledBy,
  kind,
  value,
  disabled,
  describedBy,
  onDone,
}: {
  id: string;
  labelledBy: string;
  kind: "text" | "number" | "date";
  value: unknown;
  disabled: boolean;
  describedBy?: string | undefined;
  onDone: (value: unknown) => void;
}): React.JSX.Element {
  const stored =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const [draft, setDraft] = React.useState(stored);
  React.useEffect(() => setDraft(stored), [stored]);
  const send = () => {
    if (draft === stored) return;
    if (kind === "number") {
      const parsed = Number(draft);
      onDone(draft.trim() === "" || Number.isNaN(parsed) ? undefined : parsed);
      return;
    }
    onDone(draft === "" ? undefined : draft);
  };
  return (
    <Input
      id={id}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      type={kind}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={draft}
      disabled={disabled}
      className="nx-list-filter__value"
      onChange={event => setDraft(event.target.value)}
      onBlur={send}
      onKeyDown={event => {
        if (event.key === "Enter") {
          event.preventDefault();
          send();
        }
      }}
    />
  );
}

/** Text values for "is any of", one chip each, added with Enter. */
function ChipValues({
  id,
  labelledBy,
  values,
  disabled,
  onDone,
}: {
  id: string;
  labelledBy: string;
  values: readonly string[];
  disabled: boolean;
  onDone: (values: string[]) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const text = draft.trim();
    if (text === "" || values.includes(text)) return;
    setDraft("");
    onDone([...values, text]);
  };
  return (
    <div className="nx-list-filter__chips">
      {values.map(value => (
        <span key={value} className="nx-list-filter__chip">
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            disabled={disabled}
            onClick={() => onDone(values.filter(each => each !== value))}
          >
            <X aria-hidden="true" size={12} />
          </button>
        </span>
      ))}
      <Input
        id={id}
        aria-labelledby={labelledBy}
        value={draft}
        disabled={disabled}
        placeholder="Type a value, then Enter"
        className="nx-list-filter__value"
        onChange={event => setDraft(event.target.value)}
        onBlur={add}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

/** A choice field's values for "is any of": a checklist of its choices. */
function ChoiceChecklist({
  labelledBy,
  field,
  values,
  disabled,
  onDone,
}: {
  labelledBy: string;
  field: LoopListField;
  values: readonly unknown[];
  disabled: boolean;
  onDone: (values: string[]) => void;
}): React.JSX.Element {
  const options = field.options ?? [];
  return (
    <div
      className="nx-list-filter__checklist"
      role="group"
      aria-labelledby={labelledBy}
    >
      {options.map(option => {
        const checked = values.includes(option.value);
        return (
          <label key={option.value} className="nx-list-filter__check">
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() =>
                onDone(
                  options
                    .map(each => each.value)
                    .filter(value =>
                      value === option.value ? !checked : values.includes(value)
                    )
                )
              }
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

/** What every value control is given. */
interface ValueProps {
  readonly id: string;
  readonly labelledBy: string;
  readonly field: LoopListField;
  readonly draft: DraftFilter & { op: ListFilterOp };
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly describedBy: string | undefined;
  readonly services: ContentServices | undefined;
  readonly entryTitle: (id: string) => string | undefined;
  readonly onValue: (value: unknown) => void;
}

/** The list values a row holds, for "is any of" and "is none of". */
function listValues(draft: DraftFilter): readonly unknown[] {
  return Array.isArray(draft.value) ? draft.value : [];
}

/** A yes-or-no value: Yes and No, side by side. */
function BooleanValue({
  id,
  labelledBy,
  draft,
  disabled,
  onValue,
}: Pick<
  ValueProps,
  "id" | "labelledBy" | "draft" | "disabled" | "onValue"
>): React.JSX.Element {
  return (
    <SegmentedChoice
      id={id}
      labelledBy={labelledBy}
      options={["yes", "no"]}
      labels={["Yes", "No"]}
      value={draft.value === false ? "no" : "yes"}
      disabled={disabled}
      onChoose={option => onValue(option === "yes")}
    />
  );
}

/** A choice field's value: a menu of its choices, or a checklist of several. */
function ChoiceValue(
  props: Pick<
    ValueProps,
    | "id"
    | "labelledBy"
    | "field"
    | "draft"
    | "disabled"
    | "invalid"
    | "describedBy"
    | "onValue"
  >
): React.JSX.Element {
  const { id, labelledBy, field, draft, disabled, invalid, describedBy } =
    props;
  if (takesList(draft.op)) {
    return (
      <ChoiceChecklist
        labelledBy={labelledBy}
        field={field}
        values={listValues(draft)}
        disabled={disabled}
        onDone={props.onValue}
      />
    );
  }
  return (
    <Select
      value={typeof draft.value === "string" ? draft.value : ""}
      disabled={disabled}
      onValueChange={props.onValue}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-labelledby={labelledBy}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="nx-list-filter__value"
      >
        <SelectValue placeholder="Choose one" />
      </SelectTrigger>
      <SelectContent>
        {(field.options ?? []).map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The entries chosen for "is any of", each a chip that removes it. */
function EntryChips({
  ids,
  disabled,
  entryTitle,
  onValue,
}: {
  ids: readonly string[];
  disabled: boolean;
  entryTitle: (id: string) => string | undefined;
  onValue: (value: unknown) => void;
}): React.JSX.Element {
  return (
    <>
      {ids.map(entry => {
        const title = entryTitle(entry);
        return (
          <span key={entry} className="nx-list-filter__chip">
            {title ?? "An entry"}
            <button
              type="button"
              aria-label={`Remove ${title ?? "this entry"}`}
              disabled={disabled}
              onClick={() => onValue(ids.filter(each => each !== entry))}
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        );
      })}
    </>
  );
}

/**
 * An entry field's value: the entry picker, once or for each of several.
 * The picker names itself by the field and shows its own errors, so the
 * row's label and error are not handed to it.
 */
function EntryValue(
  props: Pick<
    ValueProps,
    | "id"
    | "field"
    | "draft"
    | "disabled"
    | "services"
    | "entryTitle"
    | "onValue"
  >
): React.JSX.Element {
  const { id, field, draft, disabled, services, onValue } = props;
  const many = takesList(draft.op);
  const ids = many
    ? listValues(draft).filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  // In a class of its own, so the filter's styles reach the picker inside
  // and take the row under the operator, or under the chips.
  const pick = (
    <div className="nx-list-filter__entry">
      <RelationControl
        id={id}
        label={many ? `Add to ${field.label}` : field.label}
        prop={{
          name: "value",
          schema: { type: "relation", relationTo: field.relationTo },
          value: many ? undefined : draft.value,
          defaultValue: undefined,
          supported: true,
          options: [],
          offered: true,
          readOnly: false,
        }}
        disabled={disabled}
        services={services}
        onCommit={(_name, chosen) => {
          if (!many) onValue(chosen);
          else if (typeof chosen === "string" && !ids.includes(chosen)) {
            onValue([...ids, chosen]);
          }
        }}
      />
    </div>
  );
  if (!many) return pick;
  return (
    <div className="nx-list-filter__entries">
      <EntryChips
        ids={ids}
        disabled={disabled}
        entryTitle={props.entryTitle}
        onValue={onValue}
      />
      {pick}
    </div>
  );
}

/** A typed value: text, a number or a day, or several texts as chips. */
function TypedFilterValue(
  props: Pick<
    ValueProps,
    | "id"
    | "labelledBy"
    | "field"
    | "draft"
    | "disabled"
    | "describedBy"
    | "onValue"
  >
): React.JSX.Element {
  const { id, labelledBy, field, draft, disabled } = props;
  if (takesList(draft.op)) {
    return (
      <ChipValues
        id={id}
        labelledBy={labelledBy}
        values={listValues(draft).map(String)}
        disabled={disabled}
        onDone={props.onValue}
      />
    );
  }
  const kind =
    field.kind === "number" || field.kind === "date" ? field.kind : "text";
  return (
    <TypedValue
      id={id}
      labelledBy={labelledBy}
      kind={kind}
      value={draft.value}
      disabled={disabled}
      describedBy={props.describedBy}
      onDone={props.onValue}
    />
  );
}

/** The value control for each kind of field. */
const VALUE_CONTROLS: Readonly<
  Record<LoopListField["kind"], (props: ValueProps) => React.JSX.Element>
> = {
  boolean: BooleanValue,
  choice: ChoiceValue,
  entry: EntryValue,
  text: TypedFilterValue,
  number: TypedFilterValue,
  date: TypedFilterValue,
};

/** The value control a row's field and operator call for; none for exists. */
function FilterValue(props: ValueProps): React.JSX.Element | null {
  if (props.draft.op === "exists") return null;
  const Control = VALUE_CONTROLS[props.field.kind];
  return <Control {...props} />;
}

/** One field of the field menu, with its kind on the right. */
interface FieldChoice extends ListedChoice {
  readonly field: LoopListField;
}

/** What a field's kind is called on the right of the menu. */
const KIND_WORDS: Readonly<Record<LoopListField["kind"], string>> = {
  text: "Text",
  number: "Number",
  date: "Date",
  choice: "Choice",
  boolean: "Yes or no",
  entry: "Entry",
};

/** The field menu's row: the field, and the kind of value it holds. */
function fieldRow(choice: FieldChoice): React.ReactNode {
  return (
    <span className="nx-list-query__field-row">
      <span>{choice.label}</span>
      <span className="nx-list-query__field-kind">
        {KIND_WORDS[choice.field.kind]}
      </span>
    </span>
  );
}

/** A field menu's list: the fields, each with its kind on the right. */
function fieldList(
  fields: readonly LoopListField[],
  currentKey: string,
  label: string
): PickerList<FieldChoice> {
  return {
    choices: fields.map(each => ({
      key: each.name,
      label: each.label,
      field: each,
    })),
    currentKey,
    label,
    searchLabel: "Search fields",
    noMatch: "No field matches.",
    searchFrom: 1,
    renderChoice: fieldRow,
  };
}

/** The line under every field menu: what it leaves out, said once. */
const PUBLIC_ONLY = (
  <p className="nx-list-query__menu-foot">
    Only fields visitors can see are listed.
  </p>
);

/** A filter row as it stands: what is stored, or the draft over it. */
interface ShownRow {
  readonly key: string;
  /** The stored row it edits, or `undefined` for a new one. */
  readonly index: number | undefined;
  readonly draft: DraftFilter;
  /** Whether this is a draft that differs from what is stored. */
  readonly drafted: boolean;
}

/** What a filter row is drawn with, closed or open. */
interface FilterRowProps {
  readonly id: string;
  readonly row: ShownRow;
  readonly fields: readonly LoopListField[];
  readonly open: boolean;
  readonly disabled: boolean;
  /** What the engine finds wrong with the stored row, if anything. */
  readonly storedProblem: string | undefined;
  readonly services: ContentServices | undefined;
  readonly entryTitle: (id: string) => string | undefined;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChange: (draft: DraftFilter) => void;
  readonly onRemove: () => void;
}

/** A row as it reads: its field, its sentence, and what is wrong with it. */
interface RowReading {
  readonly field: LoopListField | undefined;
  readonly sentence: FilterSentence;
  readonly line: string;
  readonly problem: string | undefined;
  readonly errorId: string;
}

/**
 * How a row reads. A row with no field yet only asks for one; a stored row
 * the engine refuses says why; a draft says what it lacks.
 */
function readRow(props: FilterRowProps): RowReading {
  const { row, fields, storedProblem, entryTitle } = props;
  const field = fields.find(each => each.name === row.draft.field);
  const sentence = filterSentence(row.draft, field, entryTitle);
  const completed = completedFilter(row.draft, field);
  const missing =
    row.draft.field !== undefined && "missing" in completed
      ? completed.missing
      : undefined;
  return {
    field,
    sentence,
    line: filterLine(sentence),
    problem: storedProblem ?? missing,
    errorId: `${props.id}-error`,
  };
}

/** The button that removes a row, named by its sentence. */
function RemoveFilter({
  line,
  disabled,
  onRemove,
}: {
  line: string;
  disabled: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="nx-list-filter__remove"
      aria-label={`Remove filter: ${line}`}
      disabled={disabled}
      onClick={onRemove}
    >
      <X aria-hidden="true" size={14} />
    </Button>
  );
}

/** A closed row: its sentence on one line, which opens it. */
function ClosedFilter({
  props,
  reading,
  lineRef,
}: {
  props: FilterRowProps;
  reading: RowReading;
  lineRef: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const { sentence, line, problem, errorId } = reading;
  return (
    <li
      className="nx-list-filter"
      data-invalid={problem === undefined ? undefined : ""}
    >
      <button
        ref={lineRef}
        type="button"
        className="nx-list-filter__line"
        aria-expanded={false}
        aria-describedby={problem === undefined ? undefined : errorId}
        title={line}
        disabled={props.disabled}
        onClick={props.onOpen}
      >
        <ChevronRight aria-hidden="true" size={14} />
        <span className="nx-list-filter__sentence">
          <span className="nx-list-filter__field">{sentence.field}</span>{" "}
          <span className="nx-list-filter__op">{sentence.operator}</span>{" "}
          <span
            className="nx-list-filter__said"
            data-missing={sentence.value === "no value" ? "" : undefined}
          >
            {sentence.value}
          </span>
        </span>
      </button>
      <RemoveFilter
        line={line}
        disabled={props.disabled}
        onRemove={props.onRemove}
      />
      {problem === undefined ? null : (
        <FieldError id={errorId}>{problem}</FieldError>
      )}
    </li>
  );
}

/** What a row's field picker shows for its stored or chosen field. */
function fieldShown(
  name: string | undefined,
  field: LoopListField | undefined
): { words: string; state: "value" | "prompt" | "unknown" } {
  if (name === undefined) return { words: "Choose a field", state: "prompt" };
  return field === undefined
    ? { words: `${name} (removed)`, state: "unknown" }
    : { words: field.label, state: "value" };
}

/** A row's field: picking one starts it on that field's first operator. */
function FilterFieldPicker({
  id,
  labelId,
  props,
  field,
}: {
  id: string;
  labelId: string;
  props: FilterRowProps;
  field: LoopListField | undefined;
}): React.JSX.Element {
  const { row, fields, disabled, onChange } = props;
  const shown = fieldShown(row.draft.field, field);
  return (
    <LoopPicker
      id={id}
      labelId={labelId}
      value={shown}
      disabled={disabled}
      list={fieldList(fields, row.draft.field ?? "", "Fields to filter by")}
      around={{ below: PUBLIC_ONLY }}
      defaultOpen={row.draft.field === undefined}
      onPick={choice => {
        const first = OPERATORS[choice.field.kind][0];
        if (choice.field.name === row.draft.field || first === undefined)
          return;
        onChange({
          field: choice.field.name,
          op: first.op,
          value: valueFor(choice.field.kind, first, undefined),
        });
      }}
    />
  );
}

/** A row's operator, from those its field's kind offers. */
function OperatorPicker({
  id,
  field,
  draft,
  disabled,
  onChange,
}: {
  id: string;
  field: LoopListField;
  draft: DraftFilter;
  disabled: boolean;
  onChange: (draft: DraftFilter) => void;
}): React.JSX.Element {
  const operators = OPERATORS[field.kind];
  const operator =
    draft.op === undefined
      ? undefined
      : operatorOf(field.kind, draft.op, draft.value);
  return (
    <Select
      value={operator?.key ?? ""}
      disabled={disabled}
      onValueChange={key => {
        const choice = operators.find(each => each.key === key);
        if (choice === undefined) return;
        onChange({
          field: field.name,
          op: choice.op,
          value: valueFor(field.kind, choice, draft.value),
        });
      }}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={`How ${field.label} is compared`}
        className="nx-list-filter__op-pick"
        data-wide={draft.op === "exists" ? "" : undefined}
      >
        <SelectValue placeholder="Compare" />
      </SelectTrigger>
      <SelectContent>
        {operators.map(choice => (
          <SelectItem key={choice.key} value={choice.key}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** An open row: its field, operator and value, and its error. */
function OpenFilter({
  props,
  reading,
  onClose,
}: {
  props: FilterRowProps;
  reading: RowReading;
  onClose: () => void;
}): React.JSX.Element {
  const { id, row, disabled } = props;
  const { field, line, problem, errorId } = reading;
  const labelId = `${id}-label`;
  const op = row.draft.op;
  return (
    <li
      className="nx-list-filter"
      data-open=""
      data-invalid={problem === undefined ? undefined : ""}
      onKeyDown={event => {
        // Escape closes the row, unless a menu inside it is taking it.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <span id={labelId} className="nx-sr-only">
        {`Filter ${line}`}
      </span>
      <div className="nx-list-filter__head">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-expanded={true}
          aria-label={`Close filter: ${line}`}
          onClick={onClose}
        >
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
        <FilterFieldPicker
          id={`${id}-field`}
          labelId={labelId}
          props={props}
          field={field}
        />
        <RemoveFilter
          line={line}
          disabled={disabled}
          onRemove={props.onRemove}
        />
      </div>
      {field === undefined ? null : (
        <div className="nx-list-filter__body">
          <OperatorPicker
            id={`${id}-op`}
            field={field}
            draft={row.draft}
            disabled={disabled}
            onChange={props.onChange}
          />
          {op === undefined ? null : (
            <FilterValue
              id={`${id}-value`}
              labelledBy={labelId}
              field={field}
              draft={{ ...row.draft, op }}
              disabled={disabled}
              invalid={problem !== undefined}
              describedBy={problem === undefined ? undefined : errorId}
              services={props.services}
              entryTitle={props.entryTitle}
              onValue={value => props.onChange({ ...row.draft, value })}
            />
          )}
        </div>
      )}
      {problem === undefined ? null : (
        <FieldError id={errorId}>{problem}</FieldError>
      )}
    </li>
  );
}

/** One filter: its sentence, opening in place into its controls. */
function FilterRow(props: FilterRowProps): React.JSX.Element {
  const reading = readRow(props);
  const lineRef = React.useRef<HTMLButtonElement>(null);
  if (!props.open) {
    return <ClosedFilter props={props} reading={reading} lineRef={lineRef} />;
  }
  return (
    <OpenFilter
      props={props}
      reading={reading}
      onClose={() => {
        props.onClose();
        // Back on the line it opened from, so the keyboard keeps its place.
        requestAnimationFrame(() => lineRef.current?.focus());
      }}
    />
  );
}

/** The Filters group: one row per filter, and a way to add one. */
function FiltersGroup({
  id,
  query,
  node,
  fields,
  fieldSource,
  disabled,
  problems,
  services,
  relatedWordsShown,
  onFilters,
}: {
  id: string;
  query: ListQuery;
  node: BlockNode;
  fields: readonly LoopListField[];
  fieldSource: ListFieldSource | undefined;
  disabled: boolean;
  problems: readonly string[];
  services: ContentServices | undefined;
  /** The related source's words, for the line saying every entry shows. */
  relatedWordsShown: string | undefined;
  onFilters: (filters: ListFilter[] | undefined) => void;
}): React.JSX.Element {
  const stored = query.filters;
  // Drafts over stored rows by index, and new rows by their own key. Drafts
  // over stored rows are dropped when the stored rows change underneath
  // them, as an undo does.
  const [overStored, setOverStored] = React.useState<
    ReadonlyMap<number, DraftFilter>
  >(() => new Map());
  const [added, setAdded] = React.useState<
    ReadonlyArray<{ key: string; draft: DraftFilter }>
  >([]);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const storedText = JSON.stringify(stored);
  React.useEffect(() => setOverStored(new Map()), [storedText]);
  const nextKey = React.useRef(0);
  const rows: ShownRow[] = [
    ...stored.map((filter, index) => {
      const draft = overStored.get(index);
      return {
        key: `stored:${String(index)}`,
        index,
        draft: draft ?? filter,
        drafted: draft !== undefined,
      };
    }),
    ...added.map(each => ({
      key: each.key,
      index: undefined,
      draft: each.draft,
      drafted: true,
    })),
  ];
  const entryTitle = useEntryTitles(
    services?.findEntries,
    fields,
    rows.map(row => row.draft)
  );
  const filterLimit = listLimit(rows.length, LIST_MAX_FILTERS, id);
  const change = (row: ShownRow, draft: DraftFilter) => {
    const field = fields.find(each => each.name === draft.field);
    const completed = completedFilter(draft, field);
    if ("filter" in completed) {
      const index = row.index ?? stored.length;
      // Written once complete: the row is a stored one from here on.
      setOverStored(current => {
        const next = new Map(current);
        next.delete(index);
        return next;
      });
      if (row.index === undefined) {
        setAdded(current => current.filter(each => each.key !== row.key));
        if (openKey === row.key) setOpenKey(`stored:${String(index)}`);
      }
      onFilters(withFilter(stored, index, completed.filter));
      return;
    }
    // Kept here until it is complete; the canvas keeps the last query.
    if (row.index === undefined) {
      setAdded(current =>
        current.map(each => (each.key === row.key ? { ...each, draft } : each))
      );
    } else {
      const index = row.index;
      setOverStored(current => new Map(current).set(index, draft));
    }
  };
  const remove = (row: ShownRow) => {
    if (openKey === row.key) setOpenKey(null);
    if (row.index === undefined) {
      setAdded(current => current.filter(each => each.key !== row.key));
      return;
    }
    onFilters(withFilter(stored, row.index, undefined));
  };
  const storedProblems = (row: ShownRow): string | undefined => {
    if (row.index === undefined || row.drafted) return undefined;
    const issues = partIssues(
      node,
      { filters: [stored[row.index]] },
      fieldSource
    );
    return issues.length === 0
      ? undefined
      : issues.map(issue => issue.message).join(" ");
  };
  const titleId = `${id}-title`;
  return (
    <section className="nx-list-query__group" aria-labelledby={titleId}>
      <GroupTitle id={titleId}>Filters</GroupTitle>
      <p className="nx-inspector__note nx-list-query__hint">
        {rows.length === 0
          ? relatedWordsShown === undefined
            ? "Every entry is shown."
            : `Every one of ${relatedWordsShown.replace(/^This /, "this ").replace(/^Each /, "each ")} is shown.`
          : "Show entries where all of these match."}
      </p>
      {rows.length === 0 ? null : (
        <ul className="nx-list-query__filters" aria-label="Filters">
          {rows.map(row => (
            <FilterRow
              key={row.key}
              id={`${id}-${row.key.replace(":", "-")}`}
              row={row}
              fields={fields}
              open={openKey === row.key}
              disabled={disabled}
              storedProblem={storedProblems(row)}
              services={services}
              entryTitle={entryTitle}
              onOpen={() => setOpenKey(row.key)}
              onClose={() => setOpenKey(null)}
              onChange={draft => change(row, draft)}
              onRemove={() => remove(row)}
            />
          ))}
        </ul>
      )}
      {problems.length === 0 ? null : (
        <FieldError id={`${id}-error`}>{problems.join(" ")}</FieldError>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-list-query__add"
        disabled={disabled || fields.length === 0 || filterLimit.full}
        aria-describedby={filterLimit.describedBy}
        onClick={() => {
          nextKey.current += 1;
          const key = `new:${String(nextKey.current)}`;
          setAdded(current => [...current, { key, draft: {} }]);
          // A new filter opens already open, its field menu with it.
          setOpenKey(key);
        }}
      >
        <Plus aria-hidden="true" size={14} />
        Add filter
      </Button>
      <LimitNote limit={filterLimit}>
        Up to {LIST_MAX_FILTERS} filters.
      </LimitNote>
    </section>
  );
}

/** Whether a list holds the most of something it takes, and the note saying so. */
interface ListLimit {
  full: boolean;
  /** The note's id while the limit is reached, for the Add button to name. */
  describedBy: string | undefined;
  id: string;
}

/** The limit of `count` against `most`, its note under `${id}-limit`. */
function listLimit(count: number, most: number, id: string): ListLimit {
  const full = count >= most;
  const noteId = `${id}-limit`;
  return { full, describedBy: full ? noteId : undefined, id: noteId };
}

/** Why an Add button is off: shown only once the list holds the most it takes. */
function LimitNote({
  limit,
  children,
}: {
  limit: ListLimit;
  children: React.ReactNode;
}): React.JSX.Element | null {
  if (!limit.full) return null;
  return (
    <p id={limit.id} className="nx-inspector__note nx-list-query__hint">
      {children}
    </p>
  );
}

/** Each key's React key: its field, and how many times it came before. */
function sortRowKeys(keys: readonly ListSortKey[]): string[] {
  const seen = new Map<string, number>();
  return keys.map(key => {
    const count = seen.get(key.field) ?? 0;
    seen.set(key.field, count + 1);
    return `${key.field}:${String(count)}`;
  });
}

/**
 * The index a dragged row lands at: the row under the pointer, asked of the
 * document rather than measured, so no rectangle is read here; `undefined`
 * where the pointer is over no row of this list.
 */
function dropIndex(
  list: HTMLElement,
  at: { readonly clientX: number; readonly clientY: number }
): number | undefined {
  const under = list.ownerDocument
    .elementFromPoint(at.clientX, at.clientY)
    ?.closest(".nx-list-sort");
  if (under === null || under === undefined || under.parentElement !== list) {
    return undefined;
  }
  return Array.from(list.children).indexOf(under);
}

/**
 * The step Alt+↑ or Alt+↓ moves a row, as Layers moves a block; nothing for
 * any other key.
 */
function altStep(event: React.KeyboardEvent): -1 | 1 | undefined {
  if (!event.altKey) return undefined;
  if (event.key === "ArrowUp") return -1;
  return event.key === "ArrowDown" ? 1 : undefined;
}

/** A key's field, from those a list may sort by; a lost one is marked. */
function SortFieldPicker({
  id,
  labelId,
  sortKey,
  field,
  fields,
  disabled,
  errorId,
  onField,
}: {
  id: string;
  labelId: string;
  sortKey: ListSortKey;
  field: LoopListField | undefined;
  fields: readonly LoopListField[];
  disabled: boolean;
  /** The id of the key's error, when it has one. */
  errorId: string | undefined;
  onField: (field: LoopListField) => void;
}): React.JSX.Element {
  return (
    <LoopPicker
      id={id}
      labelId={labelId}
      value={{
        words: field?.label ?? `${sortKey.field} · not in this collection`,
        state: field === undefined ? "unknown" : "value",
        invalid: errorId !== undefined,
        describedBy: errorId,
      }}
      disabled={disabled}
      list={fieldList(fields, sortKey.field, "Fields to sort by")}
      around={{ below: PUBLIC_ONLY }}
      onPick={choice => onField(choice.field)}
    />
  );
}

/** A key's direction, in the words its field's kind is ordered in. */
function DirectionPicker({
  name,
  words,
  descending,
  disabled,
  onDirection,
}: {
  name: string;
  words: { readonly ascending: string; readonly descending: string };
  descending: boolean;
  disabled: boolean;
  onDirection: (descending: boolean) => void;
}): React.JSX.Element {
  return (
    <Select
      value={descending ? "descending" : "ascending"}
      disabled={disabled}
      onValueChange={value => onDirection(value === "descending")}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Order of ${name}`}
        className="nx-list-sort__direction"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="descending">{words.descending}</SelectItem>
        <SelectItem value="ascending">{words.ascending}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** A key's menu: move it up or down, with the keys that do so, or remove it. */
function SortRowMenu({
  name,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`More for sort by ${name}`}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={index === 0}
          onSelect={() => onMove(index - 1)}
        >
          Move up
          <kbd className="nx-list-query__kbd">Alt+↑</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === count - 1}
          onSelect={() => onMove(index + 1)}
        >
          Move down
          <kbd className="nx-list-query__kbd">Alt+↓</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove}>Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a sort row's actions do to the stored keys. */
interface SortRowActions {
  readonly field: (field: LoopListField) => void;
  readonly direction: (descending: boolean) => void;
  readonly move: (to: number) => void;
  readonly remove: () => void;
  readonly dragStart: (event: React.PointerEvent<HTMLElement>) => void;
}

/** The handle a sort row is dragged by, which a pointer alone uses. */
function SortHandle({
  disabled,
  onDragStart,
}: {
  disabled: boolean;
  onDragStart: SortRowActions["dragStart"];
}): React.JSX.Element {
  return (
    <span
      className="nx-list-sort__handle"
      aria-hidden="true"
      title="Drag to reorder"
      onPointerDown={disabled ? undefined : onDragStart}
    >
      <GripVertical size={14} />
    </span>
  );
}

/** Alt+↑ and Alt+↓ on a sort row move it, unless the group is disabled. */
function altMover(
  disabled: boolean,
  index: number,
  move: SortRowActions["move"]
): (event: React.KeyboardEvent<HTMLElement>) => void {
  return event => {
    const step = disabled ? undefined : altStep(event);
    if (step === undefined) return;
    event.preventDefault();
    move(index + step);
  };
}

/** One sort key: handle, field, direction in words, and its menu. */
function SortRow({
  id,
  index,
  count,
  sortKey,
  fields,
  disabled,
  problem,
  dragging,
  on,
}: {
  id: string;
  index: number;
  count: number;
  sortKey: ListSortKey;
  fields: readonly LoopListField[];
  disabled: boolean;
  problem: string | undefined;
  dragging: boolean;
  on: SortRowActions;
}): React.JSX.Element {
  const field = fields.find(each => each.name === sortKey.field);
  const name = field?.label ?? sortKey.field;
  const labelId = `${id}-label`;
  // The row's error, by id, when it has one.
  const errorId = problem === undefined ? undefined : `${id}-error`;
  return (
    <li
      className="nx-list-sort"
      data-dragging={dragging ? "" : undefined}
      data-invalid={errorId === undefined ? undefined : ""}
      onKeyDown={altMover(disabled, index, on.move)}
    >
      <span id={labelId} className="nx-sr-only">
        {`Sort ${String(index + 1)} of ${String(count)}, by`}
      </span>
      <SortHandle disabled={disabled} onDragStart={on.dragStart} />
      <SortFieldPicker
        id={`${id}-field`}
        labelId={labelId}
        sortKey={sortKey}
        field={field}
        fields={fields}
        disabled={disabled}
        errorId={errorId}
        onField={on.field}
      />
      <DirectionPicker
        name={name}
        words={directionWords(field?.kind)}
        descending={sortKey.descending}
        disabled={disabled || field === undefined}
        onDirection={on.direction}
      />
      <SortRowMenu
        name={name}
        index={index}
        count={count}
        disabled={disabled}
        onMove={on.move}
        onRemove={on.remove}
      />
      {errorId === undefined ? null : (
        <FieldError id={errorId}>{problem}</FieldError>
      )}
    </li>
  );
}

/**
 * Focus the first sort row's field, or Add sort when there is no row, once
 * per new ask. After the frame the ask is drawn in, since the ask can move
 * the inspector to its Content tab in the same draw, which reveals the row.
 */
function useFocusOnAsk(
  group: React.RefObject<HTMLElement | null>,
  asked: number | undefined,
  firstFieldId: string
): void {
  const answered = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (asked === undefined || asked === answered.current) return;
    answered.current = asked;
    const timer = setTimeout(() => {
      const root = group.current;
      if (root === null) return;
      const target =
        root.ownerDocument.getElementById(firstFieldId) ??
        root.querySelector<HTMLElement>("[data-list-add-sort]");
      target?.scrollIntoView({ block: "nearest" });
      target?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [group, asked, firstFieldId]);
}

/** The menu of fields a new sort key can order by. */
function AddSortButton({
  fields,
  disabled,
  describedBy,
  onPick,
}: {
  fields: readonly LoopListField[];
  disabled: boolean;
  /** The note saying why the button is off, when it is. */
  describedBy: string | undefined;
  onPick: (field: LoopListField) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const choices: FieldChoice[] = fields.map(each => ({
    key: each.name,
    label: each.label,
    field: each,
  }));
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="nx-list-query__add"
          // Where an ask to fix the sort lands when there is no row.
          data-list-add-sort=""
          disabled={disabled || fields.length === 0}
          aria-describedby={describedBy}
        >
          <Plus aria-hidden="true" size={14} />
          Add sort
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="nx-font-pick__popover"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <div className="nx-font-pick__body">
          <ChoiceList
            choices={choices}
            currentKey={undefined}
            label="Fields to sort by"
            searchLabel="Search fields"
            noMatch="No field matches."
            searchFrom={1}
            renderChoice={fieldRow}
            onPick={choice => {
              setOpen(false);
              onPick(choice.field);
            }}
          />
          {PUBLIC_ONLY}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The Sort group: one row per key, in order, and a way to add one. */
function SortGroup({
  id,
  query,
  node,
  fields,
  fieldSource,
  disabled,
  problems,
  fieldAsked,
  onSort,
}: {
  id: string;
  query: ListQuery;
  node: BlockNode;
  fields: readonly LoopListField[];
  fieldSource: ListFieldSource | undefined;
  disabled: boolean;
  problems: readonly string[];
  /** The count of the latest ask to fix this sort, from the canvas. */
  fieldAsked: number | undefined;
  onSort: (keys: readonly ListSortKey[]) => void;
}): React.JSX.Element {
  const keys = query.sort;
  const sortLimit = listLimit(keys.length, LIST_MAX_SORT_KEYS, id);
  const group = React.useRef<HTMLElement>(null);
  useFocusOnAsk(group, fieldAsked, `${id}-0-field`);
  const sortable = fields.filter(field => listKindSortable(field.kind));
  const rowKeys = sortRowKeys(keys);
  const list = React.useRef<HTMLOListElement>(null);
  const [drag, setDrag] = React.useState<{ from: number; to: number } | null>(
    null
  );
  const startDrag =
    (from: number) => (event: React.PointerEvent<HTMLElement>) => {
      const handle = event.currentTarget;
      const rows = list.current;
      if (rows === null) return;
      handle.setPointerCapture(event.pointerId);
      let to = from;
      setDrag({ from, to });
      const move = (moved: PointerEvent) => {
        to = dropIndex(rows, moved) ?? to;
        setDrag({ from, to });
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        setDrag(null);
        if (to !== from) onSort(movedKey(keys, from, to));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    };
  const shown = drag === null ? keys : movedKey(keys, drag.from, drag.to);
  const shownRowKeys =
    drag === null
      ? rowKeys
      : movedKey(
          rowKeys.map(each => ({ field: each, descending: false })),
          drag.from,
          drag.to
        ).map(each => each.field);
  const titleId = `${id}-title`;
  return (
    <section
      ref={group}
      className="nx-list-query__group"
      aria-labelledby={titleId}
    >
      <GroupTitle id={titleId}>Sort</GroupTitle>
      {shown.length === 0 ? (
        <p className="nx-inspector__note nx-list-query__hint">
          {query.relation === undefined
            ? "No sort: entries show in the order they were added."
            : "No sort: entries show in the order chosen on the entry."}
        </p>
      ) : (
        <ol ref={list} className="nx-list-query__sort" aria-label="Sort keys">
          {shown.map((key, index) => {
            const original = drag === null ? index : keys.indexOf(key);
            const problems = partIssues(
              node,
              { sort: sortValue([key]) },
              fieldSource
            );
            return (
              <SortRow
                key={shownRowKeys[index] ?? String(index)}
                id={`${id}-${String(index)}`}
                index={index}
                count={shown.length}
                sortKey={key}
                fields={sortable}
                disabled={disabled}
                problem={
                  problems.length === 0
                    ? undefined
                    : problems.map(issue => issue.message).join(" ")
                }
                dragging={drag !== null && drag.to === index}
                on={{
                  field: field =>
                    onSort(
                      keys.map((each, at) =>
                        at === index
                          ? { field: field.name, descending: each.descending }
                          : each
                      )
                    ),
                  direction: descending =>
                    onSort(
                      keys.map((each, at) =>
                        at === index ? { ...each, descending } : each
                      )
                    ),
                  move: to => {
                    if (to < 0 || to >= keys.length) return;
                    onSort(movedKey(keys, index, to));
                  },
                  remove: () => onSort(keys.filter((_, at) => at !== index)),
                  dragStart: startDrag(original),
                }}
              />
            );
          })}
        </ol>
      )}
      {problems.length === 0 ? null : (
        <FieldError id={`${id}-error`}>{problems.join(" ")}</FieldError>
      )}
      <AddSortButton
        fields={sortable.filter(
          field => !keys.some(key => key.field === field.name)
        )}
        // No key past the most a list sorts by, which the save refuses.
        disabled={disabled || sortLimit.full}
        describedBy={sortLimit.describedBy}
        onPick={field =>
          onSort([
            ...keys,
            { field: field.name, descending: firstDirection(field.kind) },
          ])
        }
      />
      <LimitNote limit={sortLimit}>Up to {LIST_MAX_SORT_KEYS} sorts.</LimitNote>
      {shown.length === 0 ? null : (
        <p className="nx-inspector__note nx-list-query__hint">
          Entries with the same values keep a fixed order. Entries with no value
          come last.
        </p>
      )}
    </section>
  );
}

/** The text a bound field opens with: the stored number, or the unset one. */
function boundText(stored: unknown, unsetValue: number | undefined): string {
  if (typeof stored === "number" || typeof stored === "string") {
    return String(stored);
  }
  return unsetValue === undefined ? "" : String(unsetValue);
}

/**
 * A bound field's draft: the text typed, the problem with it, and the send
 * that writes it once a save would take it. The shown unset value, sent back
 * unchanged, is what the list already reads, so it is no edit.
 */
function useBoundDraft(
  prop: "limit" | "offset",
  stored: unknown,
  unsetValue: number | undefined,
  onBound: (value: number | undefined) => void
): {
  draft: string;
  setDraft: (text: string) => void;
  problem: string | undefined;
  send: () => void;
} {
  const text = boundText(stored, unsetValue);
  const [draft, setDraft] = React.useState(text);
  const [problem, setProblem] = React.useState<string | undefined>();
  React.useEffect(() => {
    setDraft(text);
    setProblem(undefined);
  }, [text]);
  const send = () => {
    const read = readBound(prop, draft);
    if ("problem" in read) {
      // Refused here rather than written: the canvas keeps the last list.
      setProblem(read.problem);
      return;
    }
    setProblem(undefined);
    const unchanged =
      read.value === stored ||
      (stored === undefined && read.value === unsetValue);
    if (!unchanged) onBound(read.value);
  };
  return { draft, setDraft, problem, send };
}

/** Under a bound field: its problem, or, with none, its hint. */
function BoundFoot({
  errorId,
  problem,
  hint,
}: {
  errorId: string;
  problem: string | undefined;
  hint: string | undefined;
}): React.JSX.Element | null {
  if (problem !== undefined) {
    return <FieldError id={errorId}>{problem}</FieldError>;
  }
  if (hint === undefined) return null;
  // In the field's control column already, under the number it is about.
  return (
    <p className="nx-inspector__note nx-list-query__hint" role="status">
      {hint}
    </p>
  );
}

/** A number of entries typed, written once a save would take it. */
function BoundField({
  id,
  prop,
  words,
  stored,
  fallback,
  unsetValue,
  disabled,
  problem: storedProblem,
  hint,
  onBound,
}: {
  id: string;
  prop: "limit" | "offset";
  /** The field's label, and what it counts, said after the number. */
  words: { readonly label: string; readonly suffix?: string };
  stored: unknown;
  /** What the list reads when nothing is stored, shown as the placeholder. */
  fallback?: unknown;
  /**
   * What the list reads when nothing is stored, shown as the field's value:
   * for a number an author reads as a plain fact (skip 0) rather than a hint.
   * Sending it unchanged writes nothing, so nothing is stored for it.
   */
  unsetValue?: number;
  disabled: boolean;
  problem: string | undefined;
  /** A line under the field, said while it has no problem to say. */
  hint?: string | undefined;
  onBound: (value: number | undefined) => void;
}): React.JSX.Element {
  const { draft, setDraft, problem, send } = useBoundDraft(
    prop,
    stored,
    unsetValue,
    onBound
  );
  const shown = problem ?? storedProblem;
  const errorId = `${id}-error`;
  return (
    <div className="nx-inspector__field" data-content-control="number">
      <Label htmlFor={id}>{words.label}</Label>
      <div
        className="nx-list-query__bound"
        data-suffixed={words.suffix === undefined ? undefined : ""}
      >
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={prop === "limit" ? 1 : 0}
          max={prop === "limit" ? 100 : undefined}
          value={draft}
          placeholder={
            typeof fallback === "number" ? String(fallback) : undefined
          }
          disabled={disabled}
          aria-invalid={shown === undefined ? undefined : true}
          aria-describedby={shown === undefined ? undefined : errorId}
          onChange={event => setDraft(event.target.value)}
          onBlur={send}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
        {words.suffix === undefined ? null : (
          <span className="nx-list-query__suffix" aria-hidden="true">
            {words.suffix}
          </span>
        )}
      </div>
      <BoundFoot errorId={errorId} problem={shown} hint={hint} />
    </div>
  );
}

/** The engine's issues about one prop, of one code, in its words. */
function codedIssues(issues: Issues, prop: string, code: string): string[] {
  return issues
    .filter(
      issue => issue.path.endsWith(`/props/${prop}`) && issue.code === code
    )
    .map(issue => issue.message);
}

/**
 * What splitting into pages makes of the count: "24 entries match, so 3
 * pages of 10.", or what a switch turned on will do when nothing is counted.
 */
function pagesWords(
  counted: ListEntriesCount | undefined,
  values: Readonly<Record<string, unknown>>,
  limitFallback: unknown
): string {
  const stored = values.limit ?? limitFallback;
  const limit = typeof stored === "number" && stored >= 1 ? stored : 10;
  const each = `${String(limit)} ${limit === 1 ? "entry" : "entries"}`;
  if (counted === undefined) {
    return `Shows ${each} on each page, at /page/2, /page/3 and on.`;
  }
  const offset = typeof values.offset === "number" ? values.offset : 0;
  const pages = listPageCount(counted.matching, offset, limit);
  const match =
    counted.matching === 1
      ? "1 entry matches"
      : `${String(counted.matching)} entries match`;
  return `${match}, so ${pages === 1 ? "1 page" : `${String(pages)} pages`} of ${each}.`;
}

/** The How many group: the number of items, the entries to skip, and pages. */
/**
 * How many entries the list's query matches and how many it shows, counted
 * once per query: drawn again with the same query, nothing is read again,
 * and an answer for a query since changed is dropped.
 */
function useListCount(
  count: ContentServices["countListEntries"],
  values: Readonly<Record<string, unknown>>
): ListEntriesCount | undefined {
  const asked = JSON.stringify(
    LIST_QUERY_PROPS.map(name => values[name] ?? null)
  );
  const [answer, setAnswer] = React.useState<
    { readonly asked: string; readonly count: ListEntriesCount } | undefined
  >(undefined);
  React.useEffect(() => {
    if (count === undefined) return;
    let current = true;
    // The props the count is of, read back from the key, so the read and
    // the key it is kept under are one value.
    const read = JSON.parse(asked) as unknown[];
    const props = Object.fromEntries(
      LIST_QUERY_PROPS.flatMap((name, at) =>
        read[at] === null ? [] : [[name, read[at]]]
      )
    );
    count(props).then(
      found => {
        if (current && found !== undefined) setAnswer({ asked, count: found });
      },
      // A count that fails says nothing: the canvas's note says why the
      // list's read failed.
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [count, asked]);
  return answer?.asked === asked ? answer.count : undefined;
}

/** "4 entries match, so 3 show.", with one entry spoken of as one. */
function countWords({ matching, shown }: ListEntriesCount): string {
  const match =
    matching === 1 ? "1 entry matches" : `${String(matching)} entries match`;
  const show = shown === 1 ? "1 shows" : `${String(shown)} show`;
  return `${match}, so ${show}.`;
}

function HowManyGroup({
  id,
  values,
  limitFallback,
  issues,
  disabled,
  count,
  commit,
}: {
  id: string;
  values: Readonly<Record<string, unknown>>;
  /** The number of items the block reads when none is stored. */
  limitFallback: unknown;
  issues: Issues;
  disabled: boolean;
  /** The host's count of the list's matching entries, where it has one. */
  count: ContentServices["countListEntries"];
  commit: (changes: Readonly<Record<string, unknown>>) => void;
}): React.JSX.Element {
  const counted = useListCount(count, values);
  return (
    <section className="nx-list-query__group" aria-labelledby={`${id}-title`}>
      <GroupTitle id={`${id}-title`}>How many</GroupTitle>
      <BoundField
        id={`${id}-limit`}
        prop="limit"
        words={{ label: "Number of items" }}
        stored={values.limit}
        fallback={limitFallback}
        disabled={disabled}
        problem={issuesAt(issues, ["limit"])[0]}
        hint={counted === undefined ? undefined : countWords(counted)}
        onBound={limit => commit({ limit })}
      />
      <BoundField
        id={`${id}-offset`}
        prop="offset"
        words={{ label: "Skip the first", suffix: "entries" }}
        stored={values.offset}
        unsetValue={0}
        disabled={disabled}
        problem={issuesAt(issues, ["offset"])[0]}
        // Skipping none stores nothing, as a list that skips none always did.
        onBound={offset =>
          commit({ offset: offset === 0 ? undefined : offset })
        }
      />
      <PagesField
        id={`${id}-pages`}
        on={values.paginate === true}
        disabled={disabled}
        problem={issuesAt(issues, ["paginate"])[0]}
        hint={
          values.paginate === true
            ? pagesWords(counted, values, limitFallback)
            : undefined
        }
        // Off stores nothing, as a list that never paginated holds nothing.
        onChange={on => commit({ paginate: on ? true : undefined })}
      />
    </section>
  );
}

/**
 * Whether the list is split into pages, each at its own address: a switch,
 * with what it makes of the count under it while on, or why the page cannot
 * serve it.
 */
function PagesField({
  id,
  on,
  disabled,
  problem,
  hint,
  onChange,
}: {
  id: string;
  on: boolean;
  disabled: boolean;
  problem: string | undefined;
  hint: string | undefined;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const errorId = `${id}-error`;
  return (
    <div className="nx-inspector__field" data-content-control="paginate">
      <Label htmlFor={id}>Split into pages</Label>
      <Switch
        id={id}
        checked={on}
        disabled={disabled}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? undefined : errorId}
        onCheckedChange={onChange}
      />
      <BoundFoot errorId={errorId} problem={problem} hint={hint} />
    </div>
  );
}

/** When nothing matches: whether the canvas draws the entries or the empty state. */
function CanvasShowsGroup({
  id,
  showsEmpty,
  onShowEmpty,
}: {
  id: string;
  showsEmpty: boolean;
  onShowEmpty: (empty: boolean) => void;
}): React.JSX.Element {
  const canvasId = `${id}-canvas`;
  return (
    <section className="nx-list-query__group" aria-labelledby={`${id}-title`}>
      <GroupTitle id={`${id}-title`}>When nothing matches</GroupTitle>
      <div className="nx-inspector__field" data-content-control="canvasShows">
        <span id={`${canvasId}-label`} className="nx-inspector__field-name">
          Canvas shows
        </span>
        <SegmentedChoice
          id={canvasId}
          labelledBy={`${canvasId}-label`}
          options={["entries", "empty"]}
          labels={["Entries", "When empty"]}
          value={showsEmpty ? "empty" : "entries"}
          disabled={false}
          onChoose={option => onShowEmpty(option === "empty")}
        />
      </div>
      <p className="nx-inspector__note nx-list-query__hint nx-list-query__indented">
        {showsEmpty
          ? "Visitors see these blocks when no entry matches. Left empty, the list shows nothing."
          : "Switch to design what visitors see when no entry matches."}
      </p>
    </section>
  );
}

/** A list's query as the group reads it: stored, offered and judged. */
interface ListQueryReading {
  readonly values: Readonly<Record<string, unknown>>;
  readonly query: ListQuery;
  readonly listed: LoopCollections | undefined;
  readonly collections: readonly LoopCollection[];
  readonly fieldSource: ListFieldSource | undefined;
  readonly issues: Issues;
  readonly related: Related;
  readonly fields: readonly LoopListField[];
}

/**
 * The list's query, read by the engine from its props; the host's
 * collections; and the engine's judgement of the list where it sits, the
 * collection its document is an entry of and the list around it included.
 */
function useListQueryReading(
  props: readonly EditableProp[],
  services: ContentServices | undefined,
  document: BlockDocument,
  nodeId: string
): ListQueryReading {
  const values = React.useMemo(
    () => Object.fromEntries(props.map(prop => [prop.name, prop.value])),
    [props]
  );
  const { query } = readListQuery(values);
  const listed = useLoopCollections(services?.listLoopCollections);
  const collections = listed?.kind === "ready" ? listed.collections : [];
  const fieldSource = React.useMemo(
    () =>
      listed?.kind === "ready" ? fieldSourceOf(listed.collections) : undefined,
    [listed]
  );
  const entryCollection = services?.entryCollection;
  const issues = React.useMemo(
    () =>
      listQueryIssues(document.nodes, {
        ...(fieldSource === undefined ? {} : { fields: fieldSource }),
        ...(entryCollection === undefined ? {} : { entryCollection }),
        // So a component's or a Layout region's list is told at once that it
        // can't be split into pages, as its save would be.
        documentKind: document.kind,
      }).filter(issue => issue.nodeId === nodeId && issue.severity === "error"),
    [document, nodeId, fieldSource, entryCollection]
  );
  // The list whose entry is this one's item, as the save judges it: never
  // one whose empty state this list sits in.
  const outerNode = outerListOf(document.nodes, nodeId);
  const outer =
    outerNode === undefined ? undefined : readListQuery(outerNode.props).query;
  return {
    values,
    query,
    listed,
    collections,
    fieldSource,
    issues,
    related: {
      ...relatedSources(collections, entryCollection, outer),
      inEmptyState: inListEmptyState(document.nodes, nodeId),
    },
    fields:
      collections.find(each => each.slug === query.collection)?.fields ?? [],
  };
}

/** Whether a new source changes what the list stores. */
function changesSource(
  query: ListQuery,
  changes: Readonly<Record<string, unknown>>
): boolean {
  return (
    changes.collection !== query.collection ||
    JSON.stringify(changes.relation) !== JSON.stringify(query.relation)
  );
}

/** The words a related source is shown in, for the line under Filters. */
function relatedShownOf(
  query: ListQuery,
  related: Related
): string | undefined {
  const relation = query.relation;
  if (relation === undefined) return undefined;
  return [...related.entry, ...related.item].find(
    each => each.of === relation.of && each.field === relation.field
  )?.words;
}

/**
 * A collection list's query, drawn as one group in the Content tab where its
 * `collection` prop would sit.
 */
export function ListQueryField({
  props,
  writable,
  services,
  onCommitMany,
  document,
  nodeId,
  showsEmpty,
  onShowEmpty,
  sortFieldAsked,
}: ListQueryFieldProps): React.JSX.Element | null {
  const id = React.useId();
  const reading = useListQueryReading(props, services, document, nodeId);
  const { query, listed, issues, fields, fieldSource } = reading;
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return null;
  const held = LIST_QUERY_PROPS.some(
    name => props.some(prop => prop.name === name) && !writable(name)
  );
  const unsourced = held || query.collection === undefined;
  const commit = (changes: Readonly<Record<string, unknown>>) => {
    onCommitMany(changes);
  };
  return (
    <div className="nx-list-query" data-content-control="listQuery">
      {listed === undefined || listed.kind === "failed" ? (
        <p className="nx-inspector__note">
          The site&apos;s collections could not be listed, so this list&apos;s
          source, filters and sort can&apos;t be chosen here.
        </p>
      ) : (
        <SourceField
          id={`${id}-source`}
          query={query}
          listed={listed}
          collections={reading.collections}
          related={reading.related}
          disabled={held}
          problems={issuesAt(issues, ["collection", "relation"])}
          onPick={pick => {
            const changes = sourceChanges(query, pick);
            if (changesSource(query, changes)) commit(changes);
          }}
        />
      )}
      <FiltersGroup
        key={query.collection ?? ""}
        id={`${id}-filters`}
        query={query}
        node={node}
        fields={fields}
        fieldSource={fieldSource}
        disabled={unsourced}
        problems={codedIssues(issues, "filters", "list-filter-invalid")}
        services={services}
        relatedWordsShown={relatedShownOf(query, reading.related)}
        onFilters={filters => commit({ filters })}
      />
      <SortGroup
        id={`${id}-sort`}
        query={query}
        node={node}
        fields={fields}
        fieldSource={fieldSource}
        disabled={unsourced}
        problems={codedIssues(issues, "sort", "list-sort-invalid")}
        fieldAsked={sortFieldAsked}
        onSort={keys => commit({ sort: sortValue(keys) })}
      />
      <HowManyGroup
        id={`${id}-many`}
        values={reading.values}
        limitFallback={props.find(prop => prop.name === "limit")?.defaultValue}
        issues={issues}
        disabled={held}
        count={services?.countListEntries}
        commit={commit}
      />
      {onShowEmpty === undefined ? null : (
        <CanvasShowsGroup
          id={`${id}-empty`}
          showsEmpty={showsEmpty}
          onShowEmpty={onShowEmpty}
        />
      )}
    </div>
  );
}
