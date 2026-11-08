/**
 * The inspector's binding controls for one prop: a bind button beside a
 * bindable field, the picker it opens, and, once the prop is bound, a chip
 * naming the field, its fallback, and a menu to change the field or unbind.
 *
 * The picker lists only the fields that fit the prop, by the engine's own
 * rule (`canBindFieldToProp`), from what the host reads for the person
 * editing (`ContentServices.listBindingFields`): fields visitors may not read
 * say so, and a draft's value is marked rather than shown, in each option's
 * own text, so a screen reader announces both. An unbind is planned by the
 * host, by the decision the page actions API takes, and applied here as any
 * edit; the reason it gives is said under the field.
 *
 * @module binding-controls
 */
import {
  bindablePropKind,
  canBindFieldToProp,
  fieldFitsProp,
  findNode,
  sameJsonValue,
  type Binding,
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
import { Check, ChevronDown, Database, EyeOff, Unlink } from "lucide-react";
import * as React from "react";

import { bindOp, unbindOp } from "./binding-ops";
import type {
  BindingFieldChoice,
  BindingFieldSource,
  UnbindAsk,
  UnbindPlanAnswer,
} from "./binding-services";
import { ChoiceList, type ListedChoice } from "./choice-list";
import type { UnbindAnswer } from "./composition-actions";
import type { ContentServices } from "./content-controls";
import { fieldLabel, propLabel, type EditableProp } from "./inspector";

/** One field the picker offers, with where it is read from. */
interface FieldOption extends ListedChoice {
  readonly path: string;
  readonly source: BindingFieldSource;
  readonly field: BindingFieldChoice;
  /** The relation or group it sits in, named, for a field one step in. */
  readonly parent?: string;
}

/** The binding a pick writes: the path, and the source when not the entry. */
function bindingFor(option: FieldOption, kept: Binding | undefined): Binding {
  const source = option.source.binding;
  const fallback =
    kept !== undefined && "fallback" in kept ? { fallback: kept.fallback } : {};
  if (source.source === "single") {
    return {
      $bind: option.path,
      source: "single",
      sourceKey: source.sourceKey,
      ...fallback,
    };
  }
  return {
    $bind: option.path,
    ...(source.source === "entry" ? {} : { source: source.source }),
    ...fallback,
  };
}

/** The binding with `fallback` as its fallback; none when it is empty. */
function withFallback(binding: Binding, fallback: string): Binding {
  const rest = Object.fromEntries(
    Object.entries(binding).filter(([key]) => key !== "fallback")
  );
  return (fallback === "" ? rest : { ...rest, fallback }) as Binding;
}

/** Whether `option` is the field and source `binding` reads. */
function isBoundTo(option: FieldOption, binding: Binding): boolean {
  if (option.path !== binding.$bind) return false;
  const source = option.source.binding;
  if (source.source !== (binding.source ?? "entry")) return false;
  return (
    source.source !== "single" ||
    ("sourceKey" in binding && binding.sourceKey === source.sourceKey)
  );
}

/** A source's name as the chip and the picker say it: "This post", "Site". */
function sourceName(source: BindingFieldSource): string {
  return source.binding.source === "entry"
    ? `This ${source.label.toLowerCase()}`
    : source.label;
}

/**
 * The fields of `sources` that fit `prop`, one step into a relation or a
 * group, in the order the picker lists them. A relation or group whose own
 * value does not fit is not offered itself, only what is inside it.
 */
function fittingOptions(
  sources: readonly BindingFieldSource[],
  prop: EditableProp
): readonly FieldOption[] {
  const options: FieldOption[] = [];
  sources.forEach((source, index) => {
    const group = String(index);
    for (const field of source.fields) {
      const label = choiceLabel(field);
      if (fits(field, prop)) {
        options.push(option(source, group, field, field.name, label));
      }
      for (const inner of field.fields ?? []) {
        if (!fits(inner, prop)) continue;
        options.push(
          option(
            source,
            group,
            inner,
            `${field.name}.${inner.name}`,
            choiceLabel(inner),
            label
          )
        );
      }
    }
  });
  return options;
}

/**
 * Whether a field fills the prop as it is: one that needs a format to (a
 * date or a number into text) waits for the Format control, since a binding
 * without one shows its fallback.
 */
function fits(field: BindingFieldChoice, prop: EditableProp): boolean {
  return (
    canBindFieldToProp(field, prop.schema) && fieldFitsProp(field, prop.schema)
  );
}

/** One option, with its text as the list searches it and a reader hears it. */
function option(
  source: BindingFieldSource,
  group: string,
  field: BindingFieldChoice,
  path: string,
  label: string,
  parent?: string
): FieldOption {
  return {
    key: `${group}:${path}`,
    label: parent === undefined ? label : `${parent} › ${label}`,
    group,
    path,
    source,
    field,
    ...(parent === undefined ? {} : { parent }),
    search: [parent, label, field.preview].filter(Boolean).join(" "),
  };
}

/** The picker's row: the name, then the value as the author reads it, or why not. */
function OptionRow({ option }: { option: FieldOption }): React.JSX.Element {
  const { field } = option;
  return (
    <span className="nx-binding-option">
      <span className="nx-binding-option__name">
        {option.parent === undefined ? null : (
          <span className="nx-binding-option__parent">{option.parent} › </span>
        )}
        {choiceLabel(field)}
      </span>
      {/* Words, not a colour or an icon alone: each is part of the option's
          own text, so a screen reader announces it with the field. */}
      {!field.public ? (
        <span className="nx-binding-option__tag" data-tone="private">
          <EyeOff aria-hidden="true" size={12} />
          Not public
        </span>
      ) : field.draft === true ? (
        <span className="nx-binding-option__tag">Draft</span>
      ) : field.preview === undefined ? null : (
        <span className="nx-binding-option__preview">{field.preview}</span>
      )}
    </span>
  );
}

/** The fields a binding can read, as the host reads them; read once per open. */
function useBindingSources(
  services: ContentServices | undefined,
  wanted: boolean
): readonly BindingFieldSource[] | "loading" | "failed" {
  const [sources, setSources] = React.useState<
    readonly BindingFieldSource[] | "loading" | "failed"
  >("loading");
  const list = services?.listBindingFields;
  React.useEffect(() => {
    if (!wanted || list === undefined) return;
    let current = true;
    setSources("loading");
    list().then(
      read => {
        if (current) setSources(read);
      },
      () => {
        if (current) setSources("failed");
      }
    );
    return () => {
      current = false;
    };
  }, [list, wanted]);
  return sources;
}

/** The picker: the fitting fields by source, searched, moved through by key. */
function BindingPicker({
  prop,
  blockLabel,
  services,
  current,
  onPick,
}: {
  prop: EditableProp;
  blockLabel: string;
  services: ContentServices | undefined;
  /** The prop's binding when it has one, marked in the list. */
  current: Binding | undefined;
  onPick: (option: FieldOption) => void;
}): React.JSX.Element {
  const sources = useBindingSources(services, true);
  const name = propLabel(prop.name, prop.schema);
  if (sources === "loading") {
    return <p className="nx-binding-picker__note">Reading the fields…</p>;
  }
  if (sources === "failed") {
    return (
      <p className="nx-binding-picker__note" role="alert">
        The fields could not be read. Close this and try again.
      </p>
    );
  }
  const options = fittingOptions(sources, prop);
  // A source with nothing to offer this prop is not listed: an empty group
  // only lengthens the list.
  const offering = new Set(options.map(option => option.group));
  // A source the host could not read is said, above the fields that did.
  const failed = sources.filter(source => source.readFailed === true);
  return (
    <div className="nx-binding-picker">
      <ChoiceList
        choices={options}
        currentKey={
          current === undefined
            ? undefined
            : options.find(option => isBoundTo(option, current))?.key
        }
        onPick={onPick}
        label={`Fields for ${name}`}
        searchLabel="Find a field"
        noMatch="No field matches."
        groups={sources.flatMap((source, index) =>
          offering.has(String(index))
            ? [{ group: String(index), heading: sourceName(source) }]
            : []
        )}
        renderChoice={choice => <OptionRow option={choice} />}
        choiceTitle={choice =>
          choice.field.preview === undefined
            ? choice.label
            : `${choice.label}: ${choice.field.preview}`
        }
        searchFrom={0}
        leading={
          failed.length === 0 ? undefined : (
            <p className="nx-binding-picker__failed" role="status">
              {`Could not read ${failed.map(sourceName).join(", ")}. Close this and try again.`}
            </p>
          )
        }
      />
      <p className="nx-binding-picker__hint">
        {options.length === 0
          ? `No field can fill a ${blockLabel.toLowerCase()}'s ${name.toLowerCase()}.`
          : `Only fields a ${blockLabel.toLowerCase()}'s ${name.toLowerCase()} can show are listed.`}
      </p>
    </div>
  );
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
  /** Apply one op as an edit. */
  /** Apply one op as an edit; `false` where the editor refused it. */
  readonly onApply: (op: BuilderOp) => boolean;
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
  // with the chip: the picker is drawn in a portal, outside them.
  const pickedIn = React.useRef<Element | null>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="nx-binding-row__bind"
          aria-label={`Bind ${name} to a field`}
          title={`Bind ${name} to a field`}
          disabled={disabled}
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
                `[data-binding-chip="${CSS.escape(`${nodeId}:${prop.name}`)}"]`
              )
              ?.focus();
          });
        }}
      >
        <BindingPicker
          prop={prop}
          blockLabel={blockLabel}
          services={services}
          current={undefined}
          onPick={picked => {
            pickedIn.current =
              trigger.current?.closest(".nx-inspector__fields") ?? null;
            const op = bindOp(
              document,
              nodeId,
              prop.name,
              bindingFor(picked, undefined)
            );
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

/** Said under a field where the editor refused the binding's edit. */
const EDIT_REFUSED = "The page refused this edit, so nothing changed.";

/**
 * What an unbind said, and how: kept as visitors saw it, kept in place of a
 * field visitors can't read, or refused.
 */
interface UnbindNote {
  readonly text: string;
  readonly tone: "kept" | "private" | "refused";
}

/** The note an unbind leaves under its field. */
function UnboundNote({ note }: { note: UnbindNote }): React.JSX.Element {
  return (
    <p className="nx-binding-note" data-tone={note.tone} role="status">
      {note.tone === "kept" ? <Check aria-hidden="true" size={14} /> : null}
      {note.tone === "private" ? <EyeOff aria-hidden="true" size={14} /> : null}
      <span>
        {note.tone === "refused" ? note.text : `Unbound. ${note.text}`}
      </span>
    </p>
  );
}

/**
 * What an unbind kept, said as the author reads it: the block keeps what
 * visitors saw, the fallback, or its own value. The answer's own reason
 * says more, for an API client; the note says what changed on the page.
 */
function noteFor(
  answer: UnbindAnswer,
  blockLabel: string,
  propName: string,
  /** The bound field, named as the chip names it. */
  fieldName: string
): string {
  const block = `The ${blockLabel.toLowerCase()}`;
  const value =
    typeof answer.value === "string" && answer.value !== ""
      ? `: “${answer.value}”`
      : "";
  // A field visitors can't read: its value was never copied in, and the note
  // says so before what was kept in its place.
  if (answer.unreadable === true) {
    const unread = `Visitors can't read “${fieldName}”, so its value wasn't copied in.`;
    return answer.kept === "fallback"
      ? `${unread} ${block} keeps the fallback${value}.`
      : `${unread} ${block} keeps its own ${propName.toLowerCase()}.`;
  }
  switch (answer.kept) {
    case "visitor":
      return answer.into === undefined
        ? `${block} keeps what visitors saw${value}.`
        : `${block} keeps the image visitors saw, by its address.`;
    case "fallback":
      return `Visitors saw the fallback, so ${block.toLowerCase()} keeps it${value}.`;
    case "own":
      return `${block} keeps its own ${propName.toLowerCase()}.`;
    default:
      return `${block} keeps the value given${value}.`;
  }
}

/**
 * The name a field is listed by: the host's label where it gives one ("Site
 * URL"), else its stored name as a person reads it.
 */
function choiceLabel(field: BindingFieldChoice): string {
  return field.label ?? fieldLabel(field.name);
}

/**
 * A bound path named segment by segment as the picker names it, through the
 * source's fields where they are read; a segment the source does not list is
 * named from its own key.
 */
function pathName(
  path: string,
  fields: readonly BindingFieldChoice[] | undefined
): string {
  const names: string[] = [];
  let level = fields;
  for (const segment of path.split(".")) {
    const field = level?.find(candidate => candidate.name === segment);
    names.push(field === undefined ? fieldLabel(segment) : choiceLabel(field));
    level = field?.fields;
  }
  return names.join(" › ");
}

/** The field a binding reads, named, and its source, once the sources are read. */
function boundNames(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed"
): { readonly field: string; readonly source: string | undefined } {
  const path = binding.$bind;
  if (typeof sources === "string") {
    return { field: pathName(path, undefined), source: undefined };
  }
  const wanted = binding.source ?? "entry";
  const found = sources.find(
    candidate =>
      candidate.binding.source === wanted &&
      (candidate.binding.source !== "single" ||
        ("sourceKey" in binding &&
          candidate.binding.sourceKey === binding.sourceKey))
  );
  return {
    field: pathName(path, found?.fields),
    source: found === undefined ? undefined : sourceName(found),
  };
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
  onChange,
  onUnbind,
}: {
  canChange: boolean;
  canUnbind: boolean;
  propName: string;
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
  onUnbind: () => void;
  /** The change picker, handed how to close itself. */
  picker: (close: () => void) => React.ReactNode;
}): React.JSX.Element {
  const chipRef = React.useRef<HTMLButtonElement>(null);
  const [changing, setChanging] = React.useState(false);
  if (!canChange && !canUnbind) return <BoundChip {...chip} menu={false} />;
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
  onUnbound,
}: Omit<BindingControlProps, "binding" | "children"> & {
  binding: Binding;
  onUnbound: (note: UnbindNote) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const sources = useBindingSources(services, true);
  const name = propLabel(prop.name, prop.schema);
  const names = boundNames(binding, sources);
  // The whole of it, on the tooltip and in the accessible name: the chip
  // cuts the source first, then the field, where the panel is narrow.
  const whole =
    names.source === undefined
      ? names.field
      : `${names.field} of ${names.source.replace(/^This /, "this ")}`;
  const unbind = useUnbind({
    nodeId,
    prop,
    binding,
    document,
    services,
    onApply,
    onUnbound,
    onRefused: setRefusal,
    note: answer => noteFor(answer, blockLabel, name, names.field),
  });
  const fallback =
    "fallback" in binding && typeof binding.fallback === "string"
      ? binding.fallback
      : "";
  // A text input writes text: offered for a prop whose value is text alone,
  // so a number's, a choice's or a passage's fallback is never rewritten.
  const textFallback = TEXT_PROP_TYPES.has(prop.schema.type);
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
          canChange={services?.listBindingFields !== undefined}
          canUnbind={services?.planUnbind !== undefined}
          propName={name}
          onUnbind={() => void unbind()}
          picker={close => (
            <BindingPicker
              prop={prop}
              blockLabel={blockLabel}
              services={services}
              current={binding}
              onPick={picked => {
                const op = bindOp(
                  document,
                  nodeId,
                  prop.name,
                  bindingFor(picked, binding)
                );
                close();
                // A refusal said of the earlier field is no longer true; one
                // of this edit is said in its place.
                setRefusal(op !== null && onApply(op) ? null : EDIT_REFUSED);
              }}
            />
          )}
        />
        {!textFallback ? null : (
          <FallbackInput
            describedBy={labelId}
            fallback={fallback}
            disabled={disabled}
            multiline={prop.schema.type === "textarea"}
            onCommit={next => {
              const op = bindOp(
                document,
                nodeId,
                prop.name,
                withFallback(binding, next)
              );
              setRefusal(op !== null && onApply(op) ? null : EDIT_REFUSED);
            }}
          />
        )}
        {refusal === null ? null : (
          <UnboundNote note={{ text: refusal, tone: "refused" }} />
        )}
      </div>
    </div>
  );
}
