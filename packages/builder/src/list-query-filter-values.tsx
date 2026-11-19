"use client";

/**
 * A collection list's filter values: the control each field's kind is given
 * (typed, yes or no, choices, entries), and the titles of the entries a
 * filter names.
 *
 * @module list-query-filter-values
 */
import type { ListFilterOp } from "@nextlyhq/blocks-engine";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { X } from "lucide-react";
import * as React from "react";

import {
  SegmentedChoice,
  type ContentServices,
  type LoopListField,
} from "./content-controls";
import { takesList, type DraftFilter } from "./list-query-model";
import { RelationControl } from "./relation-control";
import { useStoredDraft } from "./stored-draft";

/** The titles of entries a filter names, read once each through the host. */
export function useEntryTitles(
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
  // The inspector's own draft: an edit in progress from the first
  // keystroke, which Save pressed from here writes first and Escape puts back.
  const [draft, setDraft] = useStoredDraft(stored);
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
  // A value being typed is an edit in progress over the empty field, as any
  // other field's draft is: Save pressed from here adds it first.
  const [draft, setDraft] = useStoredDraft("");
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
export interface ValueProps {
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
export function FilterValue(props: ValueProps): React.JSX.Element | null {
  if (props.draft.op === "exists") return null;
  const Control = VALUE_CONTROLS[props.field.kind];
  return <Control {...props} />;
}
