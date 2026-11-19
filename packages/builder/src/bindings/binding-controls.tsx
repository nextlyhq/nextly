/**
 * The inspector's binding controls for one prop: a bind button beside a
 * bindable field, the picker it opens, and, once the prop is bound, a chip
 * naming the field, its fallback, and a menu to change the field or unbind.
 *
 * The picker lists only the fields that fit the prop, by the engine's own
 * rule (`canBindFieldToProp`), from what the host reads for the person
 * editing (`ContentServices.listBindingFields`), and, for a block inside a
 * collection list, the list item's own fields first, with their values from
 * the list's first entry (`readListSample`): fields visitors may not read say
 * so, and a draft's value is shown with "Draft" beside it, in each option's
 * own text, so a screen reader announces both. An unbind is planned by the
 * host, by the decision the page actions API takes, and applied here as any
 * edit; the reason it gives is said under the field.
 *
 * This module holds the bind button and the bound field with its chip, menu,
 * fallback and values, and is the entry for the rest: the picker is in
 * `binding-picker.tsx`, the names a bound prop is said by in
 * `binding-bound-names.ts`, and the note an unbind leaves in
 * `binding-notes.tsx`.
 *
 * @module binding-controls
 */
import {
  bindablePropKind,
  findNode,
  followsSetting,
  getBlock,
  sameJsonValue,
  type Binding,
  type BindingFormat,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "@nextlyhq/ui";
import { ChevronDown, Database, ExternalLink, Unlink } from "lucide-react";
import * as React from "react";

import type { UnbindAnswer } from "../composition-actions";
import type { ContentServices } from "../content-controls";
import { propLabel, type EditableProp } from "../inspector";

import {
  boundField,
  boundNames,
  boundSource,
  useBoundFrom,
} from "./binding-bound-names";
import { BindingFormatField, offersFormat } from "./binding-format-field";
import { noteFor, type UnbindNote, UnboundNote } from "./binding-notes";
import { bindOp, unbindOp } from "./binding-ops";
import {
  BindingPicker,
  clearHeld,
  type EntryLink,
  type NamedField,
  pickOp,
} from "./binding-picker";
import type {
  BindingFieldSource,
  UnbindAsk,
  UnbindPlanAnswer,
} from "./binding-services";
import { ImageBindingFallback } from "./image-binding-fallback";
import type { ItemSource } from "./item-binding-source";

// The picker, the names a bound prop is said by and the notes under a field
// live in modules of their own beside the controls; every name this module
// exported still is.
export { useBoundFieldOf } from "./binding-bound-names";

/** The binding with `fallback` as its fallback; none when it is empty. */
function withFallback(binding: Binding, fallback: string): Binding {
  const rest = Object.fromEntries(
    Object.entries(binding).filter(([key]) => key !== "fallback")
  );
  return (fallback === "" ? rest : { ...rest, fallback }) as Binding;
}

/** The binding with `format` as its format, through the same write as a fallback. */
function withFormat(binding: Binding, format: BindingFormat): Binding {
  return { ...binding, format };
}

/** What the bound and bindable rows are handed. */
export interface BindingControlProps {
  readonly nodeId: string;
  readonly prop: EditableProp;
  /** The block's name as the panel shows it: "Heading". */
  readonly blockLabel: string;
  /** The prop's binding, when it has one. */
  readonly binding: Binding | undefined;
  /** The document the block is in, which an op is planned against. */
  readonly document: BlockDocument;
  readonly services: ContentServices | undefined;
  readonly disabled: boolean;
  /** Apply one op as an edit; `false` where the editor refused it. */
  readonly onApply: (op: BuilderOp) => boolean;
  /**
   * Props emptied in the same edit as a bind: what would win over the bound
   * prop, such as a button's entry reference over its address.
   */
  readonly clearsOnBind?: readonly string[] | undefined;
  /**
   * Those of `clearsOnBind` that may not be written where the block sits: a
   * bind or a change of field that would empty one is held.
   */
  readonly clearsLocked?: readonly string[] | undefined;
  /**
   * Where the prop is a link's destination, or its bound entry id: the
   * link's props. The picker then offers the entries a relation names, and a
   * pick of one binds the link's entry (see `pickOp`).
   */
  readonly entryLink?: EntryLink | undefined;
  /** The prop's own control, drawn while it is not bound. */
  readonly children: React.ReactNode;
}

/**
 * A prop's row with its binding controls: the field and a bind button while
 * unbound, a chip with its fallback once bound. A prop no field can fill, or
 * a host that reads no fields, draws the field alone.
 */
export function BindableField(props: BindingControlProps): React.JSX.Element {
  const { prop, binding, services, children } = props;
  // The note an unbind leaves under the field: kept until the next one.
  const [note, setNote] = React.useState<UnbindNote | null>(null);
  const bindable =
    bindablePropKind(prop.schema) !== undefined &&
    services?.listBindingFields !== undefined;
  if (binding !== undefined) {
    return <BoundField {...props} binding={binding} onUnbound={setNote} />;
  }
  // No bind button where no field can fill it or none are listed; an
  // unbind's note is still said.
  if (!bindable) {
    return (
      <>
        {children}
        {note === null ? null : <UnboundNote note={note} />}
      </>
    );
  }
  return (
    <div className="nx-binding-row">
      <div className="nx-binding-row__field">{children}</div>
      <BindButton
        {...props}
        onBound={() => setNote(null)}
        onRefused={text => setNote({ text, tone: "refused" })}
      />
      {note === null ? null : <UnboundNote note={note} />}
    </div>
  );
}

/** The bind button and its picker. */
function BindButton({
  nodeId,
  prop,
  blockLabel,
  document,
  services,
  disabled,
  onApply,
  clearsOnBind,
  clearsLocked,
  entryLink,
  onBound,
  onRefused,
}: BindingControlProps & {
  onBound: () => void;
  onRefused: (reason: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const name = propLabel(prop.name, prop.schema);
  const trigger = React.useRef<HTMLButtonElement>(null);
  // The inspector's fields, taken from the button before a pick replaces it
  // with the chip: the picker is drawn in a portal, outside them. And the
  // prop the pick bound, whose chip that is: a related entry binds the
  // link's entry, not this prop.
  const pickedIn = React.useRef<Element | null>(null);
  const boundProp = React.useRef(prop.name);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="nx-binding-row__bind"
          aria-label={`Bind ${name} to a field`}
          title={`Bind ${name} to a field`}
          disabled={disabled || clearHeld(document, nodeId, clearsLocked)}
          data-open={open ? "" : undefined}
        >
          <Database aria-hidden="true" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nx-binding-popover"
        // The bound chip replaces this button, so focus is handed to it once
        // the pick has drawn it.
        onCloseAutoFocus={event => {
          const fields = pickedIn.current;
          pickedIn.current = null;
          if (fields === null) return;
          event.preventDefault();
          requestAnimationFrame(() => {
            fields
              .querySelector<HTMLElement>(
                `[data-binding-chip="${CSS.escape(`${nodeId}:${boundProp.current}`)}"]`
              )
              ?.focus();
          });
        }}
      >
        <BindingPicker
          prop={prop}
          blockLabel={blockLabel}
          document={document}
          nodeId={nodeId}
          services={services}
          current={undefined}
          entryLink={entryLink}
          onPick={picked => {
            pickedIn.current =
              trigger.current?.closest(".nx-inspector__fields") ?? null;
            const { op, bound } = pickOp(
              { document, nodeId, prop: prop.name, clearsOnBind, entryLink },
              picked,
              undefined
            );
            boundProp.current = bound;
            setOpen(false);
            if (op === null || !onApply(op)) {
              pickedIn.current = null;
              onRefused(EDIT_REFUSED);
              return;
            }
            onBound();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The prop types whose value, and so whose fallback, is plain text. */
const TEXT_PROP_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "url",
]);

/**
 * The bindable kinds whose value is plain text: text, and a link or an
 * address (`url` and `link` props both bind as "link").
 */
const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "link"]);

/** Whether a prop's fallback is written as text: by its type or its kind. */
function takesTextFallback(prop: EditableProp): boolean {
  return (
    TEXT_PROP_TYPES.has(prop.schema.type) ||
    TEXT_KINDS.has(bindablePropKind(prop.schema) ?? "")
  );
}

/** Said under a field where the editor refused the binding's edit. */
const EDIT_REFUSED = "The page refused this edit, so nothing changed.";

/** What the block names a prop, for a note naming another prop than the bound one. */
function blockPropLabel(
  document: BlockDocument,
  nodeId: string,
  name: string | undefined
): string | undefined {
  if (name === undefined) return undefined;
  const node = findNode(document.nodes, nodeId);
  const schema =
    node === undefined ? undefined : getBlock(node.type)?.props?.[name];
  return schema === undefined ? undefined : propLabel(name, schema);
}

/**
 * The chip menu's way to the field's source: a link, so it opens as one, in a
 * new tab with the editor kept and no hold on this window. Named with the
 * field, so the item says whose source it opens.
 */
function OpenSourceItem({
  href,
  field,
}: {
  href: string;
  field: string;
}): React.JSX.Element {
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden="true" size={14} />
        {`Open ${field}'s source`}
      </a>
    </DropdownMenuItem>
  );
}

/**
 * When a bound image's fallback is shown, in the words of its source and
 * field: "Shown when a post has no cover image." Said so only for one entry
 * of a collection (the page's own, or a list's item) and a field named in one
 * step; anywhere else, in the plain words that fit every binding.
 */
function fallbackShownWhen(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed",
  item: ItemSource | undefined,
  field: string
): string {
  const found =
    binding.source === undefined || binding.source === "entry"
      ? boundSource(binding, sources)?.label.toLowerCase()
      : undefined;
  const one = item?.one ?? found;
  // A path's names joined with "›" read badly inside a sentence.
  if (one === undefined || field.includes("›")) {
    return "Shown when the bound field has no image.";
  }
  const article = /^[aeiou]/i.test(one) ? "an" : "a";
  return `Shown when ${article} ${one} has no ${field.toLowerCase()}.`;
}

/**
 * A bound prop's rows under its chip, none for a binding following a
 * component's setting: composing fills it from the setting and drops it, so
 * neither a fallback nor a format it carried would ever show.
 */
function BoundRows(
  props: React.ComponentProps<typeof BoundValueRows>
): React.JSX.Element | null {
  return followsSetting(props.binding) ? null : <BoundValueRows {...props} />;
}

/** A bound prop's own rows under its chip: its Fallback, and its Format. */
function BoundValueRows({
  prop,
  binding,
  field,
  shownWhen,
  services,
  disabled,
  labelId,
  textFallback,
  onRebind,
}: {
  prop: EditableProp;
  binding: Binding;
  /** Whether a text fallback is offered where the prop's value is text. */
  textFallback: boolean;
  /** When an image's fallback is shown, said under its library picker. */
  shownWhen: string;
  /** The field the binding reads, once its source's fields are read. */
  field: NamedField | undefined;
  services: ContentServices | undefined;
  disabled: boolean;
  /** The id of the prop's name, which each row is about. */
  labelId: string;
  /** Write the binding with a new fallback or format. */
  onRebind: (next: Binding) => void;
}): React.JSX.Element {
  const kind = bindablePropKind(prop.schema);
  const fallback =
    "fallback" in binding && typeof binding.fallback === "string"
      ? binding.fallback
      : "";
  return (
    <>
      {kind === "image" ? (
        // An image's fallback: an address with its picture shown, or a file
        // chosen from the media library, shown by its name.
        <ImageBindingFallback
          binding={binding}
          shownWhen={shownWhen}
          services={services}
          disabled={disabled}
          describedBy={labelId}
          onFallback={next => onRebind(withFallback(binding, next))}
        />
      ) : textFallback && takesTextFallback(prop) ? (
        // A text input writes text: offered for a prop whose value is text
        // alone, so a number's, a choice's or a passage's fallback is never
        // rewritten.
        <FallbackInput
          describedBy={labelId}
          fallback={fallback}
          disabled={disabled}
          // A long-text prop keeps its fallback's line breaks.
          multiline={prop.schema.type === "textarea"}
          onCommit={next => onRebind(withFallback(binding, next))}
        />
      ) : null}
      {offersFormat(kind, field) ? (
        <BindingFormatField
          // Keyed by what the binding reads, so a rebind to another field
          // starts the row afresh: a currency picked but not yet given a code
          // belongs to the field it was picked for, not to the next one.
          key={`${binding.source ?? ""}:${binding.sourceKey ?? ""}:${binding.$bind}`}
          stored={binding.format}
          kind={kind}
          field={field}
          disabled={disabled}
          describedBy={labelId}
          onFormat={format => onRebind(withFormat(binding, format))}
        />
      ) : null}
    </>
  );
}

/**
 * The unbind of a bound prop: planned by the host against the document the
 * editor holds, then applied to the document as it is when the plan comes
 * back, so an edit made meanwhile stays; refused where the binding changed
 * meanwhile, and said where the plan could not be read.
 */
function useUnbind(args: {
  readonly nodeId: string;
  readonly prop: EditableProp;
  readonly binding: Binding;
  readonly document: BlockDocument;
  readonly services: ContentServices | undefined;
  /** Apply one op as an edit; `false` where the editor refused it. */
  readonly onApply: (op: BuilderOp) => boolean;
  readonly onUnbound: (note: UnbindNote) => void;
  readonly onRefused: (reason: string) => void;
  readonly note: (answer: UnbindAnswer) => string;
}): () => Promise<void> {
  // The document as the editor holds it now, read when a plan comes back.
  const latest = React.useRef(args.document);
  latest.current = args.document;
  // Whether the field is still drawn, and an unbind still being planned: a
  // plan answered after the field is gone (its prop already unbound) or a
  // second one asked meanwhile is dropped, since neither can see the
  // document as it is by then.
  const mounted = React.useRef(true);
  const pending = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { nodeId, prop, binding, services } = args;
  // A plan's answer, applied to the document as it is now: refused where it
  // is one, where the binding changed meanwhile, or where the editor refuses
  // the edit.
  const settle = (plan: UnbindPlanAnswer): void => {
    if ("refusal" in plan) {
      args.onRefused(plan.refusal);
      return;
    }
    const now = latest.current;
    const still = findNode(now.nodes, nodeId)?.bindings?.[prop.name];
    if (!sameJsonValue(still, binding)) {
      args.onRefused(
        "The binding changed while the unbind was planned. Unbind it again."
      );
      return;
    }
    const op = unbindOp(now, nodeId, prop.name, plan.kept);
    if (op === null || !args.onApply(op)) {
      args.onRefused(EDIT_REFUSED);
      return;
    }
    args.onUnbound({
      text: args.note(plan.answer),
      tone: plan.answer.unreadable === true ? "private" : "kept",
    });
  };
  return async () => {
    if (pending.current) return;
    pending.current = true;
    const plan = await planOf(services, {
      document: latest.current,
      nodeId,
      prop: prop.name,
    }).finally(() => {
      pending.current = false;
    });
    if (plan !== undefined && mounted.current) settle(plan);
  };
}

/**
 * The host's plan for an unbind; a refusal saying so where the plan could
 * not be read, and nothing where the host plans no unbinds.
 */
async function planOf(
  services: ContentServices | undefined,
  ask: UnbindAsk
): Promise<UnbindPlanAnswer | undefined> {
  try {
    return await services?.planUnbind?.(ask);
  } catch {
    return { refusal: "The unbind could not be planned. Try again." };
  }
}

/** A bound text prop's fallback, written when the field is left. */
function FallbackInput({
  describedBy,
  fallback,
  disabled,
  multiline,
  onCommit,
}: {
  describedBy: string;
  fallback: string;
  disabled: boolean;
  /** A textarea prop's: a one-line input would drop its line breaks. */
  multiline: boolean;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  const field = {
    id,
    defaultValue: fallback,
    disabled,
    title: fallback === "" ? undefined : `Fallback: ${fallback}`,
    "aria-describedby": describedBy,
    onBlur: (
      event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      const next = event.currentTarget.value;
      if (next !== fallback) onCommit(next);
    },
  };
  return (
    <div className="nx-binding__fallback">
      <label className="nx-binding__fallback-label" htmlFor={id}>
        Fallback
      </label>
      {/* Keyed by the stored value, so a value written elsewhere is shown. */}
      {multiline ? (
        <Textarea key={fallback} {...field} rows={3} />
      ) : (
        <Input key={fallback} {...field} />
      )}
    </div>
  );
}

/**
 * The bound chip: the field, then its source, cut source first where the
 * panel is narrow; the whole of both on its tooltip and in its name.
 */
const BoundChip = React.forwardRef<
  HTMLButtonElement,
  {
    id: string;
    label: string;
    whole: string;
    field: string;
    source: string | undefined;
    disabled: boolean;
    /** Whether it opens a menu; without one it is a label, with no chevron. */
    menu: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function BoundChip(
  { id, label, whole, field, source, disabled, menu, ...trigger },
  ref
) {
  if (!menu) {
    return (
      <p
        className="nx-binding-chip"
        data-binding-chip={id}
        role="group"
        aria-label={label}
        title={whole}
      >
        <Database aria-hidden="true" size={14} />
        <ChipText field={field} source={source} />
      </p>
    );
  }
  return (
    <button
      {...trigger}
      ref={ref}
      type="button"
      className="nx-binding-chip"
      data-binding-chip={id}
      aria-label={label}
      title={whole}
      disabled={disabled}
    >
      <Database aria-hidden="true" size={14} />
      <ChipText field={field} source={source} />
      <ChevronDown aria-hidden="true" size={14} />
    </button>
  );
});

/** The chip's words: the field, then its source, cut source first. */
function ChipText({
  field,
  source,
}: {
  field: string;
  source: string | undefined;
}): React.JSX.Element {
  return (
    <span className="nx-binding-chip__text">
      <span className="nx-binding-chip__field">{field}</span>
      {source === undefined ? null : (
        <span className="nx-binding-chip__source">
          {/* A no-break space: a flex item drops a leading plain one. */}
          {"\u00a0· "}
          {source}
        </span>
      )}
    </span>
  );
}

/** The chip's menu: change the field, where fields can be listed; unbind, where it can be planned. */
function ChipMenuItems({
  canChange,
  canUnbind,
  propName,
  source,
  onChange,
  onUnbind,
}: {
  canChange: boolean;
  canUnbind: boolean;
  propName: string;
  /** Where the field's source is edited, where the host has a screen for it. */
  source: { readonly href: string; readonly field: string } | undefined;
  onChange: () => void;
  onUnbind: () => void;
}): React.JSX.Element {
  return (
    <>
      {canChange ? (
        <DropdownMenuItem onSelect={onChange}>
          <Database aria-hidden="true" size={14} />
          Change field…
        </DropdownMenuItem>
      ) : null}
      {source === undefined ? null : (
        <OpenSourceItem href={source.href} field={source.field} />
      )}
      {canUnbind ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnbind}>
            <Unlink aria-hidden="true" size={14} />
            Unbind, keep the {propName.toLowerCase()}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * The bound chip and what it offers: a menu to change the field or unbind,
 * the change picker anchored to it, and focus given back to it when the
 * picker closes. With nothing to offer, the chip is a label with no menu.
 */
function ChipWithMenu({
  chip,
  canChange,
  canUnbind,
  propName,
  source,
  onUnbind,
  picker,
}: {
  chip: {
    id: string;
    label: string;
    whole: string;
    field: string;
    source: string | undefined;
    disabled: boolean;
  };
  canChange: boolean;
  canUnbind: boolean;
  propName: string;
  /** Where the field's source is edited, where the host has a screen for it. */
  source: { readonly href: string; readonly field: string } | undefined;
  onUnbind: () => void;
  /** The change picker, handed how to close itself. */
  picker: (close: () => void) => React.ReactNode;
}): React.JSX.Element {
  const chipRef = React.useRef<HTMLButtonElement>(null);
  const [changing, setChanging] = React.useState(false);
  if (!canChange && !canUnbind && source === undefined) {
    return <BoundChip {...chip} menu={false} />;
  }
  return (
    // The menu opens from the chip; "Change field" opens the picker at the
    // same place, anchored to it rather than triggered by it, so one press
    // never opens both.
    <Popover open={changing} onOpenChange={setChanging}>
      <DropdownMenu modal={false}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <BoundChip ref={chipRef} {...chip} menu />
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end" className="nx-binding-menu">
          <ChipMenuItems
            canChange={canChange}
            canUnbind={canUnbind}
            propName={propName}
            source={source}
            onChange={() => setChanging(true)}
            onUnbind={onUnbind}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="end"
        className="nx-binding-popover"
        // Anchored, not triggered, so Radix has no trigger to give focus back
        // to: it goes to the chip, which stays.
        onCloseAutoFocus={event => {
          const target = chipRef.current;
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {picker(() => setChanging(false))}
      </PopoverContent>
    </Popover>
  );
}

/** A bound prop: the chip, its menu, and the fallback a visitor sees without a value. */
function BoundField({
  nodeId,
  prop,
  blockLabel,
  binding,
  document,
  services,
  disabled,
  onApply,
  clearsOnBind,
  clearsLocked,
  entryLink,
  onUnbound,
}: Omit<BindingControlProps, "binding" | "children"> & {
  binding: Binding;
  onUnbound: (note: UnbindNote) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const { from, sources, item } = useBoundFrom(
    binding,
    document,
    nodeId,
    services
  );
  const name = propLabel(prop.name, prop.schema);
  const names = boundNames(binding, from, { prop: prop.name, entryLink });
  // Where "Open source" leads: the host's answer, absent where it has none.
  const sourceHref = services?.sourceHref?.(binding);
  // The whole of it, on the tooltip and in the accessible name: the chip
  // cuts the source first, then the field, where the panel is narrow.
  const whole =
    names.source === undefined
      ? names.field
      : `${names.field} of ${names.source.replace(/^(This|Each) /, word => word.toLowerCase())}`;
  const unbind = useUnbind({
    nodeId,
    prop,
    binding,
    document,
    services,
    onApply,
    onUnbound,
    onRefused: setRefusal,
    // An image kept by its address names the prop the address went into,
    // as the block labels it.
    note: answer =>
      noteFor(
        answer,
        blockLabel,
        name,
        names.field,
        blockPropLabel(document, nodeId, answer.into)
      ),
  });
  return (
    <div className="nx-inspector__field nx-binding" data-bound="">
      <p className="nx-inspector__field-name" id={labelId}>
        {name}
      </p>
      <div className="nx-binding__value">
        {/* The menu opens from the chip; "Change field" opens the picker at
            the same place, anchored to it rather than triggered by it, so
            one press never opens both. */}
        <ChipWithMenu
          chip={{
            id: `${nodeId}:${prop.name}`,
            label: `${name}: bound to ${whole}`,
            whole,
            field: names.field,
            source: names.source,
            disabled,
          }}
          canChange={
            services?.listBindingFields !== undefined &&
            !clearHeld(document, nodeId, clearsLocked)
          }
          canUnbind={services?.planUnbind !== undefined}
          propName={name}
          source={
            sourceHref === undefined
              ? undefined
              : { href: sourceHref, field: names.field }
          }
          onUnbind={() => void unbind()}
          picker={close => (
            <BindingPicker
              prop={prop}
              blockLabel={blockLabel}
              document={document}
              nodeId={nodeId}
              services={services}
              current={binding}
              entryLink={entryLink}
              onPick={picked => {
                const { op } = pickOp(
                  {
                    document,
                    nodeId,
                    prop: prop.name,
                    clearsOnBind,
                    entryLink,
                  },
                  picked,
                  binding
                );
                close();
                // A refusal said of the earlier field is no longer true; one
                // of this edit is said in its place.
                setRefusal(op !== null && onApply(op) ? null : EDIT_REFUSED);
              }}
            />
          )}
        />
        <BoundRows
          prop={prop}
          binding={binding}
          field={boundField(binding, from)}
          shownWhen={fallbackShownWhen(binding, sources, item, names.field)}
          services={services}
          disabled={disabled}
          labelId={labelId}
          // A link's entry id has no fallback a person could type: with no
          // entry read, the link keeps its own address.
          textFallback={prop.name !== entryLink?.id}
          // One write for the fallback and the format alike: the binding
          // replaced, as a pick replaces it.
          onRebind={next => {
            const op = bindOp(document, nodeId, prop.name, next);
            setRefusal(op !== null && onApply(op) ? null : EDIT_REFUSED);
          }}
        />
        {refusal === null ? null : (
          <UnboundNote note={{ text: refusal, tone: "refused" }} />
        )}
      </div>
    </div>
  );
}
