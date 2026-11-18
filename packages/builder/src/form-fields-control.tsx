"use client";

/**
 * A Form's Fields, as the author edits them: one row per field, named by its
 * label and type, dragged by its handle into a new order, opened to edit it,
 * and "+ Add field" below.
 *
 * Open, a field shows its label, its type, Required, a Dropdown's or a
 * Choice's options, and under Advanced the name its answer is sent under,
 * which is made from its label until the author writes one (the block's own
 * `sentNameOf`, so the name shown is the name sent).
 *
 * Every change writes the whole list once, as one step to undo. Text commits
 * on blur, as every inspector field does. The handle moves a field with the
 * arrow keys too, so the order is reachable without a pointer.
 *
 * @module form-fields-control
 */
import { FORM_MAX_FIELDS, formFields } from "@nextlyhq/blocks-react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import { ChevronDown, GripVertical, Trash2, X } from "lucide-react";
import * as React from "react";

import { useStoredDraft } from "./stored-draft";

/** One field as stored, as this control reads and writes it. */
export interface FormFieldSpec {
  label?: string;
  name?: string;
  type?: string;
  required?: boolean;
  options?: string[];
}

/** A field type the block offers, and the words it is offered under. */
export interface FieldTypeChoice {
  readonly value: string;
  readonly words: string;
}

/** The types that take a list of options. */
const CHOICE_TYPES: ReadonlySet<string> = new Set(["select", "radio"]);

/** Text, or `undefined` for anything else. */
function textOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A stored list member as a field, every setting this control reads checked:
 * a stored array can hold anything, and a label that is not text must not
 * stop the Fields from being drawn.
 */
function asSpec(value: unknown): FormFieldSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const field: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  // A setting of a shape this control cannot read is left out of the field
  // it draws, and so out of what it writes back.
  for (const key of ["label", "name", "type"]) {
    if (field[key] !== undefined && textOr(field[key]) === undefined) {
      delete field[key];
    }
  }
  if (field.options !== undefined) {
    if (Array.isArray(field.options)) {
      field.options = field.options.filter(
        (option): option is string => typeof option === "string"
      );
    } else {
      delete field.options;
    }
  }
  return field;
}

/**
 * Where the open field is once the field at `from` moves to `to`: with it,
 * where it is the one moved, and one place along where the move crosses it.
 */
export function openAfterMove(
  open: number | null,
  from: number,
  to: number
): number | null {
  if (open === null) return null;
  if (open === from) return to;
  if (from < open && open <= to) return open - 1;
  if (to <= open && open < from) return open + 1;
  return open;
}

