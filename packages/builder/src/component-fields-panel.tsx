"use client";

/**
 * The component's own view, in the inspector: the icon beside each property
 * that lets each page change it, the same icon on a block's Shown row,
 * the card naming the component over its list of fields, and the dialog that
 * confirms a removal.
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
  variantOptions,
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
  TooltipProvider,
} from "@nextlyhq/ui";
import {
  AlignLeft,
  Component,
  Crosshair,
  Eye,
  Image as ImageIcon,
  Link2,
  List,
  SquareDashed,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { commitOnEnter } from "./commit-on-enter";
import {
  editedComponent,
  EXPOSURE_TYPE_LABEL,
  exposedFields,
  exposedSlotIds,
  exposeOffer,
  exposeProp,
  exposeVisibility,
  fieldSource,
  idsIn,
  planFieldRemoval,
  propExposure,
  removalSentences,
  renameField,
  reservedIds,
  slotSource,
  visibilityExposure,
  applyFieldEdit,
  type ComponentFieldsHost,
  type FieldEditContext,
} from "./component-fields";
import type { EditorState } from "./editor-state";
import { propLabel, type EditableProp } from "./inspector";
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
  /** The component's name, for the card heading its view; absent if unknown. */
  readonly name?: string | undefined;
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
          name: host?.name,
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

/** The type icon a field's row shows, by what a placement sets through it. */
const TYPE_ICON: Readonly<Record<ExposedProperty["type"], LucideIcon>> = {
  text: Type,
  richText: AlignLeft,
  image: ImageIcon,
  link: Link2,
  visibility: Eye,
  select: List,
};

/**
 * What the icon beside a property says, in the author's words: "page" where
 * the code says placement, and a one-line tooltip on what pressing it does.
 */
const TOGGLE_WORDS = {
  prop: {
    label: (property: string) => `Let each page change ${property}`,
    off: (property: string) =>
      `Turn this on to let each use of the component, on any page, set its own ${property.toLowerCase()}.`,
    on: "Each use can change this. Turn off to use the component’s value everywhere.",
  },
  visibility: {
    label: (block: string) => `Let each page hide ${block}`,
    off: (block: string) =>
      `Turn this on to let each use of the component, on any page, hide this ${block.toLowerCase()}.`,
    on: "Each use can hide this. Turn off to show it everywhere.",
  },
} as const;

/**
 * The icon beside a property that lets each page change it: the
 * component mark, pressed while the property is exposed. A button with a
 * pressed state rather than a switch row under every property, as Figma and
 * Webflow bind a property, so a long list stays a list of properties.
 *
 * A property no placement could set keeps its icon HELD rather than disabled:
 * still focusable and hoverable, so the reason can be read, and said aloud
 * when pressed.
 */
