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
  LIST_MAX_FILTERS,
  listKindSortable,
  listQueryIssues,
  locateNode,
  readListQuery,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
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
} from "./collection-loop-controls";
import {
  SegmentedChoice,
  type ContentServices,
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
  type OperatorChoice,
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

/** A collection's fields in the engine's terms, for judging a list against. */
function fieldSourceOf(
  collections: readonly LoopCollection[]
): ListFieldSource {
  const bySlug = new Map(collections.map(each => [each.slug, each]));
  return {
    fieldsOf: slug => {
      const found = bySlug.get(slug);
      if (found === undefined) return undefined;
      // What the editor knows of the public's fields: the ones offered, and
      // the to-many relations, which a related list names.
      const readable: BindingFieldShape[] = [
        { name: "id", type: "text" },
        ...found.fields.map(field => ({
          name: field.name,
          type: field.kind === "entry" ? "relationship" : field.kind,
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
      return {
        declared: new Set([
          ...(found.declared ?? []),
          ...readable.map(shape => shape.name),
        ]),
        readable,
      };
    },
  };
}

/** The list block around `id`, nearest first, if there is one. */
function outerList(document: BlockDocument, id: string): BlockNode | undefined {
  let at = locateNode(document.nodes, id)?.parent;
  // Bounded by the document's depth: each step moves one parent out.
  while (at !== undefined) {
    if (at.type === COLLECTION_LIST_TYPE) return at;
    at = locateNode(document.nodes, at.id)?.parent;
  }
  return undefined;
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
}

/** The related sources a list may show where it sits. */
function relatedSources(
  collections: readonly LoopCollection[],
  entryCollection: string | undefined,
  outer: ListQuery | undefined
): Related {
  const ownerOf = (slug: string | undefined) =>
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
  const relation = query.relation;
  const all = [...related.entry, ...related.item];
  const currentRelated =
    relation === undefined
      ? undefined
      : all.find(
          each => each.of === relation.of && each.field === relation.field
        );
  const current = collections.find(each => each.slug === query.collection);
  const shown =
    listed.kind === "loading"
      ? { words: "Loading collections…", state: "prompt" as const }
      : relation !== undefined
        ? {
            words:
              currentRelated?.words ?? `${relation.field} · not available here`,
            state:
              currentRelated === undefined
                ? ("unknown" as const)
                : ("value" as const),
          }
        : query.collection === undefined
          ? { words: "Choose a collection", state: "prompt" as const }
          : current === undefined
            ? {
                words: `${query.collection} · not available`,
                state: "unknown" as const,
              }
            : { words: current.label, state: "value" as const };
  const choices: SourceChoice[] = [
    ...related.entry.map(source => ({
      key: `entry:${source.field}`,
      label: source.words,
      group: "entry",
      pick: { kind: "related" as const, source },
    })),
    ...related.item.map(source => ({
      key: `item:${source.field}`,
      label: source.words,
      group: "item",
      pick: { kind: "related" as const, source },
    })),
    {
      key: "collection:",
      label: "No collection",
      group: "collections",
      pick: { kind: "collection", slug: undefined },
    },
    ...alphabetical(collections).map(each => ({
      key: `collection:${each.slug}`,
      label: each.label,
      group: "collections",
      pick: { kind: "collection" as const, slug: each.slug },
    })),
  ];
  const groups = [
    ...(related.entry.length === 0
      ? []
      : [{ group: "entry", heading: related.entryHeading }]),
    ...(related.item.length === 0
      ? []
      : [{ group: "item", heading: related.itemHeading }]),
    { group: "collections", heading: "Collections" },
  ];
  const currentKey =
    relation === undefined
      ? `collection:${query.collection ?? ""}`
      : `${relation.of}:${relation.field}`;
  return (
    <div className="nx-inspector__field" data-content-control="listSource">
      <Label id={labelId} htmlFor={id}>
        Source
      </Label>
      <LoopPicker
        id={id}
        labelId={labelId}
        shown={shown.words}
        state={shown.state}
        disabled={disabled || listed.kind === "loading"}
        choices={choices}
        groups={groups}
        currentKey={currentKey}
        listLabel="Sources"
        searchLabel="Search sources"
        noMatch="No source matches."
        searchFrom={1}
        icon={
          relation === undefined ? undefined : (
            <Link2
              aria-hidden="true"
              size={14}
              className="nx-list-query__icon"
            />
          )
        }
        invalid={problems.length > 0}
        describedBy={
          problems.length > 0
            ? errorId
            : relation === undefined
              ? undefined
              : hintId
        }
        above={
          all.length > 0 ? undefined : (
            <div className="nx-list-query__menu-note">
              <p className="nx-list-query__menu-heading">Related entries</p>
              <p>
                Not available here. On a collection&apos;s entry, or inside
                another list, a list can show the entry&apos;s related entries,
                such as its categories or tags.
              </p>
            </div>
          )
        }
        onPick={choice => onPick(choice.pick)}
      />
      {problems.length > 0 ? (
        <FieldError id={errorId}>{problems.join(" ")}</FieldError>
      ) : relation !== undefined && currentRelated !== undefined ? (
        <p id={hintId} className="nx-inspector__note nx-list-query__hint">
          {relation.of === "entry"
            ? `The ${currentRelated.words.replace(/^This [^']+'s /, "")} chosen on the entry this page shows.`
            : `The ${currentRelated.words.replace(/^Each [^']+'s /, "")} of each entry the list around this one shows.`}{" "}
          Filters and sort use the fields of{" "}
          {collections.find(each => each.slug === currentRelated.collection)
            ?.label ?? currentRelated.collection}
          .
        </p>
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
    const field = fields.find(each => each.name === row.field);
    if (field?.kind !== "entry" || field.relationTo === undefined) continue;
    const ids = Array.isArray(row.value) ? row.value : [row.value];
    for (const id of ids) {
      if (typeof id !== "string" || id === "") continue;
      const set = byCollection.get(field.relationTo) ?? new Set<string>();
      set.add(id);
      byCollection.set(field.relationTo, set);
    }
  }
  return byCollection;
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

/** The value control a row's field and operator call for. */
function FilterValue({
  id,
  labelledBy,
  field,
  draft,
  disabled,
  invalid,
  describedBy,
  services,
  entryTitle,
  onValue,
}: {
  id: string;
  labelledBy: string;
  field: LoopListField;
  draft: DraftFilter & { op: ListFilterOp };
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  services: ContentServices | undefined;
  entryTitle: (id: string) => string | undefined;
  onValue: (value: unknown) => void;
}): React.JSX.Element | null {
  const many = takesList(draft.op);
  const values = Array.isArray(draft.value) ? draft.value : [];
  if (draft.op === "exists") return null;
  if (field.kind === "boolean") {
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
  if (field.kind === "choice") {
    if (many) {
      return (
        <ChoiceChecklist
          labelledBy={labelledBy}
          field={field}
          values={values}
          disabled={disabled}
          onDone={onValue}
        />
      );
    }
    return (
      <Select
        value={typeof draft.value === "string" ? draft.value : ""}
        disabled={disabled}
        onValueChange={onValue}
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
  if (field.kind === "entry") {
    const ids = many
      ? values.filter((value): value is string => typeof value === "string")
      : [];
    const pick = (
      <RelationControl
        id={id}
        label={many ? "Add an entry" : "Entry"}
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
          if (!many) {
            onValue(chosen);
            return;
          }
          if (typeof chosen === "string" && !ids.includes(chosen)) {
            onValue([...ids, chosen]);
          }
        }}
      />
    );
    return many ? (
      <div className="nx-list-filter__entries">
        {ids.map(entry => (
          <span key={entry} className="nx-list-filter__chip">
            {entryTitle(entry) ?? "An entry"}
            <button
              type="button"
              aria-label={`Remove ${entryTitle(entry) ?? "this entry"}`}
              disabled={disabled}
              onClick={() => onValue(ids.filter(each => each !== entry))}
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        ))}
        {pick}
      </div>
    ) : (
      pick
    );
  }
  if (many) {
    return (
      <ChipValues
        id={id}
        labelledBy={labelledBy}
        values={values.map(String)}
        disabled={disabled}
        onDone={onValue}
      />
    );
  }
  return (
    <TypedValue
      id={id}
      labelledBy={labelledBy}
      kind={
        field.kind === "number"
          ? "number"
          : field.kind === "date"
            ? "date"
            : "text"
      }
      value={draft.value}
      disabled={disabled}
      describedBy={describedBy}
      onDone={onValue}
    />
  );
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

/** One filter: its sentence, opening in place into its controls. */
function FilterRow({
  id,
  row,
  fields,
  open,
  disabled,
  storedProblem,
  services,
  entryTitle,
  onOpen,
  onClose,
  onChange,
  onRemove,
}: {
  id: string;
  row: ShownRow;
  fields: readonly LoopListField[];
  open: boolean;
  disabled: boolean;
  /** What the engine finds wrong with the stored row, if anything. */
  storedProblem: string | undefined;
  services: ContentServices | undefined;
  entryTitle: (id: string) => string | undefined;
  onOpen: () => void;
  onClose: () => void;
  onChange: (draft: DraftFilter) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const field = fields.find(each => each.name === row.draft.field);
  const sentence = filterSentence(row.draft, field, entryTitle);
  const line = filterLine(sentence);
  const completed = completedFilter(row.draft, field);
  // A row with no field yet only asks for one; a stored row whose field the
  // collection lost says so from the engine; a draft says what it lacks.
  const problem =
    storedProblem ??
    (row.draft.field !== undefined && "missing" in completed
      ? completed.missing
      : undefined);
  const errorId = `${id}-error`;
  const lineRef = React.useRef<HTMLButtonElement>(null);
  const closeAndFocus = () => {
    onClose();
    // Back on the line it opened from, so the keyboard keeps its place.
    requestAnimationFrame(() => lineRef.current?.focus());
  };
  if (!open) {
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
          disabled={disabled}
          onClick={onOpen}
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
        {problem === undefined ? null : (
          <FieldError id={errorId}>{problem}</FieldError>
        )}
      </li>
    );
  }
  const fieldId = `${id}-field`;
  const opId = `${id}-op`;
  const valueId = `${id}-value`;
  const labelId = `${id}-label`;
  const choices: FieldChoice[] = fields.map(each => ({
    key: each.name,
    label: each.label,
    field: each,
  }));
  const operators = field === undefined ? [] : OPERATORS[field.kind];
  const operator =
    field === undefined || row.draft.op === undefined
      ? undefined
      : operatorOf(field.kind, row.draft.op, row.draft.value);
  const pickOperator = (choice: OperatorChoice) => {
    if (field === undefined) return;
    onChange({
      field: field.name,
      op: choice.op,
      value: valueFor(field.kind, choice, row.draft.value),
    });
  };
  return (
    <li
      className="nx-list-filter"
      data-open=""
      data-invalid={problem === undefined ? undefined : ""}
      onKeyDown={event => {
        // Escape closes the row, unless a menu inside it is taking it.
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          closeAndFocus();
        }
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
          onClick={closeAndFocus}
        >
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
        <LoopPicker
          id={fieldId}
          labelId={labelId}
          shown={
            row.draft.field === undefined
              ? "Choose a field"
              : (field?.label ?? `${row.draft.field} (removed)`)
          }
          state={
            row.draft.field === undefined
              ? "prompt"
              : field === undefined
                ? "unknown"
                : "value"
          }
          disabled={disabled}
          choices={choices}
          currentKey={row.draft.field ?? ""}
          listLabel="Fields to filter by"
          searchLabel="Search fields"
          noMatch="No field matches."
          searchFrom={1}
          renderChoice={fieldRow}
          below={PUBLIC_ONLY}
          defaultOpen={row.draft.field === undefined}
          onPick={choice => {
            if (choice.field.name === row.draft.field) return;
            const first = OPERATORS[choice.field.kind][0];
            if (first === undefined) return;
            onChange({
              field: choice.field.name,
              op: first.op,
              value: valueFor(choice.field.kind, first, undefined),
            });
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove filter: ${line}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" size={14} />
        </Button>
      </div>
      {field === undefined ? null : (
        <div className="nx-list-filter__body">
          <Select
            value={operator?.key ?? ""}
            disabled={disabled}
            onValueChange={key => {
              const choice = operators.find(each => each.key === key);
              if (choice !== undefined) pickOperator(choice);
            }}
          >
            <SelectTrigger
              id={opId}
              size="sm"
              aria-label={`How ${field.label} is compared`}
              className="nx-list-filter__op-pick"
              data-wide={row.draft.op === "exists" ? "" : undefined}
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
          {row.draft.op === undefined ? null : (
            <FilterValue
              id={valueId}
              labelledBy={labelId}
              field={field}
              draft={{ ...row.draft, op: row.draft.op }}
              disabled={disabled}
              invalid={problem !== undefined}
              describedBy={problem === undefined ? undefined : errorId}
              services={services}
              entryTitle={entryTitle}
              onValue={value => onChange({ ...row.draft, value })}
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
        disabled={
          disabled || fields.length === 0 || rows.length >= LIST_MAX_FILTERS
        }
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
    </section>
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
  onField,
  onDirection,
  onMove,
  onRemove,
  onDragStart,
}: {
  id: string;
  index: number;
  count: number;
  sortKey: ListSortKey;
  fields: readonly LoopListField[];
  disabled: boolean;
  problem: string | undefined;
  dragging: boolean;
  onField: (field: LoopListField) => void;
  onDirection: (descending: boolean) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
}): React.JSX.Element {
  const field = fields.find(each => each.name === sortKey.field);
  const words = directionWords(field?.kind);
  const name = field?.label ?? sortKey.field;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const choices: FieldChoice[] = fields.map(each => ({
    key: each.name,
    label: each.label,
    field: each,
  }));
  return (
    <li
      className="nx-list-sort"
      data-dragging={dragging ? "" : undefined}
      data-invalid={problem === undefined ? undefined : ""}
      onKeyDown={event => {
        // Alt+↑ and Alt+↓ move the row the focus is in, as Layers moves a block.
        if (!event.altKey || disabled) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onMove(index + (event.key === "ArrowUp" ? -1 : 1));
      }}
    >
      <span id={labelId} className="nx-sr-only">
        {`Sort ${String(index + 1)} of ${String(count)}, by`}
      </span>
      <span
        className="nx-list-sort__handle"
        aria-hidden="true"
        title="Drag to reorder"
        onPointerDown={disabled ? undefined : onDragStart}
      >
        <GripVertical size={14} />
      </span>
      <LoopPicker
        id={`${id}-field`}
        labelId={labelId}
        shown={field?.label ?? `${sortKey.field} · not in this collection`}
        state={field === undefined ? "unknown" : "value"}
        disabled={disabled}
        choices={choices}
        currentKey={sortKey.field}
        listLabel="Fields to sort by"
        searchLabel="Search fields"
        noMatch="No field matches."
        searchFrom={1}
        renderChoice={fieldRow}
        below={PUBLIC_ONLY}
        invalid={problem !== undefined}
        describedBy={problem === undefined ? undefined : errorId}
        onPick={choice => onField(choice.field)}
      />
      <Select
        value={sortKey.descending ? "descending" : "ascending"}
        disabled={disabled || field === undefined}
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
      {problem === undefined ? null : (
        <FieldError id={errorId}>{problem}</FieldError>
      )}
    </li>
  );
}

/** The menu of fields a new sort key can order by. */
function AddSortButton({
  fields,
  disabled,
  onPick,
}: {
  fields: readonly LoopListField[];
  disabled: boolean;
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
          disabled={disabled || fields.length === 0}
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
  onSort,
}: {
  id: string;
  query: ListQuery;
  node: BlockNode;
  fields: readonly LoopListField[];
  fieldSource: ListFieldSource | undefined;
  disabled: boolean;
  problems: readonly string[];
  onSort: (keys: readonly ListSortKey[]) => void;
}): React.JSX.Element {
  const keys = query.sort;
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
    <section className="nx-list-query__group" aria-labelledby={titleId}>
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
                onField={field =>
                  onSort(
                    keys.map((each, at) =>
                      at === index
                        ? { field: field.name, descending: each.descending }
                        : each
                    )
                  )
                }
                onDirection={descending =>
                  onSort(
                    keys.map((each, at) =>
                      at === index ? { ...each, descending } : each
                    )
                  )
                }
                onMove={to => {
                  if (to < 0 || to >= keys.length) return;
                  onSort(movedKey(keys, index, to));
                }}
                onRemove={() => onSort(keys.filter((_, at) => at !== index))}
                onDragStart={startDrag(original)}
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
        disabled={disabled}
        onPick={field =>
          onSort([
            ...keys,
            { field: field.name, descending: firstDirection(field.kind) },
          ])
        }
      />
      {shown.length === 0 ? null : (
        <p className="nx-inspector__note nx-list-query__hint">
          Entries with the same values keep a fixed order. Entries with no value
          come last.
        </p>
      )}
    </section>
  );
}

/** A number of entries typed, written once a save would take it. */
function BoundField({
  id,
  prop,
  label,
  suffix,
  stored,
  disabled,
  problem: storedProblem,
  onBound,
}: {
  id: string;
  prop: "limit" | "offset";
  label: string;
  suffix?: string;
  stored: unknown;
  disabled: boolean;
  problem: string | undefined;
  onBound: (value: number | undefined) => void;
}): React.JSX.Element {
  const text =
    typeof stored === "number" || typeof stored === "string"
      ? String(stored)
      : "";
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
    if (read.value !== stored) onBound(read.value);
  };
  const shown = problem ?? storedProblem;
  const errorId = `${id}-error`;
  return (
    <div className="nx-inspector__field" data-content-control="number">
      <Label htmlFor={id}>{label}</Label>
      <div
        className="nx-list-query__bound"
        data-suffixed={suffix === undefined ? undefined : ""}
      >
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={prop === "limit" ? 1 : 0}
          max={prop === "limit" ? 100 : undefined}
          value={draft}
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
        {suffix === undefined ? null : (
          <span className="nx-list-query__suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {shown === undefined ? null : (
        <FieldError id={errorId}>{shown}</FieldError>
      )}
    </div>
  );
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
}: ListQueryFieldProps): React.JSX.Element {
  const id = React.useId();
  const values = React.useMemo(
    () => Object.fromEntries(props.map(prop => [prop.name, prop.value])),
    [props]
  );
  const { query } = readListQuery(values);
  const listed = useLoopCollections(services?.listLoopCollections);
  const collections =
    listed?.kind === "ready" ? listed.collections : ([] as const);
  const node = findNode(document.nodes, nodeId);
  const outerNode = outerList(document, nodeId);
  const outer =
    outerNode === undefined ? undefined : readListQuery(outerNode.props).query;
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
      }).filter(issue => issue.nodeId === nodeId && issue.severity === "error"),
    [document, nodeId, fieldSource, entryCollection]
  );
  const related = relatedSources(collections, entryCollection, outer);
  const current = collections.find(each => each.slug === query.collection);
  const fields = current?.fields ?? [];
  const held = LIST_QUERY_PROPS.some(
    name => props.some(prop => prop.name === name) && !writable(name)
  );
  const commit = (changes: Readonly<Record<string, unknown>>) => {
    onCommitMany(changes);
  };
  const relatedShown =
    query.relation === undefined
      ? undefined
      : [...related.entry, ...related.item].find(
          each =>
            each.of === query.relation?.of &&
            each.field === query.relation.field
        )?.words;
  const canvasId = `${id}-canvas`;
  if (node === undefined) return <></>;
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
          collections={collections}
          related={related}
          disabled={held}
          problems={issuesAt(issues, ["collection", "relation"])}
          onPick={pick => {
            const changes = sourceChanges(query, pick);
            const same =
              changes.collection === query.collection &&
              JSON.stringify(changes.relation) ===
                JSON.stringify(query.relation);
            if (!same) commit(changes);
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
        disabled={held || query.collection === undefined}
        problems={issues
          .filter(issue => issue.path.endsWith("/props/filters"))
          .filter(issue => issue.code === "list-filter-invalid")
          .map(issue => issue.message)}
        services={services}
        relatedWordsShown={relatedShown}
        onFilters={filters => commit({ filters })}
      />
      <SortGroup
        id={`${id}-sort`}
        query={query}
        node={node}
        fields={fields}
        fieldSource={fieldSource}
        disabled={held || query.collection === undefined}
        problems={issues
          .filter(issue => issue.path.endsWith("/props/sort"))
          .filter(issue => issue.code === "list-sort-invalid")
          .map(issue => issue.message)}
        onSort={keys => commit({ sort: sortValue(keys) })}
      />
      <section
        className="nx-list-query__group"
        aria-labelledby={`${id}-many-title`}
      >
        <GroupTitle id={`${id}-many-title`}>How many</GroupTitle>
        <BoundField
          id={`${id}-limit`}
          prop="limit"
          label="Number of items"
          stored={values.limit}
          disabled={held}
          problem={issuesAt(issues, ["limit"])[0]}
          onBound={limit => commit({ limit })}
        />
        <BoundField
          id={`${id}-offset`}
          prop="offset"
          label="Skip the first"
          suffix="entries"
          stored={values.offset}
          disabled={held}
          problem={issuesAt(issues, ["offset"])[0]}
          onBound={offset =>
            commit({ offset: offset === 0 ? undefined : offset })
          }
        />
      </section>
      {onShowEmpty === undefined ? null : (
        <section
          className="nx-list-query__group"
          aria-labelledby={`${id}-empty-title`}
        >
          <GroupTitle id={`${id}-empty-title`}>When nothing matches</GroupTitle>
          <div
            className="nx-inspector__field"
            data-content-control="canvasShows"
          >
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
      )}
    </div>
  );
}