/** `list` with the member at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [taken] = next.splice(from, 1);
  if (taken === undefined) return [...list];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, taken);
  return next;
}

/** A text box that commits its draft on blur and on Enter. */
function DraftInput({
  id,
  value,
  placeholder,
  disabled,
  label,
  onCommit,
}: {
  id: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  /** Its accessible name, where no visible label names it. */
  label?: string;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(value);
  const send = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      value={draft}
      disabled={disabled}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(label === undefined ? {} : { "aria-label": label })}
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

/** A Dropdown's or a Choice's options: one box each, removable, and "+ Add option". */
function OptionsEditor({
  id,
  options,
  disabled,
  onChange,
}: {
  id: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  return (
    <div
      className="nx-form-fields__options"
      role="group"
      aria-labelledby={`${id}-label`}
    >
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        Options
      </p>
      {options.map((option, index) => (
        <div key={index} className="nx-form-fields__option">
          <DraftInput
            id={`${id}-${index}`}
            value={option}
            disabled={disabled}
            label={`Option ${index + 1}`}
            onCommit={next =>
              onChange(options.map((each, at) => (at === index ? next : each)))
            }
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove option ${index + 1}`}
            onClick={() => onChange(options.filter((_, at) => at !== index))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-form-fields__add"
        disabled={disabled}
        onClick={() => onChange([...options, `Option ${options.length + 1}`])}
      >
        + Add option
      </Button>
    </div>
  );
}

/** One field opened: its label, type, Required, options and sent name. */
function FieldEditor({
  id,
  field,
  sentName,
  types,
  disabled,
  onChange,
}: {
  id: string;
  field: FormFieldSpec;
  types: readonly FieldTypeChoice[];
  /** The name its answer is sent under now, made or written. */
  sentName: string;
  disabled: boolean;
  onChange: (next: FormFieldSpec) => void;
}): React.JSX.Element {
  const type = field.type ?? "text";
  const set = (patch: Partial<FormFieldSpec>) => {
    const next: Record<string, unknown> = { ...field, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") delete next[key];
    }
    onChange(next);
  };
  return (
    <div className="nx-form-fields__editor">
      <div className="nx-inspector__field">
        <Label htmlFor={`${id}-label`}>Label</Label>
        <DraftInput
          id={`${id}-label`}
          value={field.label ?? ""}
          disabled={disabled}
          onCommit={label => set({ label })}
        />
      </div>
      <div className="nx-inspector__field">
        <Label htmlFor={`${id}-type`}>Field type</Label>
        <Select
          value={type}
          disabled={disabled}
          onValueChange={next =>
            set({
              type: next,
              // A new Dropdown or Choice starts with options to edit.
              ...(CHOICE_TYPES.has(next) && (field.options ?? []).length === 0
                ? { options: ["Option 1", "Option 2"] }
                : {}),
            })
          }
        >
          <SelectTrigger id={`${id}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.words}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="nx-inspector__field">
        <Label htmlFor={`${id}-required`}>Required</Label>
        <Switch
          id={`${id}-required`}
          checked={field.required === true}
          disabled={disabled}
          onCheckedChange={required => set({ required: required || undefined })}
        />
      </div>
      {CHOICE_TYPES.has(type) ? (
        <OptionsEditor
          id={`${id}-options`}
          options={field.options ?? []}
          disabled={disabled}
          onChange={options => set({ options })}
        />
      ) : null}
      <details className="nx-form-fields__advanced">
        <summary>
          <ChevronDown aria-hidden="true" />
          Advanced
        </summary>
        <div className="nx-inspector__field nx-inspector__field--stacked">
          <Label htmlFor={`${id}-name`}>Name sent with the form</Label>
          <DraftInput
            id={`${id}-name`}
            value={field.name ?? ""}
            placeholder={sentName}
            disabled={disabled}
            onCommit={name => set({ name: name.trim() })}
          />
          <p className="nx-inspector__note">
            {field.name !== undefined &&
            field.name !== "" &&
            field.name !== sentName
              ? `Sent as ${sentName}.`
              : "Made from the label. Each field's name is its own."}
          </p>
        </div>
      </details>
    </div>
  );
}

/**
 * The Fields list. `value` is the block's stored `fields`; `onCommit` writes
 * the whole list.
 */
export function FormFieldsControl({
  id,
  value,
  types,
  disabled,
  onCommit,
}: {
  id: string;
  value: unknown;
  /** The field types the block offers, read from its declaration. */
  types: readonly FieldTypeChoice[];
  disabled: boolean;
  onCommit: (next: FormFieldSpec[]) => void;
}): React.JSX.Element {
  const list = React.useMemo(
    () => (Array.isArray(value) ? value.map(asSpec) : []),
    [value]
  );
  // The names each field's answer is sent under, as the block sends them.
  const names = React.useMemo(
    () => formFields({ fields: list }).map(field => field.name),
    [list]
  );
  const [open, setOpen] = React.useState<number | null>(null);
  const [dragged, setDragged] = React.useState<number | null>(null);
  const [said, setSaid] = React.useState("");
  const grips = React.useRef<Array<HTMLButtonElement | null>>([]);

  const titleOf = (field: FormFieldSpec, index: number): string =>
    (field.label ?? "").trim() || names[index] || `Field ${index + 1}`;

  const move = (from: number, to: number, focus: boolean) => {
    if (to < 0 || to >= list.length || from === to) return;
    const field = list[from];
    onCommit(moved(list, from, to));
    setOpen(current => openAfterMove(current, from, to));
    setSaid(
      `${titleOf(field ?? {}, from)} moved to position ${to + 1} of ${list.length}.`
    );
    if (focus) requestAnimationFrame(() => grips.current[to]?.focus());
  };

  return (
    <div className="nx-form-fields" data-content-control="form-fields">
      <ol className="nx-form-fields__rows" aria-label="Fields">
        {list.map((field, index) => {
          const title = titleOf(field, index);
          const isOpen = open === index;
          const type =
            types.find(choice => choice.value === (field.type ?? "text"))
              ?.words ?? "Text";
          return (
            <li
              // Positions identify a field: a list holds no ids.
              key={index}
              className="nx-form-fields__row"
              data-open={isOpen ? "" : undefined}
              data-dragged={dragged === index ? "" : undefined}
              onDragOver={event => {
                if (dragged === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={event => {
                event.preventDefault();
                if (dragged !== null) move(dragged, index, false);
                setDragged(null);
              }}
            >
              <div className="nx-form-fields__head">
                <button
                  ref={element => {
                    grips.current[index] = element;
                  }}
                  type="button"
                  className="nx-form-fields__grip"
                  draggable={!disabled}
                  disabled={disabled}
                  aria-label={`Move ${title}`}
                  aria-describedby={`${id}-grip-help`}
                  onDragStart={event => {
                    setDragged(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragEnd={() => setDragged(null)}
                  onKeyDown={event => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      move(index, index - 1, true);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      move(index, index + 1, true);
                    }
                  }}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="nx-form-fields__title"
                  aria-expanded={isOpen}
                  aria-controls={`${id}-${index}-editor`}
                  onClick={() => setOpen(isOpen ? null : index)}
                >
                  <span className="nx-form-fields__label">
                    {title}
                    {field.required === true ? (
                      <>
                        <span aria-hidden="true"> *</span>
                        <span className="nx-sr-only">, required</span>
                      </>
                    ) : null}
                  </span>
                  <span className="nx-form-fields__type">{type}</span>
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Remove ${title}`}
                  onClick={() => {
                    onCommit(list.filter((_, at) => at !== index));
                    setOpen(null);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {isOpen ? (
                <div id={`${id}-${index}-editor`}>
                  <FieldEditor
                    id={`${id}-${index}`}
                    field={field}
                    sentName={names[index] ?? ""}
                    types={types}
                    disabled={disabled}
                    onChange={next =>
                      onCommit(
                        list.map((each, at) => (at === index ? next : each))
                      )
                    }
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="nx-sr-only" id={`${id}-grip-help`}>
        Drag to reorder, or press the up and down arrow keys.
      </p>
      <p className="nx-sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-form-fields__add"
        // No field past the most a form draws.
        disabled={disabled || list.length >= FORM_MAX_FIELDS}
        onClick={() => {
          onCommit([...list, { label: "New field", type: "text" }]);
          setOpen(list.length);
        }}
      >
        + Add field
      </Button>
    </div>
  );
}