function ExposeToggle({
  label,
  pressed,
  held,
  title,
  onPress,
}: {
  /** The button's name, the same whether pressed or not. */
  label: string;
  pressed: boolean;
  /** Why it cannot be pressed, or nothing when it can. */
  held: string | undefined;
  /** What its tooltip says, on hover and on focus. */
  title: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      {/* Below the icon, ending at its right edge: the row's own label stays
          readable beside the icon, and the tip lies over the next row, which
          the author isn't reading while pointing here. */}
      <ChromeTooltip
        side="bottom"
        align="end"
        className="nx-expose__tip"
        content={held ?? title}
      >
        <button
          type="button"
          className="nx-expose__toggle"
          aria-label={label}
          aria-pressed={pressed}
          aria-disabled={held === undefined ? undefined : true}
          onClick={onPress}
        >
          <Component size={15} aria-hidden="true" />
        </button>
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** What the dashed row's "Field" label says on hover. */
const FIELD_HINT = "The name each page’s editor shows for this field.";

/**
 * Under a property, once it is exposed: the dashed row naming the field
 * each page sets it through.
 */
function ExposedFieldName({
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
  // The hint is said with the name input as its description, so it reaches
  // a keyboard or screen-reader user too; the title keeps it on hover.
  const hintId = `${React.useId()}-hint`;
  return (
    <div className="nx-expose__field">
      <span
        className="nx-expose__field-label"
        aria-hidden="true"
        title={FIELD_HINT}
      >
        <Component size={13} />
        Field
      </span>
      <span id={hintId} className="nx-sr-only">
        {FIELD_HINT}
      </span>
      <FieldName
        inputRef={inputRef}
        binding={binding}
        field={field}
        label={label}
        describedBy={hintId}
        className="nx-expose__name-input"
      />
    </div>
  );
}

/**
 * Beside a prop's control while a component is edited: the icon that lets
 * each page change it, and the field's name under it once it does.
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
  const reasonId = React.useId();
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const focusName = React.useRef(false);
  const named = propLabel(prop.name, prop.schema);

  React.useEffect(() => {
    // The name is the next thing an author decides, so a field just exposed
    // takes the focus straight to it.
    if (field !== undefined && focusName.current) {
      focusName.current = false;
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [field]);

  const unavailable =
    field === undefined && "reason" in offer ? offer.reason : undefined;
  const press = () => {
    if (field !== undefined) {
      requestRemoval({ kind: "field", id: field.id, label: field.label });
      return;
    }
    if (unavailable !== undefined) {
      setProblem(unavailable);
      return;
    }
    const outcome = exposeProp(context, nodeId, prop.name, named);
    setProblem(outcome.applied ? undefined : outcome.reason);
    focusName.current = outcome.applied;
  };

  return (
    <div
      className="nx-expose"
      data-exposed={field === undefined ? undefined : ""}
      data-expose-prop={prop.name}
      aria-describedby={problem === undefined ? undefined : reasonId}
    >
      <ExposeToggle
        label={TOGGLE_WORDS.prop.label(named)}
        pressed={field !== undefined}
        held={unavailable}
        title={
          field === undefined
            ? TOGGLE_WORDS.prop.off(named)
            : TOGGLE_WORDS.prop.on
        }
        onPress={press}
      />
      {field === undefined ? null : (
        <ExposedFieldName
          inputRef={nameRef}
          binding={binding}
          field={field}
          label={`Name pages see for ${named}`}
        />
      )}
      {problem === undefined ? null : (
        <p id={reasonId} className="nx-expose__reason" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Above a block's props while a component is edited: its Shown row, with the
 * same icon, letting each page hide the block.
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
  const reasonId = React.useId();

  const press = () => {
    if (field !== undefined) {
      requestRemoval({ kind: "field", id: field.id, label: field.label });
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
    <div className="nx-inspector__prop nx-expose-shown">
      <div
        className="nx-expose"
        data-exposed={field === undefined ? undefined : ""}
        data-expose-visibility=""
      >
        <p className="nx-expose__shown">
          <span className="nx-expose__shown-label">Shown</span>
          <span className="nx-expose__shown-value">
            {field === undefined ? "On every page" : "Each use chooses"}
          </span>
        </p>
        <ExposeToggle
          label={TOGGLE_WORDS.visibility.label(blockName)}
          pressed={field !== undefined}
          held={undefined}
          title={
            field === undefined
              ? TOGGLE_WORDS.visibility.off(blockName)
              : TOGGLE_WORDS.visibility.on
          }
          onPress={press}
        />
        {field === undefined ? null : (
          <ExposedFieldName
            binding={binding}
            field={field}
            label={`Name pages see for hiding ${blockName}`}
          />
        )}
        {problem === undefined ? null : (
          <p id={reasonId} className="nx-expose__reason" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

/** A field's name, renamed on blur or Enter. Its id never changes. */
function FieldName({
  binding,
  field,
  label,
  inputRef,
  describedBy,
  className,
}: {
  binding: ComponentFieldsBinding;
  field: ExposedProperty;
  label: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** The id of text that says more about the name, read with the input. */
  describedBy?: string;
  /** How the name is drawn: flat in the list, dashed under a property. */
  className: string;
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
    <span className="nx-field-name">
      <Input
        ref={inputRef}
        size="sm"
        className={className}
        value={draft}
        aria-label={label}
        aria-describedby={describedBy}
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

/** "Component · 5 fields · 2 variants", or "Component · no fields yet". */
function holdsSentence(fieldCount: number, variantCount: number): string {
  const parts = ["Component"];
  parts.push(
    fieldCount === 0
      ? "no fields yet"
      : `${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`
  );
  if (variantCount > 0) {
    parts.push(
      `${variantCount} ${variantCount === 1 ? "variant" : "variants"}`
    );
  }
  return parts.join(" · ");
}

/**
 * The card heading the component's view: its mark, its name (whole on hover,
 * for a name too long for the panel) and how much it holds.
 */
function ComponentHeader({
  name,
  fieldCount,
  variantCount,
}: {
  name: string;
  fieldCount: number;
  variantCount: number;
}): React.JSX.Element {
  return (
    <div className="nx-component-head">
      <span className="nx-component-head__mark" aria-hidden="true">
        <Component size={16} />
      </span>
      <div className="nx-component-head__text">
        <h2 className="nx-component-head__name" title={name}>
          {name}
        </h2>
        <p className="nx-component-head__holds">
          {holdsSentence(fieldCount, variantCount)}
        </p>
      </div>
    </div>
  );
}

/** What the list says before the component has a field. */
function NoFieldsYet(): React.JSX.Element {
  return (
    <div className="nx-component-fields__empty">
      <p className="nx-component-fields__empty-title">No fields yet</p>
      <p className="nx-component-fields__empty-text">
        Select a block, then use{" "}
        <span
          className="nx-component-fields__mark"
          role="img"
          aria-label="the component mark"
        >
          <Component size={13} aria-hidden="true" />
        </span>{" "}
        beside a property to let each page change it.
      </p>
    </div>
  );
}

/**
 * The component's fields and exposed slots, drawn while nothing is selected:
 * the component itself is what the inspector then describes, under a card
 * naming it.
 */
export function ExposedFieldsList({
  binding,
  editor,
  children,
}: {
  binding: ComponentFieldsBinding;
  editor: EditorState;
  /** What the component's view lists under its fields: its variants. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const { component } = binding.context;
  const fields = exposedFields(component);
  const slots = exposedSlotIds(component);
  const headingId = React.useId();
  return (
    <div className="nx-inspector" data-component-fields="">
      <ComponentHeader
        name={binding.name ?? "This component"}
        fieldCount={fields.length + slots.length}
        variantCount={variantOptions(component).length}
      />
      <section aria-labelledby={headingId} className="nx-component-fields">
        <h3 id={headingId} className="nx-inspector__heading">
          Fields
        </h3>
        {fields.length === 0 && slots.length === 0 ? (
          <NoFieldsYet />
        ) : (
          <ul className="nx-component-fields__list">
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
      </section>
      {children}
    </div>
  );
}

/** A row's two actions, drawn on hover and focus: show its block, remove it. */
function RowActions({
  selectLabel,
  onSelect,
  removeLabel,
  removeTitle,
  onRemove,
}: {
  selectLabel: string | undefined;
  onSelect: () => void;
  removeLabel: string;
  removeTitle: string;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <span className="nx-component-field__actions">
      {selectLabel === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={selectLabel}
          title="Select its block"
          onClick={onSelect}
        >
          <Crosshair size={14} aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={removeLabel}
        title={removeTitle}
        onClick={onRemove}
      >
        <Trash2 size={14} aria-hidden="true" />
      </Button>
    </span>
  );
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
  const Icon = TYPE_ICON[field.type];
  return (
    <li className="nx-component-field" data-field-id={field.id}>
      <span
        className="nx-component-field__type"
        role="img"
        aria-label={EXPOSURE_TYPE_LABEL[field.type]}
        title={EXPOSURE_TYPE_LABEL[field.type]}
      >
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="nx-component-field__text">
        <FieldName
          binding={binding}
          field={field}
          label={`Name of the field ${field.label}`}
          className="nx-component-field__name"
        />
        <span className="nx-component-field__source">
          {fieldSource(editor.document, field)}
        </span>
      </span>
      <RowActions
        selectLabel={`Select the block ${field.label} comes from`}
        onSelect={() => editor.select(field.nodeId)}
        removeLabel={`Remove the field ${field.label}`}
        removeTitle="Remove field"
        onRemove={() =>
          binding.requestRemoval({
            kind: "field",
            id: field.id,
            label: field.label,
          })
        }
      />
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
    <li className="nx-component-field" data-slot-id={slotId}>
      <span
        className="nx-component-field__type"
        role="img"
        aria-label="Blocks each use adds"
        title="Blocks each use adds"
      >
        <SquareDashed size={15} aria-hidden="true" />
      </span>
      <span className="nx-component-field__text">
        <span className="nx-component-field__label">{label}</span>
        <span className="nx-component-field__source">
          {slotSource(binding.context.component, slotId)}
        </span>
      </span>
      <RowActions
        selectLabel={
          slot === undefined ? undefined : `Select the block holding ${label}`
        }
        onSelect={() => {
          if (slot !== undefined) editor.select(slot.nodeId);
        }}
        removeLabel={`Remove the field ${label}`}
        removeTitle="Remove field"
        onRemove={() =>
          binding.requestRemoval({ kind: "slot", id: slotId, label })
        }
      />
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
