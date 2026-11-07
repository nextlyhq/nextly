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
  findNode,
  getBlock,
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
} from "@nextlyhq/ui";
import {
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  EyeOff,
  Unlink,
} from "lucide-react";
import * as React from "react";

import { BindingFormatField, offersFormat } from "./binding-format-field";
import { bindOp, unbindOp } from "./binding-ops";
import type {
  BindingFieldChoice,
  BindingFieldSource,
} from "./binding-services";
import { ChoiceList, type ListedChoice } from "./choice-list";
import type { UnbindAnswer } from "./composition-actions";
import type { ContentServices } from "./content-controls";
import { ImageBindingFallback } from "./image-binding-fallback";
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

/** The binding with `format` as its format, through the same write as a fallback. */
function withFormat(binding: Binding, format: BindingFormat): Binding {
  return { ...binding, format };
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
      const label = fieldLabel(field.name);
      if (canBindFieldToProp(field, prop.schema)) {
        options.push(option(source, group, field, field.name, label));
      }
      for (const inner of field.fields ?? []) {
        if (!canBindFieldToProp(inner, prop.schema)) continue;
        options.push(
          option(
            source,
            group,
            inner,
            `${field.name}.${inner.name}`,
            fieldLabel(inner.name),
            label
          )
        );
      }
    }
  });
  return options;
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
        {fieldLabel(field.name)}
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
  current: string | undefined;
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
        currentKey={current}
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
  readonly onApply: (op: BuilderOp) => void;
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
  if (!bindable) return <>{children}</>;
  return (
    <div className="nx-binding-row">
      <div className="nx-binding-row__field">{children}</div>
      <BindButton {...props} onBound={() => setNote(null)} />
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
}: BindingControlProps & { onBound: () => void }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const name = propLabel(prop.name, prop.schema);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
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
          const row = (event.target as HTMLElement | null)?.closest(
            ".nx-inspector__fields"
          );
          const chip = row?.querySelector<HTMLElement>(
            `[data-binding-chip="${CSS.escape(`${nodeId}:${prop.name}`)}"]`
          );
          if (chip === null || chip === undefined) return;
          event.preventDefault();
          chip.focus();
        }}
      >
        <BindingPicker
          prop={prop}
          blockLabel={blockLabel}
          services={services}
          current={undefined}
          onPick={picked => {
            const op = bindOp(
              document,
              nodeId,
              prop.name,
              bindingFor(picked, undefined)
            );
            if (op !== null) onApply(op);
            onBound();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What an unbind said: the reason, and whether it was refused. */
interface UnbindNote {
  readonly text: string;
  readonly refused: boolean;
}

/** The note an unbind leaves under its field. */
function UnboundNote({ note }: { note: UnbindNote }): React.JSX.Element {
  return (
    <p
      className="nx-binding-note"
      data-tone={note.refused ? "refused" : "kept"}
      role="status"
    >
      {note.refused ? null : <Check aria-hidden="true" size={14} />}
      <span>{note.refused ? note.text : `Unbound. ${note.text}`}</span>
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
  intoLabel?: string
): string {
  const block = `The ${blockLabel.toLowerCase()}`;
  const value =
    typeof answer.value === "string" && answer.value !== ""
      ? `: “${answer.value}”`
      : "";
  // An image kept by its address goes to another prop than the one unbound,
  // which is left empty, so the note names where the address went.
  if (answer.into !== undefined) {
    const into = intoLabel ?? fieldLabel(answer.into);
    switch (answer.kept) {
      case "visitor":
        return `Visitors saw an image address, not a library image, so it's kept in ${into}.`;
      case "fallback":
        return `Visitors saw the fallback, an image address, so it's kept in ${into}.`;
      default:
        return `The address given is kept in ${into}.`;
    }
  }
  switch (answer.kept) {
    case "visitor":
      return `${block} keeps what visitors saw${value}.`;
    case "fallback":
      return `Visitors saw the fallback, so ${block.toLowerCase()} keeps it${value}.`;
    case "own":
      return `${block} keeps its own ${propName.toLowerCase()}.`;
    default:
      return `${block} keeps the value given${value}.`;
  }
}

/** The source a binding reads, once the sources are read and it is among them. */
function boundSource(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed"
): BindingFieldSource | undefined {
  if (typeof sources === "string") return undefined;
  const wanted = binding.source ?? "entry";
  return sources.find(
    candidate =>
      candidate.binding.source === wanted &&
      (candidate.binding.source !== "single" ||
        ("sourceKey" in binding &&
          candidate.binding.sourceKey === binding.sourceKey))
  );
}

/** The field a binding reads, named, and its source, once the sources are read. */
function boundNames(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed"
): { readonly field: string; readonly source: string | undefined } {
  const field = binding.$bind.split(".").map(fieldLabel).join(" › ");
  const found = boundSource(binding, sources);
  return { field, source: found === undefined ? undefined : sourceName(found) };
}

/**
 * The field a binding reads, as the picker listed it: one step into a
 * relation or a group at most, as a path may go. `undefined` until the
 * sources are read, and for a field they don't list.
 */
function boundField(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed"
): BindingFieldChoice | undefined {
  const [first, inner, ...rest] = binding.$bind.split(".");
  if (rest.length > 0) return undefined;
  const top = boundSource(binding, sources)?.fields.find(
    field => field.name === first
  );
  if (inner === undefined) return top;
  return top?.fields?.find(field => field.name === inner);
}

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

/** A bound prop's own rows under its chip: its Fallback, and its Format. */
function BoundValueRows({
  prop,
  binding,
  field,
  services,
  disabled,
  labelId,
  onRebind,
}: {
  prop: EditableProp;
  binding: Binding;
  /** The field the binding reads, once the sources are read. */
  field: BindingFieldChoice | undefined;
  services: ContentServices | undefined;
  disabled: boolean;
  /** The id of the prop's name, which each row is about. */
  labelId: string;
  /** Write the binding with a new fallback or format. */
  onRebind: (next: Binding) => void;
}): React.JSX.Element {
  const kind = bindablePropKind(prop.schema);
  return (
    <>
      {kind === "image" ? (
        // An image's fallback is an address, with its picture shown.
        <ImageBindingFallback
          binding={binding}
          services={services}
          disabled={disabled}
          describedBy={labelId}
          onFallback={next => onRebind(withFallback(binding, next))}
        />
      ) : (
        <TextFallback
          binding={binding}
          disabled={disabled}
          labelId={labelId}
          onFallback={next => onRebind(withFallback(binding, next))}
        />
      )}
      {offersFormat(kind, field) ? (
        <BindingFormatField
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

/** A bound prop's Fallback as text, committed when the field is left. */
function TextFallback({
  binding,
  disabled,
  labelId,
  onFallback,
}: {
  binding: Binding;
  disabled: boolean;
  labelId: string;
  onFallback: (next: string) => void;
}): React.JSX.Element {
  const fallbackId = React.useId();
  const fallback =
    "fallback" in binding && typeof binding.fallback === "string"
      ? binding.fallback
      : "";
  return (
    <div className="nx-binding__fallback">
      <label className="nx-binding__fallback-label" htmlFor={fallbackId}>
        Fallback
      </label>
      <Input
        id={fallbackId}
        key={fallback}
        defaultValue={fallback}
        disabled={disabled}
        title={fallback === "" ? undefined : `Fallback: ${fallback}`}
        aria-describedby={labelId}
        onBlur={event => {
          const next = event.currentTarget.value;
          if (next !== fallback) onFallback(next);
        }}
      />
    </div>
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
  const [changing, setChanging] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const sources = useBindingSources(services, true);
  const name = propLabel(prop.name, prop.schema);
  const names = boundNames(binding, sources);
  // Where "Open source" leads: the host's answer, absent where it has none.
  const sourceHref = services?.sourceHref?.(binding);
  // The whole of it, on the tooltip and in the accessible name: the chip
  // cuts the source first, then the field, where the panel is narrow.
  const whole =
    names.source === undefined
      ? names.field
      : `${names.field} of ${names.source.replace(/^This /, "this ")}`;
  const unbind = async (): Promise<void> => {
    const plan = await services?.planUnbind?.({
      document,
      nodeId,
      prop: prop.name,
    });
    if (plan === undefined) return;
    if ("refusal" in plan) {
      setRefusal(plan.refusal);
      return;
    }
    const op = unbindOp(document, nodeId, prop.name, plan.kept);
    if (op === null) return;
    onApply(op);
    const into = blockPropLabel(document, nodeId, plan.answer.into);
    onUnbound({
      text: noteFor(plan.answer, blockLabel, name, into),
      refused: false,
    });
  };
  return (
    <div className="nx-inspector__field nx-binding" data-bound="">
      <p className="nx-inspector__field-name" id={labelId}>
        {name}
      </p>
      <div className="nx-binding__value">
        {/* The menu opens from the chip; "Change field" opens the picker at
            the same place, anchored to it rather than triggered by it, so
            one press never opens both. */}
        <Popover open={changing} onOpenChange={setChanging}>
          <DropdownMenu modal={false}>
            <PopoverAnchor asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="nx-binding-chip"
                  data-binding-chip={`${nodeId}:${prop.name}`}
                  aria-label={`${name}: bound to ${whole}`}
                  title={whole}
                  disabled={disabled}
                >
                  <Database aria-hidden="true" size={14} />
                  <span className="nx-binding-chip__text">
                    <span className="nx-binding-chip__field">
                      {names.field}
                    </span>
                    {names.source === undefined ? null : (
                      <span className="nx-binding-chip__source">
                        {/* A no-break space: a flex item drops a
                            leading plain one. */}
                        {"\u00a0· "}
                        {names.source}
                      </span>
                    )}
                  </span>
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
              </DropdownMenuTrigger>
            </PopoverAnchor>
            <DropdownMenuContent align="end" className="nx-binding-menu">
              <DropdownMenuItem onSelect={() => setChanging(true)}>
                <Database aria-hidden="true" size={14} />
                Change field…
              </DropdownMenuItem>
              {sourceHref === undefined ? null : (
                <OpenSourceItem href={sourceHref} field={names.field} />
              )}
              {services?.planUnbind === undefined ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void unbind()}>
                    <Unlink aria-hidden="true" size={14} />
                    Unbind, keep the {name.toLowerCase()}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <PopoverContent align="end" className="nx-binding-popover">
            <BindingPicker
              prop={prop}
              blockLabel={blockLabel}
              services={services}
              current={undefined}
              onPick={picked => {
                const op = bindOp(
                  document,
                  nodeId,
                  prop.name,
                  bindingFor(picked, binding)
                );
                if (op !== null) onApply(op);
                setChanging(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <BoundValueRows
          prop={prop}
          binding={binding}
          field={boundField(binding, sources)}
          services={services}
          disabled={disabled}
          labelId={labelId}
          // One write for the fallback and the format alike: the binding
          // replaced, as a pick replaces it.
          onRebind={next => {
            const op = bindOp(document, nodeId, prop.name, next);
            if (op !== null) onApply(op);
          }}
        />
        {refusal === null ? null : (
          <UnboundNote note={{ text: refusal, refused: true }} />
        )}
      </div>
    </div>
  );
}
