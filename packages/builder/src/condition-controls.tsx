"use client";

/**
 * "Show when": a block's visibility conditions, in the Content tab under
 * "Visible on". One AND group, edited as the list's filters are: one
 * sentence per condition, opening in place into its field, operator and
 * value. Only fields visitors can see are offered, since whether a block
 * shows would otherwise reveal the field.
 *
 * A block in a list's per-entry slot reads the list's item; every other
 * block reads the entry the page shows. Groups set through the API, which
 * this edits only one of, are shown read-only, with a way to keep the first.
 *
 * @module condition-controls
 */
import {
  CONDITION_MAX,
  conditionIssues,
  conditionOp,
  findNode,
  outerListOf,
  readListQuery,
  type BindingFieldShape,
  type BlockNode,
  type Condition,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { AlertCircle, FileText, Plus, Repeat } from "lucide-react";
import * as React from "react";

import { LoopPicker, useLoopCollections } from "./collection-loop-controls";
import {
  asListField,
  booleanValueOf,
  choiceKey,
  completedCondition,
  conditionChoices,
  conditionFieldsOf,
  conditionFieldsOfShapes,
  conditionLine,
  conditionSentence,
  valueOpFor,
  type ConditionField,
  type DraftCondition,
} from "./condition-model";
import { storedGroups } from "./condition-checks";
import { conditionsOp } from "./condition-ops";
import type {
  ContentServices,
  LoopCollection,
  LoopListField,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import {
  fieldList,
  fieldSourceOf,
  FilterValue,
  LimitNote,
  listLimit,
  PUBLIC_ONLY,
  useCustomSources,
  useEntryTitles,
} from "./list-query-controls";
import { customSourceLookup, type CustomSource } from "./named-query-model";
import {
  SentenceRow,
  useSentenceRows,
  type SentenceRows,
  type ShownRow,
} from "./sentence-row";

export interface ShowWhenProps {
  readonly editor: EditorState;
  readonly nodeId: string;
  readonly services: ContentServices | undefined;
  /** Why a lock holds the block's design, which includes where it shows. */
  readonly heldBy?: string | undefined;
  /** The id of the element saying why, which held controls point to. */
  readonly reasonId?: string;
}

/** Whose fields a block's conditions read, and how the group names it. */
interface ConditionSource {
  /** The collection read, or `null` for a page with no entry. */
  readonly collection: string | null | undefined;
  /** "This post", "Each post in the list". */
  readonly words: string;
  /** What the conditions must match: "this post", "each post in the list". */
  readonly match: string;
  readonly item: boolean;
  /**
   * The fields an item has where the list's source is a named query whose
   * rows are a schema of their own, which no collection holds.
   */
  readonly rowFields?: readonly BindingFieldShape[];
}

/** One entry's name in a sentence: "post", "page". */
function oneOf(found: LoopCollection | undefined): string {
  return (found?.singular ?? found?.label ?? "entry").toLowerCase();
}

/** Where the block's conditions read, as the save judges it. */
function sourceOf(
  node: BlockNode,
  nodes: BlockNode[],
  entryCollection: string | null | undefined,
  collections: readonly LoopCollection[],
  customs: readonly CustomSource[] | undefined
): ConditionSource {
  const outer = outerListOf(nodes, node.id);
  if (outer !== undefined) {
    const { query } = readListQuery(outer.props);
    // A custom source's items are its query's rows: entries of the
    // collection they name, or rows of the query's own fields.
    const rows =
      query.namedQuery === undefined
        ? undefined
        : customs?.find(
            each => each.declaration.name === query.namedQuery?.name
          )?.declaration.rows;
    const collection =
      rows === undefined
        ? query.collection
        : "collection" in rows
          ? rows.collection
          : undefined;
    const found = collections.find(each => each.slug === collection);
    return {
      collection,
      words: `Each ${oneOf(found)} in the list`,
      match: `each ${oneOf(found)} in the list`,
      item: true,
      ...(rows !== undefined && "fields" in rows
        ? { rowFields: rows.fields }
        : {}),
    };
  }
  if (entryCollection === null) {
    return {
      collection: null,
      words: "No entry here",
      match: "an entry",
      item: false,
    };
  }
  const found = collections.find(each => each.slug === entryCollection);
  return {
    collection: entryCollection,
    words: `This ${oneOf(found)}`,
    match: `this ${oneOf(found)}`,
    item: false,
  };
}

/** What the engine finds wrong with the block's conditions, as a save would. */
function problemsOf(
  editor: EditorState,
  nodeId: string,
  collections: readonly LoopCollection[] | undefined,
  entryCollection: string | null | undefined,
  customs: readonly CustomSource[] | undefined
): { rows: ReadonlyMap<number, string>; whole: readonly string[] } {
  const found = conditionIssues(editor.document.nodes, {
    ...(collections === undefined
      ? {}
      : { fields: fieldSourceOf(collections) }),
    ...(entryCollection === undefined ? {} : { entryCollection }),
    // A custom source's items judged by its query's rows, as the save does.
    ...(customs === undefined
      ? {}
      : { namedQueries: customSourceLookup(customs) }),
  }).filter(issue => issue.nodeId === nodeId && issue.severity === "error");
  const rows = new Map<number, string>();
  const whole: string[] = [];
  for (const issue of found) {
    // `/…/visibility/conditions/0/2` is the third condition of the group.
    const index = /\/visibility\/conditions\/0\/(\d+)$/.exec(issue.path)?.[1];
    if (index === undefined) whole.push(issue.message);
    else rows.set(Number(index), issue.message);
  }
  return { rows, whole };
}

/**
 * A stored condition as a row reads it, its operator in its canonical
 * spelling; an operator conditions do not have reads as not chosen, and the
 * engine's finding says why.
 */
function toDraft(condition: Condition): DraftCondition {
  const op = conditionOp(condition.op);
  // `equals` Yes and `not_equals` Yes hold exactly where "is Yes" and "is No"
  // do, so they read and edit as those; written only once the row changes.
  if (condition.value === true && (op === "equals" || op === "not_equals")) {
    return {
      field: condition.field,
      op: op === "equals" ? "is_true" : "is_false",
    };
  }
  return {
    field: condition.field,
    ...(op === undefined ? {} : { op }),
    ...(condition.value === undefined ? {} : { value: condition.value }),
  };
}

/** A condition row as it stands: what is stored, or the draft over it. */
type ShownCondition = ShownRow<DraftCondition>;

/** What a row is drawn with, closed or open. */
interface ConditionRowProps {
  readonly id: string;
  readonly row: ShownCondition;
  readonly fields: readonly ConditionField[];
  readonly open: boolean;
  readonly disabled: boolean;
  readonly storedProblem: string | undefined;
  readonly services: ContentServices | undefined;
  readonly entryTitle: (id: string) => string | undefined;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChange: (draft: DraftCondition) => void;
  readonly onRemove: () => void;
}

/** A row's field: picking one starts it on that field's first operator. */
function ConditionFieldPicker({
  id,
  labelId,
  props,
  field,
}: {
  id: string;
  labelId: string;
  props: ConditionRowProps;
  field: ConditionField | undefined;
}): React.JSX.Element {
  const { row, fields, disabled, onChange } = props;
  const name = row.draft.field;
  return (
    <LoopPicker
      id={id}
      labelId={labelId}
      value={
        name === undefined
          ? { words: "Choose a field", state: "prompt" }
          : field === undefined
            ? { words: `${name} (not offered here)`, state: "unknown" }
            : { words: field.label, state: "value" }
      }
      disabled={disabled}
      list={fieldList(fields, name ?? "", "Fields to check")}
      around={{ below: PUBLIC_ONLY }}
      defaultOpen={name === undefined}
      onPick={choice => {
        const first = conditionChoices(choice.field.kind)[0];
        if (choice.field.name === name || first === undefined) return;
        onChange({ field: choice.field.name, op: first.op });
      }}
    />
  );
}

/** A row's operator, from those its field's kind offers. */
function ConditionOperatorPicker({
  id,
  field,
  draft,
  disabled,
  onChange,
}: {
  id: string;
  field: ConditionField;
  draft: DraftCondition;
  disabled: boolean;
  onChange: (draft: DraftCondition) => void;
}): React.JSX.Element {
  const choices = conditionChoices(field.kind, draft.op);
  return (
    <Select
      value={draft.op === undefined ? "" : choiceKey(draft.op)}
      // A lone choice is still offered when the row holds another operator,
      // so a stored one the field doesn't take can be repaired here.
      disabled={
        disabled ||
        (choices.length === 1 &&
          draft.op !== undefined &&
          choices[0]?.key === choiceKey(draft.op))
      }
      onValueChange={key => {
        const choice = choices.find(each => each.key === key);
        if (choice === undefined) return;
        // The value carries over where the new operator compares one.
        onChange({ field: field.name, op: choice.op, value: draft.value });
      }}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={`How ${field.label} is compared`}
        className="nx-list-filter__op-pick"
        data-wide={
          draft.op !== undefined && valueOpFor(draft.op) === undefined
            ? ""
            : undefined
        }
      >
        <SelectValue placeholder="Compare" />
      </SelectTrigger>
      <SelectContent>
        {choices.map(choice => (
          <SelectItem key={choice.key} value={choice.key}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A condition's value, chosen with the list filter's control for it. */
function ConditionValue({
  props,
  field,
  labelId,
  errorId,
  problem,
}: {
  props: ConditionRowProps;
  field: ConditionField;
  labelId: string;
  errorId: string;
  problem: string | undefined;
}): React.JSX.Element | null {
  const { id, row, disabled } = props;
  const op = row.draft.op;
  const valueOp = op === undefined ? undefined : valueOpFor(op);
  // A field no list filters by takes no value: it is only asked if it has one.
  const listField = asListField(field);
  if (op === undefined || valueOp === undefined || listField === undefined) {
    return null;
  }
  return (
    <FilterValue
      id={`${id}-value`}
      labelledBy={labelId}
      field={listField}
      draft={{
        field: field.name,
        op: valueOp,
        value: booleanValueOf(op) ?? row.draft.value,
      }}
      disabled={disabled}
      invalid={problem !== undefined}
      describedBy={problem === undefined ? undefined : errorId}
      services={props.services}
      entryTitle={props.entryTitle}
      onValue={value =>
        props.onChange(
          // "is" stores Yes or No as its operator; a stored `equals` or
          // `not_equals` keeps its operator and takes the value.
          field.kind === "boolean" && op !== "equals" && op !== "not_equals"
            ? {
                field: field.name,
                op: value === false ? "is_false" : "is_true",
              }
            : { ...row.draft, value }
        )
      }
    />
  );
}

/** One condition: its sentence, opening in place into its controls. */
function ConditionRow(props: ConditionRowProps): React.JSX.Element {
  const { id, row, fields, storedProblem, entryTitle, disabled } = props;
  const field = fields.find(each => each.name === row.draft.field);
  const sentence = conditionSentence(row.draft, field, entryTitle);
  const completed = completedCondition(row.draft, field);
  const missing =
    row.draft.field !== undefined && "missing" in completed
      ? completed.missing
      : undefined;
  const problem = storedProblem ?? missing;
  return (
    <SentenceRow
      id={id}
      noun="condition"
      open={props.open}
      disabled={disabled}
      sentence={sentence}
      line={conditionLine(sentence)}
      problem={problem}
      field={labelId => (
        <ConditionFieldPicker
          id={`${id}-field`}
          labelId={labelId}
          props={props}
          field={field}
        />
      )}
      body={(labelId, errorId) =>
        field === undefined ? null : (
          <div className="nx-list-filter__body">
            <ConditionOperatorPicker
              id={`${id}-op`}
              field={field}
              draft={row.draft}
              disabled={disabled}
              onChange={props.onChange}
            />
            <ConditionValue
              props={props}
              field={field}
              labelId={labelId}
              errorId={errorId}
              problem={problem}
            />
          </div>
        )
      }
      onOpen={props.onOpen}
      onClose={props.onClose}
      onRemove={props.onRemove}
    />
  );
}

/** Groups set through the API: shown as they read, with a way to keep one. */
function StoredGroups({
  groups,
  fields,
  disabled,
  entryTitle,
  onKeepFirst,
}: {
  groups: readonly (readonly Condition[])[];
  fields: readonly ConditionField[];
  disabled: boolean;
  entryTitle: (id: string) => string | undefined;
  onKeepFirst: () => void;
}): React.JSX.Element {
  return (
    <>
      <p className="nx-inspector__note nx-list-query__hint">
        Shown when any of these groups match. They were set through the API.
      </p>
      <div className="nx-show-when__groups">
        {groups.map((group, index) => (
          <React.Fragment key={index}>
            {index === 0 ? null : <span className="nx-show-when__or">or</span>}
            <div className="nx-show-when__group">
              {group.map((condition, at) => {
                // Related entries by their titles, as an open row names them,
                // so two groups on different entries read apart.
                const sentence = conditionSentence(
                  toDraft(condition),
                  fields.find(each => each.name === condition.field),
                  entryTitle
                );
                return (
                  <span key={at} className="nx-show-when__line">
                    <span className="nx-list-filter__field">
                      {sentence.field}
                    </span>{" "}
                    <span className="nx-list-filter__op">
                      {sentence.operator}
                    </span>{" "}
                    {sentence.value}
                  </span>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="nx-show-when__keep"
        disabled={disabled}
        onClick={onKeepFirst}
      >
        Edit as one group
      </Button>
      <p className="nx-inspector__hint">
        Editing here keeps the first group and removes the others. Undo brings
        them back.
      </p>
    </>
  );
}

/** What the engine found wrong, shown once over the whole group. */
type ConditionProblems = ReturnType<typeof problemsOf>;

/** Why visitors never see the block, when a condition can't be checked. */
function ShowWhenNotice({
  problems,
  unreadable,
}: {
  problems: ConditionProblems;
  /** Conditions stored in a shape no row can show, which the page leaves out. */
  unreadable: boolean;
}): React.JSX.Element | null {
  if (!unreadable && problems.whole.length === 0 && problems.rows.size === 0) {
    return null;
  }
  return (
    <div className="nx-show-when__notice" role="alert">
      <AlertCircle aria-hidden="true" size={14} />
      <p>
        <strong>Visitors never see this block.</strong>{" "}
        {noticeWords(problems, unreadable)}
      </p>
    </div>
  );
}

/** Why the page leaves the block out, in the notice's words. */
function noticeWords(problems: ConditionProblems, unreadable: boolean): string {
  // A shape the condition reader leaves to the format check, which the
  // engine's own findings therefore don't cover; the page still leaves the
  // block out, so the notice says so.
  if (unreadable) {
    return "Its conditions can’t be read, so the page leaves it out until they’re removed.";
  }
  return problems.whole.length > 0
    ? problems.whole.join(" ")
    : "A condition can’t be checked, so the page leaves it out until it’s fixed.";
}

/**
 * Said when the site's collections couldn't be listed: no field can be
 * offered, and a stored condition's field can't be named, for that reason
 * rather than any wrong with the conditions.
 */
function FieldsUnavailable({
  listing,
}: {
  listing: ConditionListing;
}): React.JSX.Element | null {
  if (listing !== "unavailable") return null;
  return (
    <p className="nx-inspector__note">
      The site&apos;s collections could not be listed, so conditions can&apos;t
      be chosen here.
    </p>
  );
}

/** How the group's edits reach the document: written once a row completes. */
interface ConditionWrites {
  readonly write: (next: readonly Condition[]) => void;
  readonly change: (row: ShownCondition, draft: DraftCondition) => void;
  readonly remove: (row: ShownCondition) => void;
}

/** The writes of the one AND group the inspector edits. */
function conditionWrites(
  editor: EditorState,
  nodeId: string,
  stored: readonly Condition[],
  state: SentenceRows<DraftCondition>,
  fields: readonly ConditionField[]
): ConditionWrites {
  const write = (next: readonly Condition[]) => {
    // Stored in the operators' canonical spellings, as the API writes them.
    const canonical = next.map(each => ({
      ...each,
      op: conditionOp(each.op) ?? each.op,
    }));
    const op = conditionsOp(
      editor.document,
      nodeId,
      canonical.length === 0 ? null : [canonical]
    );
    if (op !== null) editor.apply(op);
  };
  const change = (row: ShownCondition, draft: DraftCondition) => {
    const field = fields.find(each => each.name === draft.field);
    const completed = completedCondition(draft, field);
    // Written once complete, and a stored row from there on.
    const index = state.change(row, draft, "condition" in completed);
    if ("condition" in completed) {
      const next = [...stored];
      next[index] = completed.condition;
      write(next);
    }
  };
  const remove = (row: ShownCondition) => {
    const index = state.remove(row);
    if (index !== undefined) write(stored.filter((_, at) => at !== index));
  };
  return { write, change, remove };
}

/** What the one editable group is drawn with. */
interface OneGroupProps {
  readonly id: string;
  readonly state: SentenceRows<DraftCondition>;
  readonly writes: ConditionWrites;
  readonly source: ConditionSource;
  readonly fields: readonly ConditionField[];
  readonly problems: ConditionProblems;
  readonly disabled: boolean;
  readonly services: ContentServices | undefined;
  readonly entryTitle: (id: string) => string | undefined;
}

/** The one AND group, a sentence per condition, and the way to add one. */
function OneGroup({
  id,
  state,
  writes,
  source,
  fields,
  problems,
  disabled,
  services,
  entryTitle,
}: OneGroupProps): React.JSX.Element {
  // As many as the save takes, so a written row is never one too many.
  const limit = listLimit(state.rows.length, CONDITION_MAX, id);
  return (
    <>
      <p className="nx-inspector__note nx-list-query__hint">
        {state.rows.length === 0
          ? "Always shown."
          : `Show this block only when all of these match ${source.match}.`}
      </p>
      {state.rows.length === 0 ? null : (
        <ul className="nx-list-query__filters" aria-label="Conditions">
          {state.rows.map(row => (
            <ConditionRow
              key={row.key}
              id={`${id}-${row.key.replace(":", "-")}`}
              row={row}
              fields={fields}
              open={state.openKey === row.key}
              disabled={disabled}
              // A draft is judged when it is written, not by the stored row.
              storedProblem={
                row.index === undefined || row.drafted
                  ? undefined
                  : problems.rows.get(row.index)
              }
              services={services}
              entryTitle={entryTitle}
              onOpen={() => state.setOpenKey(row.key)}
              onClose={() => state.setOpenKey(null)}
              onChange={draft => writes.change(row, draft)}
              onRemove={() => writes.remove(row)}
            />
          ))}
        </ul>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-list-query__add"
        disabled={
          disabled ||
          source.collection === null ||
          fields.length === 0 ||
          limit.full
        }
        aria-describedby={limit.describedBy}
        onClick={state.add}
      >
        <Plus aria-hidden="true" size={14} />
        Add condition
      </Button>
      <LimitNote limit={limit}>Up to {CONDITION_MAX} conditions.</LimitNote>
    </>
  );
}

/**
 * Conditions stored in a shape no row can show. The notice above says the
 * page leaves the block out; removing them is the way back to editing.
 */
function UnreadableConditions({
  disabled,
  onRemove,
}: {
  disabled: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <>
      <p className="nx-inspector__note nx-list-query__hint">
        These conditions aren’t stored as groups of conditions, so they can’t be
        shown here. Remove them to set new ones.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="nx-show-when__keep"
        disabled={disabled}
        onClick={onRemove}
      >
        Remove conditions
      </Button>
    </>
  );
}

/** The group's body, by what is stored: unreadable, several groups, or one. */
function GroupBody({
  groups,
  stored,
  ...one
}: OneGroupProps & {
  groups: readonly (readonly Condition[])[] | undefined;
  stored: readonly Condition[];
}): React.JSX.Element {
  if (groups === undefined) {
    return (
      <UnreadableConditions
        disabled={one.disabled}
        onRemove={() => one.writes.write([])}
      />
    );
  }
  if (groups.length > 1) {
    return (
      <StoredGroups
        groups={groups}
        fields={one.fields}
        disabled={one.disabled}
        entryTitle={one.entryTitle}
        onKeepFirst={() => one.writes.write(stored)}
      />
    );
  }
  return <OneGroup {...one} />;
}

/** The collections the inspector knows, and where the block's conditions read. */
/** Whether the site's collections, and so the fields, have been listed. */
type ConditionListing = "loading" | "ready" | "unavailable";

function useConditionSource(
  editor: EditorState,
  node: BlockNode | undefined,
  services: ContentServices | undefined
): {
  listing: ConditionListing;
  collections: readonly LoopCollection[] | undefined;
  customs: readonly CustomSource[] | undefined;
  source: ConditionSource | undefined;
  fields: readonly ConditionField[];
  listFields: readonly LoopListField[];
} {
  const listed = useLoopCollections(services?.listLoopCollections);
  const collections = listed?.kind === "ready" ? listed.collections : undefined;
  const customs = useCustomSources(services?.listCustomSources);
  const source =
    node === undefined
      ? undefined
      : sourceOf(
          node,
          editor.document.nodes,
          services?.entryCollection,
          collections ?? [],
          customs
        );
  const collection = collections?.find(
    each => each.slug === source?.collection
  );
  // Every field the public may read, not only those a list filters by: a
  // condition can ask whether any of them has a value.
  const rowFields = source?.rowFields;
  const fields = React.useMemo(
    () =>
      rowFields !== undefined
        ? conditionFieldsOfShapes(rowFields)
        : collection === undefined
          ? []
          : conditionFieldsOf(collection),
    [collection, rowFields]
  );
  const listing: ConditionListing =
    listed === undefined || listed.kind === "failed"
      ? "unavailable"
      : listed.kind;
  return {
    listing,
    collections,
    customs,
    source,
    fields,
    listFields: collection?.fields ?? [],
  };
}

/** The "Show when" group of a block's Content tab. */
export function ShowWhen({
  editor,
  nodeId,
  services,
  heldBy,
  reasonId,
}: ShowWhenProps): React.JSX.Element | null {
  const id = React.useId();
  const node = findNode(editor.document.nodes, nodeId);
  const { listing, collections, customs, source, fields, listFields } =
    useConditionSource(editor, node, services);
  const groups = node === undefined ? [] : storedGroups(node);
  const stored = groups?.[0] ?? [];
  const state = useSentenceRows<Condition, DraftCondition>(stored, toDraft, {});
  // Every condition shown: the rows being edited, or each API group's.
  const shownConditions =
    groups !== undefined && groups.length > 1
      ? groups.flat().map(each => ({ field: each.field, value: each.value }))
      : state.rows.map(row => ({
          field: row.draft.field,
          value: row.draft.value,
        }));
  const entryTitle = useEntryTitles(
    services?.findEntries,
    listFields,
    shownConditions
  );
  if (source === undefined) return null;

  const disabled = heldBy !== undefined;
  const problems = problemsOf(
    editor,
    nodeId,
    collections,
    services?.entryCollection,
    customs
  );
  const writes = conditionWrites(editor, nodeId, stored, state, fields);
  const titleId = `${id}-title`;
  const SourceIcon = source.item ? Repeat : FileText;
  return (
    <section
      className="nx-list-query__group nx-show-when"
      aria-labelledby={titleId}
      {...(disabled && reasonId !== undefined
        ? { "aria-describedby": reasonId }
        : {})}
    >
      <div className="nx-show-when__head">
        <h3 id={titleId} className="nx-list-query__title">
          Show when
        </h3>
        <span className="nx-show-when__source">
          <SourceIcon aria-hidden="true" size={12} />
          {source.words}
        </span>
      </div>
      <ShowWhenNotice problems={problems} unreadable={groups === undefined} />
      <FieldsUnavailable listing={listing} />
      <GroupBody
        groups={groups}
        stored={stored}
        id={id}
        state={state}
        writes={writes}
        source={source}
        fields={fields}
        problems={problems}
        disabled={disabled}
        services={services}
        entryTitle={entryTitle}
      />
    </section>
  );
}
