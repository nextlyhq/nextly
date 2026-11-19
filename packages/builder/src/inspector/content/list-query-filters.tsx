"use client";

/**
 * A collection list's Filters: the menu of fields a filter or sort may name,
 * each filter row with its field, operator and value, the group that holds
 * them, and the note when a list holds as many rows as it may.
 *
 * @module list-query-filters
 */
import {
  LIST_MAX_FILTERS,
  type BlockNode,
  type ListFieldSource,
  type ListFilter,
  type ListQuery,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import type { ListedChoice } from "../../choice-list";

import { LoopPicker, type PickerList } from "./collection-loop-controls";
import type { ContentServices, LoopListField } from "./content-controls";
import { FilterValue, useEntryTitles } from "./list-query-filter-values";
import {
  completedFilter,
  filterLine,
  filterSentence,
  operatorOf,
  OPERATORS,
  valueFor,
  withFilter,
  type DraftFilter,
  type FilterSentence,
} from "./list-query-model";
import { FieldError, GroupTitle } from "./list-query-parts";
import { partIssues } from "./list-query-reading";
import {
  SentenceRow,
  useSentenceRows,
  type ShownRow as ShownSentenceRow,
} from "./sentence-row";

/**
 * A field a menu offers: one a list filters by, or one a condition can only
 * ask has a value, which names its own kind.
 */
export interface OfferedField {
  readonly name: string;
  readonly label: string;
  readonly kind: LoopListField["kind"] | "other";
  /** What the menu calls its kind, for a field of kind `other`. */
  readonly kindWords?: string;
}

/** One field of the field menu, with its kind on the right. */
export interface FieldChoice<F extends OfferedField = LoopListField>
  extends ListedChoice {
  readonly field: F;
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
export function fieldRow(choice: FieldChoice<OfferedField>): React.ReactNode {
  const { kind, kindWords } = choice.field;
  return (
    <span className="nx-list-query__field-row">
      <span>{choice.label}</span>
      <span className="nx-list-query__field-kind">
        {kindWords ?? (kind === "other" ? "" : KIND_WORDS[kind])}
      </span>
    </span>
  );
}

/** A field menu's list: the fields, each with its kind on the right. */
export function fieldList<F extends OfferedField>(
  fields: readonly F[],
  currentKey: string,
  label: string
): PickerList<FieldChoice<F>> {
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
export const PUBLIC_ONLY: React.JSX.Element = (
  <p className="nx-list-query__menu-foot">
    Only fields visitors can see are listed.
  </p>
);

/** A filter row as it stands: what is stored, or the draft over it. */
type ShownRow = ShownSentenceRow<DraftFilter>;

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

/** One filter: its sentence, opening in place into its controls. */
function FilterRow(props: FilterRowProps): React.JSX.Element {
  const { id, row, disabled } = props;
  const { field, sentence, line, problem } = readRow(props);
  const op = row.draft.op;
  return (
    <SentenceRow
      id={id}
      noun="filter"
      open={props.open}
      disabled={disabled}
      sentence={sentence}
      line={line}
      problem={problem}
      field={labelId => (
        <FilterFieldPicker
          id={`${id}-field`}
          labelId={labelId}
          props={props}
          field={field}
        />
      )}
      body={(labelId, errorId) =>
        field === undefined ? null : (
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
        )
      }
      onOpen={props.onOpen}
      onClose={props.onClose}
      onRemove={props.onRemove}
    />
  );
}

/** The Filters group: one row per filter, and a way to add one. */
export function FiltersGroup({
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
  const editing = useSentenceRows<ListFilter, DraftFilter>(
    stored,
    filter => filter,
    {}
  );
  const { rows, openKey, setOpenKey } = editing;
  const entryTitle = useEntryTitles(
    services?.findEntries,
    fields,
    rows.map(row => row.draft)
  );
  const filterLimit = listLimit(rows.length, LIST_MAX_FILTERS, id);
  const change = (row: ShownRow, draft: DraftFilter) => {
    const field = fields.find(each => each.name === draft.field);
    const completed = completedFilter(draft, field);
    // Written once complete, and a stored row from there on; kept as a draft
    // until then, while the canvas keeps the last query.
    const index = editing.change(row, draft, "filter" in completed);
    if ("filter" in completed) {
      onFilters(withFilter(stored, index, completed.filter));
    }
  };
  const remove = (row: ShownRow) => {
    const index = editing.remove(row);
    if (index !== undefined) onFilters(withFilter(stored, index, undefined));
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
        onClick={editing.add}
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
export interface ListLimit {
  full: boolean;
  /** The note's id while the limit is reached, for the Add button to name. */
  describedBy: string | undefined;
  id: string;
}

/** The limit of `count` against `most`, its note under `${id}-limit`. */
export function listLimit(count: number, most: number, id: string): ListLimit {
  const full = count >= most;
  const noteId = `${id}-limit`;
  return { full, describedBy: full ? noteId : undefined, id: noteId };
}

/** Why an Add button is off: shown only once the list holds the most it takes. */
export function LimitNote({
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
