"use client";

/**
 * The component's own view, in the inspector: the switches that expose a
 * prop, the switch that lets placements hide a block, the list of exposed
 * fields, and the dialog that confirms a removal.
 *
 * Draws what `component-fields` decides and decides nothing itself.
 *
 * **A removal always asks first.** Placements that set the field lose their
 * value once the component is published, and variants lose theirs at once, so
 * the dialog names the variants it prunes before anything changes. An
 * exposure added is undone with undo; one removed may already have values on
 * pages, so it is confirmed rather than taken back.
 *
 * A name commits on blur or Enter, as every inspector field does: one rename
 * is one undo step, not one per letter.
 *
 * @module component-fields-panel
 */
import {
  findNode,
  type ComponentDocument,
  type ExposedProperty,
  type ExposureEdit,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@nextlyhq/ui";
import { Crosshair, Trash2 } from "lucide-react";
import * as React from "react";

import { commitOnEnter } from "./commit-on-enter";
import {
  editedComponent,
  EXPOSURE_TYPE_LABEL,
  exposedFields,
  exposedSlotIds,
  exposeOffer,
  exposeProp,
  exposeVisibility,
  idsIn,
  planFieldRemoval,
  propExposure,
  removalSentences,
  renameField,
  reservedIds,
  visibilityExposure,
  applyFieldEdit,
  type ComponentFieldsHost,
  type FieldEditContext,
} from "./component-fields";
import type { EditorState } from "./editor-state";
import { blockLabel } from "./inserter";
import { fieldLabel, type EditableProp } from "./inspector";
import { useStoredDraft } from "./stored-draft";

/** A field or an exposed slot the author asked to remove. */
export interface FieldRemoval {
  readonly kind: "field" | "slot";
  readonly id: string;
  /** What the dialog calls it. */
  readonly label: string;
}

/** What the inspector hands every control while a component is edited. */
export interface ComponentFieldsBinding {
  readonly context: FieldEditContext;
  readonly requestRemoval: (removal: FieldRemoval) => void;
}

/**
 * Every id the session has seen this component hold, kept across edits.
 *
 * A field removed and exposed again under the same name must get a new id: a
 * placement may still hold a value under the old one. The document alone
 * forgets the old id the moment it is removed, so the session remembers it.
 */
function useSeenIds(
  component: ComponentDocument | undefined
): RetiredExposures {
  const seen = React.useRef<{ properties: Set<string>; slots: Set<string> }>({
    properties: new Set(),
    slots: new Set(),
  });
  if (component !== undefined) {
    const now = idsIn(component);
    for (const id of now.properties) seen.current.properties.add(id);
    for (const id of now.slots) seen.current.slots.add(id);
  }
  return {
    properties: [...seen.current.properties],
    slots: [...seen.current.slots],
  };
}

/**
 * The binding for a component's view, which every control below the scope
 * reads; `undefined` for a page or a pattern.
 */
export const ComponentFieldsContext: React.Context<
  ComponentFieldsBinding | undefined
> = React.createContext<ComponentFieldsBinding | undefined>(undefined);

/**
 * The component's view around the inspector: the binding its controls read,
 * and the removal dialog any of them may open, drawn once here whichever
 * surface asked for it.
 */
export function ComponentFieldsScope({
  editor,
  host,
  children,
}: {
  editor: EditorState;
  host: ComponentFieldsHost | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const { binding, dialog } = useComponentFields(editor, host);
  return (
    <ComponentFieldsContext.Provider value={binding}>
      {children}
      {dialog}
    </ComponentFieldsContext.Provider>
  );
}

/**
 * The binding for a component's view, and the removal dialog it opens; no
 * binding for a page or a pattern.
 */
function useComponentFields(
  editor: EditorState,
  host: ComponentFieldsHost | undefined
): {
  readonly binding: ComponentFieldsBinding | undefined;
  readonly dialog: React.JSX.Element | null;
} {
  const component = editedComponent(editor.document);
  const seen = useSeenIds(component);
  const [removal, setRemoval] = React.useState<FieldRemoval | null>(null);
  const binding: ComponentFieldsBinding | undefined =
    component === undefined
      ? undefined
      : {
          context: {
            editor,
            component,
            reserved: reservedIds(host?.reserved, seen),
          },
          requestRemoval: setRemoval,
        };
  const dialog =
    component === undefined || removal === null ? null : (
      <RemoveFieldDialog
        editor={editor}
        component={component}
        removal={removal}
        reach={host?.reach}
        onClose={() => setRemoval(null)}
      />
    );
  return { binding, dialog };
}

/** The refusal or failure an edit came back with, said where it happened. */
function useEditProblem(): [
  string | undefined,
  (reason: string | undefined) => void,
] {
  return React.useState<string | undefined>(undefined);
}

/**
 * Under a prop's control while a component is edited: whether placements may
 * set it, and the field's name when they may.
 */
export function PropExposeControl({
  binding,
  nodeId,
  prop,
}: {
  binding: ComponentFieldsBinding;
  nodeId: string;
  prop: EditableProp;
}): React.JSX.Element {
  const { context, requestRemoval } = binding;
  const field = propExposure(context.component, nodeId, prop.name);
  const offer = exposeOffer(prop.schema);
  const [problem, setProblem] = useEditProblem();
  const switchId = React.useId();
  const reasonId = React.useId();
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const focusName = React.useRef(false);

  React.useEffect(() => {
    // The name is the next thing an author decides, so a field just exposed
    // takes the focus straight to it.
    if (field !== undefined && focusName.current) {
      focusName.current = false;
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [field]);

  const toggle = (on: boolean) => {
    if (!on) {
      if (field !== undefined) {
        requestRemoval({ kind: "field", id: field.id, label: field.label });
      }
      return;
    }
    const outcome = exposeProp(
      context,
      nodeId,
      prop.name,
      fieldLabel(prop.name)
    );
    setProblem(outcome.applied ? undefined : outcome.reason);
    focusName.current = outcome.applied;
  };

  const unavailable = "reason" in offer ? offer.reason : undefined;
  const said = problem ?? unavailable;
  return (
    <div
      className="nx-expose"
      data-exposed={field === undefined ? undefined : ""}
      data-expose-prop={prop.name}
    >
      <div className="nx-expose__row">
        <Switch
          id={switchId}
          checked={field !== undefined}
          disabled={field === undefined && unavailable !== undefined}
          onCheckedChange={toggle}
          aria-describedby={said === undefined ? undefined : reasonId}
        />
        <Label htmlFor={switchId} className="nx-expose__label">
          {field === undefined ? "Expose to placements" : "Exposed as"}
        </Label>
        {field === undefined ? null : (
          <FieldName
            inputRef={nameRef}
            binding={binding}
            field={field}
            label={`Name of the exposed field for ${fieldLabel(prop.name)}`}
          />
        )}
      </div>
      {said === undefined ? null : (
        <p
          id={reasonId}
          className="nx-expose__reason"
          role={problem === undefined ? undefined : "alert"}
        >
          {said}
        </p>
      )}
    </div>
  );
}

/**
 * Above a block's props while a component is edited: whether each placement
 * may hide the block.
 */
export function VisibilityExposeControl({
  binding,
  nodeId,
  blockName,
}: {
  binding: ComponentFieldsBinding;
  nodeId: string;
  blockName: string;
}): React.JSX.Element {
  const { context, requestRemoval } = binding;
  const field = visibilityExposure(context.component, nodeId);
  const [problem, setProblem] = useEditProblem();
  const switchId = React.useId();
  const reasonId = React.useId();

  const toggle = (on: boolean) => {
    if (!on) {
      if (field !== undefined) {
        requestRemoval({ kind: "field", id: field.id, label: field.label });
      }
      return;
    }
    const outcome = exposeVisibility(
      context,
      nodeId,
      `Show ${blockName.toLowerCase()}`
    );
    setProblem(outcome.applied ? undefined : outcome.reason);
  };

  return (
    <div
      className="nx-expose nx-expose--visibility"
      data-exposed={field === undefined ? undefined : ""}
    >
      <div className="nx-expose__row">
        <Switch
          id={switchId}
          checked={field !== undefined}
          onCheckedChange={toggle}
          aria-describedby={problem === undefined ? undefined : reasonId}
        />
        <Label htmlFor={switchId} className="nx-expose__label">
          Let placements hide this
        </Label>
        {field === undefined ? null : (
          <FieldName
            binding={binding}
            field={field}
            label="Name of the field that hides this block"
          />
        )}
      </div>
      {problem === undefined ? null : (
        <p id={reasonId} className="nx-expose__reason" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A field's name, renamed on blur or Enter. Its id never changes. */
function FieldName({
  binding,
  field,
  label,
  inputRef,
}: {
  binding: ComponentFieldsBinding;
  field: ExposedProperty;
  label: string;
  inputRef?: React.Ref<HTMLInputElement>;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(field.label);
  const [problem, setProblem] = useEditProblem();
  const send = () => {
    if (draft === field.label) return;
    const outcome = renameField(binding.context, field.id, draft);
    if (outcome.applied) {
      setProblem(undefined);
      return;
    }
    // Back to the stored name, with the reason: a blank name is refused, and
    // leaving the blank on screen would show a name the component does not have.
    setDraft(field.label);
    setProblem(outcome.reason);
  };
  return (
    <span className="nx-expose__name">
      <Input
        ref={inputRef}
        size="sm"
        value={draft}
        aria-label={label}
        onChange={event => setDraft(event.target.value)}
        onBlur={send}
        onKeyDown={event => {
          commitOnEnter(event, send);
        }}
      />
      {problem === undefined ? null : (
        <span className="nx-expose__reason" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

/**
 * The component's fields and exposed slots, drawn while nothing is selected:
 * the component itself is what the inspector then describes.
 */
export function ExposedFieldsList({
  binding,
  editor,
}: {
  binding: ComponentFieldsBinding;
  editor: EditorState;
}): React.JSX.Element {
  const { component } = binding.context;
  const fields = exposedFields(component);
  const slots = exposedSlotIds(component);
  const headingId = React.useId();
  return (
    <div className="nx-inspector" data-component-fields="">
      <h2 className="nx-inspector__title">Component</h2>
      <section aria-labelledby={headingId} className="nx-exposed-fields">
        <h3 id={headingId} className="nx-inspector__heading">
          Exposed fields
        </h3>
        {fields.length === 0 && slots.length === 0 ? (
          <p className="nx-inspector__note">
            Placements can’t change anything in this component yet. Select a
            block, then switch on “Expose to placements” beside a property.
          </p>
        ) : (
          <ul className="nx-exposed-fields__list">
            {fields.map(field => (
              <ExposedFieldRow
                key={field.id}
                binding={binding}
                editor={editor}
                field={field}
              />
            ))}
            {slots.map(id => (
              <ExposedSlotRow
                key={`slot:${id}`}
                binding={binding}
                editor={editor}
                slotId={id}
              />
            ))}
          </ul>
        )}
        <p className="nx-inspector__note">
          Select a block to expose more of its properties.
        </p>
      </section>
    </div>
  );
}

/** Where a field points, in words: "Heading · Text". */
function targetOf(editor: EditorState, field: ExposedProperty): string {
  const node = findNode(editor.document.nodes, field.nodeId);
  const block = node === undefined ? "A missing block" : blockLabel(node.type);
  return field.type === "visibility"
    ? `${block} · visibility`
    : `${block} · ${fieldLabel(field.propPath)}`;
}

function ExposedFieldRow({
  binding,
  editor,
  field,
}: {
  binding: ComponentFieldsBinding;
  editor: EditorState;
  field: ExposedProperty;
}): React.JSX.Element {
  const target = targetOf(editor, field);
  return (
    <li className="nx-exposed-fields__item" data-field-id={field.id}>
      <div className="nx-exposed-fields__main">
        <FieldName
          binding={binding}
          field={field}
          label={`Name of the field ${field.label}`}
        />
        <span className="nx-exposed-fields__type">
          {EXPOSURE_TYPE_LABEL[field.type]}
        </span>
      </div>
      <div className="nx-exposed-fields__meta">
        <span className="nx-exposed-fields__target">{target}</span>
        <span className="nx-exposed-fields__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Select the block ${field.label} comes from`}
            title="Select its block"
            onClick={() => editor.select(field.nodeId)}
          >
            <Crosshair size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove the field ${field.label}`}
            title="Remove field"
            onClick={() =>
              binding.requestRemoval({
                kind: "field",
                id: field.id,
                label: field.label,
              })
            }
          >
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        </span>
      </div>
    </li>
  );
}

function ExposedSlotRow({
  binding,
  editor,
  slotId,
}: {
  binding: ComponentFieldsBinding;
  editor: EditorState;
  slotId: string;
}): React.JSX.Element {
  const slot = binding.context.component.slots?.[slotId];
  const label = typeof slot?.label === "string" ? slot.label : slotId;
  return (
    <li className="nx-exposed-fields__item" data-slot-id={slotId}>
      <div className="nx-exposed-fields__main">
        <span className="nx-exposed-fields__name">{label}</span>
        <span className="nx-exposed-fields__type">Slot</span>
      </div>
      <div className="nx-exposed-fields__meta">
        <span className="nx-exposed-fields__target">
          Placements fill it with their own blocks
        </span>
        <span className="nx-exposed-fields__actions">
          {slot === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Select the block holding ${label}`}
              title="Select its block"
              onClick={() => editor.select(slot.nodeId)}
            >
              <Crosshair size={14} aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove the slot ${label}`}
            title="Remove slot"
            onClick={() =>
              binding.requestRemoval({ kind: "slot", id: slotId, label })
            }
          >
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        </span>
      </div>
    </li>
  );
}

/**
 * Confirms a removal, naming what it takes away. Planned when it opens, so the
 * variants it lists are the ones the confirmed edit prunes.
 */
function RemoveFieldDialog({
  editor,
  component,
  removal,
  reach,
  onClose,
}: {
  editor: EditorState;
  component: ComponentDocument;
  removal: FieldRemoval;
  reach: ComponentFieldsHost["reach"];
  onClose: () => void;
}): React.JSX.Element {
  const planned = planFieldRemoval(component, removal, editor.limits);
  const [problem, setProblem] = useEditProblem();
  const noun = removal.kind === "field" ? "field" : "slot";
  const confirm = () => {
    const outcome = applyFieldEdit(editor, component, planned);
    if (outcome.applied) onClose();
    else setProblem(outcome.reason);
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Remove the {noun} “{removal.label}”?
          </DialogTitle>
          <DialogDescription>
            {"problem" in planned
              ? "This can’t be removed here."
              : removalSentences(planned, removal, reach).placements}
          </DialogDescription>
        </DialogHeader>
        {"problem" in planned ? null : (
          <PrunedVariants edit={planned} removal={removal} />
        )}
        {problem === undefined ? null : (
          <p className="nx-inspector__note" role="alert">
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
            disabled={"problem" in planned}
            onClick={confirm}
          >
            Remove {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The variants a removal takes a value from, or that none does. */
function PrunedVariants({
  edit,
  removal,
}: {
  edit: ExposureEdit;
  removal: FieldRemoval;
}): React.JSX.Element | null {
  if (removal.kind === "slot") return null;
  const { variants } = removalSentences(edit, removal, undefined);
  if (variants.length === 0) {
    return <p className="nx-inspector__note">No variant sets this field.</p>;
  }
  return (
    <div className="nx-remove-field__variants">
      <p className="nx-inspector__note">These variants lose their value now:</p>
      <ul>
        {variants.map(entry => (
          <li key={entry.variant}>{entry.sentence}</li>
        ))}
      </ul>
    </div>
  );
}
