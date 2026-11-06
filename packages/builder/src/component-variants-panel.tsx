"use client";

/**
 * A component's variants, in its own view: define one, name it, give it
 * values, delete it.
 *
 * Draws what `component-variants` decides and decides nothing itself.
 *
 * **A variant opens where it is made.** Adding one names it "Variant 2" and
 * opens its values with the name selected, so the next keystroke renames it
 * and the fields it can preset are already in view.
 *
 * **A delete always asks first,** with the number of placements that chose
 * the variant: they keep its id and fall back to the component's defaults,
 * which is a change on pages the designer may not be looking at.
 *
 * A name or a text value commits on blur or Enter, as every inspector field
 * does: one rename is one undo step, not one per letter.
 *
 * @module component-variants-panel
 */
import {
  isUnsetOverride,
  variantOptions,
  type ComponentDocument,
  type ExposedProperty,
  type OverrideValue,
  type VariantOption,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { ChevronRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";

import { commitOnEnter } from "./commit-on-enter";
import { exposedFields } from "./component-fields";
import {
  addVariant,
  defaultValues,
  deleteSentence,
  deleteVariant,
  nextVariantName,
  renameVariant,
  resetVariantValue,
  setVariantValue,
  valuesSummary,
  type ComponentVariantsHost,
  type VariantEditContext,
  type VariantPreviewBinding,
  type VariantUse,
} from "./component-variants";
import type { EditorState } from "./editor-state";
import { useStoredDraft } from "./stored-draft";

/**
 * Every variant key this editing session has seen the component hold. A
 * variant deleted and added again must get a new key, since placements may
 * still hold the old one; the document forgets it the moment it is deleted.
 */
function useSeenKeys(component: ComponentDocument): readonly string[] {
  const seen = React.useRef(new Set<string>());
  const variants: unknown = component.variants;
  if (variants !== null && typeof variants === "object") {
    for (const key of Object.keys(variants)) seen.current.add(key);
  }
  return [...seen.current];
}

/**
 * What the host tells the variants section, handed down from the inspector
 * so the surface drawing the component's view need not carry it.
 */
export const ComponentVariantsContext: React.Context<
  ComponentVariantsHost | undefined
> = React.createContext<ComponentVariantsHost | undefined>(undefined);

/**
 * The variants section of a component's own view, under its exposed fields.
 *
 * @experimental Settles when the component editor ships.
 */
export function ComponentVariantsSection({
  editor,
  component,
}: {
  editor: EditorState;
  component: ComponentDocument;
}): React.JSX.Element {
  const host = React.useContext(ComponentVariantsContext);
  const taken = useSeenKeys(component);
  const context: VariantEditContext = { editor, component, taken };
  const options = variantOptions(component);
  const fields = exposedFields(component);
  const headingId = React.useId();
  // The variant whose values are open, held by the host where it previews
  // it on the canvas, and the one just added, whose name is selected so
  // typing renames it.
  const [open, setOpen] = useOpenVariant(host?.preview);
  const [fresh, setFresh] = React.useState<string | undefined>(undefined);
  const [deleting, setDeleting] = React.useState<VariantOption | null>(null);
  const [problem, setProblem] = React.useState<string | undefined>(undefined);

  const add = () => {
    const outcome = addVariant(context, nextVariantName(component));
    if (!outcome.applied) {
      setProblem(outcome.reason);
      return;
    }
    setProblem(undefined);
    setOpen(outcome.id);
    setFresh(outcome.id);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="nx-variants"
      data-component-variants=""
    >
      <div className="nx-variants__header">
        <h3 id={headingId} className="nx-inspector__heading">
          Variants
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length === 0}
          onClick={add}
        >
          <Plus size={14} aria-hidden="true" />
          Add variant
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="nx-inspector__note">
          Add a field first. A variant is a named set of values for the fields
          each use of the component can change.
        </p>
      ) : options.length === 0 ? (
        <p className="nx-inspector__note">
          No variants yet. A variant is a named set of field values, like
          “Featured” or “Compact”, that each use of the component can choose.
        </p>
      ) : null}
      {/*
        Listed whether or not any field is left: removing the last field keeps
        the emptied variants, and placements still offer them, so they stay
        here to be renamed or deleted.
      */}
      {options.length === 0 ? null : (
        <ul className="nx-variants__list">
          {options.map(option => (
            <VariantRow
              key={option.id}
              context={context}
              option={option}
              fields={fields}
              open={open === option.id}
              selectName={fresh === option.id}
              onToggle={() =>
                setOpen(open === option.id ? undefined : option.id)
              }
              onNameSelected={() => setFresh(undefined)}
              onDelete={() => setDeleting(option)}
            />
          ))}
        </ul>
      )}
      {problem === undefined ? null : (
        <p className="nx-variants__problem" role="alert">
          {problem}
        </p>
      )}
      {deleting === null ? null : (
        <DeleteVariantDialog
          context={context}
          option={deleting}
          host={host}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

/**
 * The open variant: the host's, where it previews it on the canvas, or the
 * section's own otherwise.
 */
function useOpenVariant(
  preview: VariantPreviewBinding | undefined
): [string | undefined, (id: string | undefined) => void] {
  const [own, setOwn] = React.useState<string | undefined>(undefined);
  return preview === undefined ? [own, setOwn] : [preview.open, preview.onOpen];
}

/**
 * One variant: its name, how much it presets, and its values when open.
 */
function VariantRow({
  context,
  option,
  fields,
  open,
  selectName,
  onToggle,
  onNameSelected,
  onDelete,
}: {
  context: VariantEditContext;
  option: VariantOption;
  fields: readonly ExposedProperty[];
  open: boolean;
  selectName: boolean;
  onToggle: () => void;
  onNameSelected: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  // Resolved once for the whole component while the values are open, not
  // once per field.
  const defaults = React.useMemo(
    () =>
      open ? defaultValues(context.component) : new Map<string, unknown>(),
    [open, context.component]
  );
  const valuesId = React.useId();
  const problemId = React.useId();
  const nameRef = React.useRef<HTMLInputElement>(null);
  // A refused rename's reason, said under the row.
  const [problem, setProblem] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!selectName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    onNameSelected();
  }, [selectName, onNameSelected]);

  return (
    <li
      className="nx-variants__item"
      data-variant-id={option.id}
      data-open={open ? "" : undefined}
    >
      <div className="nx-variants__main">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-variants__toggle"
          aria-expanded={open}
          aria-controls={valuesId}
          aria-label={`${open ? "Hide" : "Show"} the values of ${option.label}`}
          onClick={onToggle}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="nx-variants__chevron"
            data-open={open ? "" : undefined}
          />
        </Button>
        <VariantName
          context={context}
          option={option}
          inputRef={nameRef}
          problemId={problemId}
          problem={problem}
          onProblem={setProblem}
        />
        <span
          className="nx-variants__summary"
          data-empty={option.empty ? "" : undefined}
        >
          {valuesSummary(option)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete the variant ${option.label}`}
          title="Delete variant"
          onClick={onDelete}
        >
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      </div>
      {problem === undefined ? null : (
        <p id={problemId} className="nx-variants__problem" role="alert">
          {problem}
        </p>
      )}
      {open ? (
        <div id={valuesId} className="nx-variants__values">
          {fields.length === 0 ? (
            <p className="nx-inspector__note">
              This component has no fields, so this variant presets nothing.
            </p>
          ) : null}
          {fields.map(field => (
            <VariantValueRow
              key={`${option.id}:${field.id}`}
              context={context}
              option={option}
              field={field}
              fallback={defaults.get(field.id)}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** A variant's name, renamed in place. */
function VariantName({
  context,
  option,
  inputRef,
  problemId,
  problem,
  onProblem,
}: {
  context: VariantEditContext;
  option: VariantOption;
  inputRef: React.Ref<HTMLInputElement>;
  /** The id of the row's refusal sentence, which the input points to. */
  problemId: string;
  problem: string | undefined;
  onProblem: (reason: string | undefined) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(option.label);
  const send = () => {
    if (draft === option.label) return;
    const outcome = renameVariant(context, option.id, draft);
    if (outcome.applied) {
      onProblem(undefined);
      return;
    }
    // Back to the stored name, with the reason: a blank or taken name is
    // refused, and leaving it on screen would show a name the variant does not
    // have.
    setDraft(option.label);
    onProblem(outcome.reason);
  };
  return (
    <span className="nx-variants__name">
      <Input
        ref={inputRef}
        size="sm"
        className="nx-variants__name-input"
        value={draft}
        aria-label={`Name of the variant ${option.label}`}
        aria-describedby={problem === undefined ? undefined : problemId}
        onChange={event => setDraft(event.target.value)}
        onBlur={send}
        onKeyDown={event => {
          commitOnEnter(event, send);
        }}
      />
    </span>
  );
}

/**
 * What a variant presets for one field: the control, whether it is the
 * variant's value or the component's default, and the reset.
 */
function VariantValueRow({
  context,
  option,
  field,
  fallback,
}: {
  context: VariantEditContext;
  option: VariantOption;
  field: ExposedProperty;
  /** The component's own value, shown while the variant sets none. */
  fallback: unknown;
}): React.JSX.Element {
  const id = `${React.useId()}-${field.id}`;
  const set = Object.hasOwn(option.values, field.id);
  const value = set ? option.values[field.id] : fallback;
  const [problem, setProblem] = React.useState<string | undefined>(undefined);
  const commit = (next: OverrideValue) => {
    const outcome = setVariantValue(context, option.id, field.id, next);
    setProblem(outcome.applied ? undefined : outcome.reason);
  };
  const reset = () => {
    const outcome = resetVariantValue(context, option.id, field.id);
    setProblem(outcome.applied ? undefined : outcome.reason);
  };

  // The inspector's own row grid, the placement panel's: the label (and its
  // dot) in the label column, and the value with its Reset slot filling the
  // rest, so a variant's row lines up with a placement's.
  return (
    <div
      className="nx-inspector__field nx-variants__value"
      data-set={set ? "" : undefined}
    >
      <span className="nx-variants__value-label">
        {/* A dot in the component's hue marks a value this variant sets. */}
        {set ? (
          <span
            className="nx-variants__dot"
            role="img"
            aria-label="Set by this variant"
          />
        ) : null}
        <Label htmlFor={id}>{field.label}</Label>
      </span>
      <span className="nx-variants__value-cell">
        <VariantValueControl
          id={id}
          field={field}
          value={shownValue(field, value)}
          onCommit={commit}
        />
        {/* A fixed slot, empty when nothing is set, so values line up. */}
        <span className="nx-variants__reset-slot">
          {set ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="nx-variants__reset"
              aria-label={`Reset ${field.label} to the component’s default in ${option.label}`}
              title="Reset to the component’s value"
              onClick={reset}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      </span>
      {problem === undefined ? null : (
        <p className="nx-variants__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * What a field's control shows for a stored value. A cleared field shows
 * empty, and a cleared visibility hides its part, as the resolver draws it.
 */
function shownValue(field: ExposedProperty, value: unknown): unknown {
  if (!isUnsetOverride(value)) return value;
  return field.type === "visibility" ? false : undefined;
}

/** The control for one field's value, by the field's type. */
function VariantValueControl({
  id,
  field,
  value,
  onCommit,
}: {
  id: string;
  field: ExposedProperty;
  value: unknown;
  onCommit: (next: OverrideValue) => void;
}): React.JSX.Element {
  switch (field.type) {
    case "visibility":
      return <ShownValue id={id} value={value} onCommit={onCommit} />;
    case "select":
      return (
        <ChoiceValue id={id} field={field} value={value} onCommit={onCommit} />
      );
    case "text":
    case "link":
      return (
        <TextValue
          id={id}
          value={typeof value === "string" ? value : ""}
          onCommit={onCommit}
        />
      );
    default:
      return (
        <p id={id} className="nx-variants__hint">
          Chosen where the component is used
        </p>
      );
  }
}

/**
 * Whether the variant shows a part: the placements' own checkbox, saying
 * which, so a part reads the same in both panels.
 */
function ShownValue({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: unknown;
  onCommit: (next: OverrideValue) => void;
}): React.JSX.Element {
  return (
    <span className="nx-variants__check">
      <Checkbox
        id={id}
        checked={value !== false}
        onCheckedChange={checked => onCommit(checked === true)}
      />
      <span>{value === false ? "Hidden" : "Shown"}</span>
    </span>
  );
}

/** One of a choice field's options. */
function ChoiceValue({
  id,
  field,
  value,
  onCommit,
}: {
  id: string;
  field: ExposedProperty;
  value: unknown;
  onCommit: (next: OverrideValue) => void;
}): React.JSX.Element {
  return (
    <Select
      value={typeof value === "string" ? `=${value}` : undefined}
      onValueChange={next => onCommit(next.slice(1))}
    >
      <SelectTrigger id={id} size="sm">
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {choicesOf(field).map(choice => (
          // Prefixed, because the primitive reserves the empty string for
          // "no selection" and a choice may be "".
          <SelectItem key={choice.value} value={`=${choice.value}`}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A choice field's options, read defensively: a stored or imported field may
 * hold anything there, and only `{ value, label }` strings can be drawn.
 */
function choicesOf(
  field: ExposedProperty
): readonly { value: string; label: string }[] {
  const options: unknown = field.options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (option): option is { value: string; label: string } =>
      typeof option === "object" &&
      option !== null &&
      typeof (option as { value?: unknown }).value === "string" &&
      typeof (option as { label?: unknown }).label === "string"
  );
}

/** A text value, committed on blur or Enter. */
function TextValue({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (next: OverrideValue) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(value);
  const send = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      size="sm"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={send}
      onKeyDown={event => {
        commitOnEnter(event, send);
      }}
    />
  );
}

/**
 * Confirms a delete, with how many placements chose the variant. Counted when
 * the dialog opens, so the number is the one the designer confirms.
 */
function DeleteVariantDialog({
  context,
  option,
  host,
  onClose,
}: {
  context: VariantEditContext;
  option: VariantOption;
  host: ComponentVariantsHost | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const use = useVariantUse(host, option.id);
  const [problem, setProblem] = React.useState<string | undefined>(undefined);
  const confirm = () => {
    const outcome = deleteVariant(context, option.id);
    if (outcome.applied) onClose();
    else setProblem(outcome.reason);
  };
  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md" data-delete-variant="">
        <DialogHeader>
          <DialogTitle>Delete the variant “{option.label}”?</DialogTitle>
          <DialogDescription aria-live="polite">
            {deleteSentence(use)}
          </DialogDescription>
        </DialogHeader>
        {problem === undefined ? null : (
          <p className="nx-variants__problem" role="alert">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            // Held while the count is out, so the delete is confirmed with
            // the number in view; a count that failed does not hold it.
            disabled={use === undefined}
            onClick={confirm}
          >
            Delete variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The host's count of a variant's placements: `undefined` while it is asked,
 * `null` when it cannot be counted.
 */
function useVariantUse(
  host: ComponentVariantsHost | undefined,
  variantId: string
): VariantUse | null | undefined {
  const count = host?.countUse;
  const [use, setUse] = React.useState<VariantUse | null | undefined>(
    count === undefined ? null : undefined
  );
  React.useEffect(() => {
    if (count === undefined) return;
    let live = true;
    count(variantId).then(
      found => {
        if (live) setUse(found);
      },
      () => {
        if (live) setUse(null);
      }
    );
    return () => {
      live = false;
    };
  }, [count, variantId]);
  return use;
}
