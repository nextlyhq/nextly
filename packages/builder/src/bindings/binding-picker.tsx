/**
 * The picker a bind button opens: the fields that fit the prop, grouped by
 * where they come from, each option's row and title, the list item's own
 * fields first inside a collection list, and the edit a pick makes.
 * `binding-controls.tsx` mounts it, for the bind button and for changing the
 * field a bound prop reads.
 *
 * @module binding-picker
 */
import {
  bindablePropKind,
  canBindFieldToProp,
  fieldFitsProp,
  findNode,
  isPlainRecord,
  type Binding,
  type BindingFieldShape,
  type BindingFormat,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { EyeOff } from "lucide-react";
import * as React from "react";

import {
  ChoiceList,
  type ChoiceGroup,
  type ListedChoice,
} from "../choice-list";
import { useClickedEntries } from "../clicked-entry";
import type { ContentServices } from "../content-controls";
import { fieldLabel, propLabel, type EditableProp } from "../inspector";
import { withArticle } from "../with-article";

import { defaultFormatFor, previewWithFormat } from "./binding-format-field";
import { bindOp } from "./binding-ops";
import {
  useBindingSources,
  useListSamples,
  usePreviewFormatIn,
  useSamplePictures,
  type PreviewFormatIn,
} from "./binding-picker-reads";
import type {
  BindingFieldChoice,
  BindingFieldSource,
  ListSample,
} from "./binding-services";
import {
  settingSource,
  SettingsReach,
  type SettingSource,
} from "./binding-setting-source";
import {
  itemChoices,
  useListItems,
  type ItemSource,
} from "./item-binding-source";

/**
 * A source the picker lists: one the host lists, or the item of the list the
 * block sits in, which only the editor knows and the picker lists first, or,
 * in a component, its own settings, listed before both.
 */
type PickerSource =
  | (Omit<BindingFieldSource, "binding"> & {
      readonly binding:
        | BindingFieldSource["binding"]
        | {
            readonly source: "item";
            /** An enclosing list further out than the nearest, by its id. */
            readonly list?: string;
          };
    })
  | SettingSource;

/** One field the picker offers, with where it is read from. */
interface FieldOption extends ListedChoice {
  readonly path: string;
  readonly source: PickerSource;
  readonly field: BindingFieldChoice;
  /** The relation or group it sits in, named, for a field one step in. */
  readonly parent?: string;
  /**
   * The format a pick writes, for a date or a number filling a text prop,
   * which reaches it only through one; named in the option.
   */
  readonly format?: { readonly label: string; readonly format: BindingFormat };
}

/**
 * A link's props, where the prop being bound is a link's destination: its
 * address and the two halves of the entry reference it follows first.
 */
export interface EntryLink {
  readonly link: string;
  readonly collection: string;
  readonly id: string;
  /**
   * Whether a related entry's pick may be written where the block sits: it
   * writes both halves of the reference and removes the address's binding,
   * so it is offered only where all three may change.
   */
  readonly writable: boolean;
}

/** The edit a pick makes, and the prop it binds, whose chip is drawn after. */
interface PickEdit {
  readonly op: BuilderOp | null;
  readonly bound: string;
}

/**
 * The edit a pick makes. A related entry's id fills the link's entry: its
 * collection is set to the relation's in the same edit, since a pick writes
 * both halves of the reference at once, and a stored entry id is emptied.
 * The address the link was bound to is unbound, since the entry replaces it,
 * as is a bound collection, which would otherwise overlay the one set,
 * and its fallback is not carried over, being an address rather than an id;
 * the address stored on the block is kept, so the link still goes there
 * where the entry is not read. Any other pick binds `prop`, emptying
 * `clearsOnBind`.
 */
export function pickOp(
  at: {
    readonly document: BlockDocument;
    readonly nodeId: string;
    readonly prop: string;
    readonly clearsOnBind: readonly string[] | undefined;
    readonly entryLink: EntryLink | undefined;
  },
  picked: FieldOption,
  kept: Binding | undefined
): PickEdit {
  const entry = at.entryLink;
  const collection = picked.field.linksTo;
  if (entry === undefined || collection === undefined) {
    const op = bindOp(
      at.document,
      at.nodeId,
      at.prop,
      pickedBinding(picked, kept),
      at.clearsOnBind
    );
    return { op, bound: at.prop };
  }
  const op = bindOp(
    at.document,
    at.nodeId,
    entry.id,
    pickedBinding(picked, at.prop === entry.id ? kept : undefined),
    [entry.id],
    {
      set: { [entry.collection]: collection },
      // The collection is set, so a binding of it, which the page would fill
      // over the value set, goes too.
      unbind: [entry.link, entry.collection],
    }
  );
  return { op, bound: entry.id };
}

/**
 * The binding a pick writes; for a component's setting, its id alone:
 * composing fills it from the setting and drops it, so a fallback or format
 * carried over from the field it replaces would never be read.
 */
function pickedBinding(
  option: FieldOption,
  kept: Binding | undefined
): Binding {
  return option.source.binding.source === "setting"
    ? { $bind: option.path, source: "setting" }
    : bindingFor(option, kept);
}

/**
 * The binding a pick writes: the path, the source when not the entry, and
 * the format the option names, where it names one.
 */
function bindingFor(option: FieldOption, kept: Binding | undefined): Binding {
  const source = option.source.binding;
  // The fallback is kept across a change of field, and the option's format
  // is written with the pick, so a date or a number shows from the start.
  const carried = {
    ...(kept !== undefined && "fallback" in kept
      ? { fallback: kept.fallback }
      : {}),
    ...(option.format === undefined ? {} : { format: option.format.format }),
  };
  if (source.source === "single") {
    return {
      $bind: option.path,
      source: "single",
      sourceKey: source.sourceKey,
      ...carried,
    };
  }
  return {
    $bind: option.path,
    ...(source.source === "entry" ? {} : { source: source.source }),
    ...("list" in source && source.list !== undefined
      ? { list: source.list }
      : {}),
    ...carried,
  };
}

/**
 * Whether a bind would empty a prop that may not be written: one of
 * `locked` the block holds. A held bind is not offered; one that would empty
 * nothing is, whatever the lock.
 */
export function clearHeld(
  document: BlockDocument,
  nodeId: string,
  locked: readonly string[] | undefined
): boolean {
  if (locked === undefined || locked.length === 0) return false;
  const props = findNode(document.nodes, nodeId)?.props;
  return (
    isPlainRecord(props) && locked.some(name => Object.hasOwn(props, name))
  );
}

/** Whether `option` is the field and source `binding` reads. */
function isBoundTo(option: FieldOption, binding: Binding): boolean {
  if (option.path !== binding.$bind) return false;
  const source = option.source.binding;
  if (source.source !== (binding.source ?? "entry")) return false;
  if (source.source === "item") {
    return (
      (source.list ?? undefined) ===
      ("list" in binding ? binding.list : undefined)
    );
  }
  return (
    source.source !== "single" ||
    ("sourceKey" in binding && binding.sourceKey === source.sourceKey)
  );
}

/**
 * A binding as the picker matches it: one naming the nearest list (`list`)
 * reads what one naming no list reads, so it is matched as that.
 */
function asListed(binding: Binding, nearest: string | undefined): Binding {
  if (!("list" in binding) || binding.list !== nearest) return binding;
  const { list: _nearest, ...rest } = binding;
  return rest;
}

/**
 * A source's name as the chip and the picker say it: "This post", "Site", and
 * for a list's item the name its group was given ("Each post").
 */
export function sourceName(source: PickerSource): string {
  return source.binding.source === "entry"
    ? `This ${source.label.toLowerCase()}`
    : source.label;
}

/**
 * A source's group in the picker, by which source it is rather than where it
 * is listed: the list item's group, drawn once the list's fields are read,
 * then moves no other group's options, so a search or an option the author
 * is on keeps its place.
 */
function groupOf(source: PickerSource): string {
  const at = source.binding;
  if (at.source === "single") return `single:${at.sourceKey}`;
  return at.source === "item" && at.list !== undefined
    ? `item:${at.list}`
    : at.source;
}

/** The option `binding` reads, marked in the list. */
function boundOption(
  options: readonly FieldOption[],
  binding: Binding
): FieldOption | undefined {
  return options.find(option => isBoundTo(option, binding));
}

/**
 * The picker's groups, in the sources' order: each that offers a field
 * (`offering`), a Single and the site folded while `folding`, except the
 * group kept `open`.
 */
function pickerGroups(
  sources: readonly PickerSource[],
  offering: ReadonlySet<string | undefined>,
  fold: { readonly folding: boolean; readonly open: string | undefined }
): ChoiceGroup[] {
  return sources.flatMap(source => {
    const group = groupOf(source);
    if (!offering.has(group)) return [];
    return [pickerGroup(source, fold.folding && group !== fold.open)];
  });
}

/** What choosing a folded Single or the site does, said to a screen reader. */
const FOLD_HINT = "Shows its fields here.";

/**
 * A source's group in the picker: headed by its name, and, `folded`, a
 * Single or the site drawn as one row ("Homepage", "Site settings") under
 * "Singles · Site", which opens it in place.
 */
function pickerGroup(source: PickerSource, folded: boolean): ChoiceGroup {
  const group = { group: groupOf(source), heading: sourceName(source) };
  const at = source.binding.source;
  if (!folded || (at !== "single" && at !== "site")) return group;
  return {
    ...group,
    fold:
      at === "single"
        ? { heading: "Singles", label: source.label, hint: FOLD_HINT }
        : { heading: "Site", label: "Site settings", hint: FOLD_HINT },
  };
}

/**
 * The fields of `sources` that fit `prop`, one step into a relation or a
 * group, in the order the picker lists them. A relation or group whose own
 * value does not fit is not offered itself, only what is inside it. A value
 * shown formatted is formatted in `formatIn`, as the page's render formats it.
 *
 * A related entry's id (`linksTo`) is offered only for a link, whose entry it
 * fills; the link's entry id, bound, is changed only to another such id.
 */
function fittingOptions(
  sources: readonly PickerSource[],
  prop: EditableProp,
  formatIn: PreviewFormatIn,
  entryLink: EntryLink | undefined
): readonly FieldOption[] {
  // A related entry is offered only where visitors may read it: a link
  // bound to one they can't read never goes there, so it is not a choice.
  const offered = (field: BindingFieldChoice): boolean =>
    field.linksTo !== undefined
      ? entryLink?.writable === true && field.public
      : prop.name !== entryLink?.id && fits(field, prop);
  const options: FieldOption[] = [];
  sources.forEach(source => {
    const group = groupOf(source);
    for (const field of source.fields) {
      const label = choiceLabel(field);
      if (offered(field)) {
        options.push(
          withFormatOnBind(
            option(source, group, field, field.name, label),
            prop,
            formatIn
          )
        );
      }
      for (const inner of field.fields ?? []) {
        if (!offered(inner)) continue;
        options.push(
          withFormatOnBind(
            option(
              source,
              group,
              inner,
              `${field.name}.${inner.name}`,
              choiceLabel(inner),
              label
            ),
            prop,
            formatIn
          )
        );
      }
    }
  });
  return options;
}

/**
 * The picker's options: a component's settings first, already judged for the
 * prop by the save's own rule (see {@link settingSource}), then the fields of
 * every other source that fit it.
 */
function pickerOptions(
  sources: readonly PickerSource[],
  prop: EditableProp,
  formatIn: PreviewFormatIn,
  entryLink: EntryLink | undefined
): readonly FieldOption[] {
  const settings = sources.filter(
    source => source.binding.source === "setting"
  );
  const others = sources.filter(source => source.binding.source !== "setting");
  return [
    ...settings.flatMap(source =>
      source.fields.map(field =>
        option(source, groupOf(source), field, field.name, choiceLabel(field))
      )
    ),
    ...fittingOptions(others, prop, formatIn, entryLink),
  ];
}

/**
 * Whether a field fills the prop: as it is, or, for a date or a number into
 * text, with the format a pick writes (see {@link formatOnBind}). One that
 * fills it neither way is not offered, since a binding to it shows its
 * fallback.
 */
function fits(field: BindingFieldChoice, prop: EditableProp): boolean {
  return (
    canBindFieldToProp(field, prop.schema) &&
    (fieldFitsProp(field, prop.schema) ||
      formatOnBind(field, prop) !== undefined)
  );
}

/**
 * The format a pick of `field` writes: the inspector's starting preset where
 * the field fills the prop only through a format, none where it fills it as
 * it is.
 */
function formatOnBind(
  field: BindingFieldChoice,
  prop: EditableProp
): FieldOption["format"] {
  if (fieldFitsProp(field, prop.schema)) return undefined;
  return defaultFormatFor(bindablePropKind(prop.schema), field);
}

/**
 * An option with the format its pick writes, where it writes one, its value
 * previewed in that format in `formatIn`: the page's language and the site's
 * time zone.
 */
function withFormatOnBind(
  choice: FieldOption,
  prop: EditableProp,
  formatIn: PreviewFormatIn
): FieldOption {
  const format = formatOnBind(choice.field, prop);
  if (format === undefined) return choice;
  const { preview } = choice.field;
  if (preview === undefined) return { ...choice, format };
  // Its value as the pick will show it, in the format the option names.
  const shown = previewWithFormat(
    preview,
    format.format,
    bindablePropKind(prop.schema),
    choice.field,
    formatIn
  );
  return {
    ...choice,
    format,
    field: { ...choice.field, preview: shown },
    search: [choice.label, shown].join(" "),
  };
}

/** One option, with its text as the list searches it and a reader hears it. */
function option(
  source: PickerSource,
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
    // A related entry whose collection has no page yet is listed, said why,
    // and can't be picked: the link would find no page to go to.
    ...(field.noPageFor === undefined ? {} : { disabled: true }),
    search: [parent, label, field.preview].filter(Boolean).join(" "),
  };
}

/**
 * A row's tooltip: its name, then why it can't be picked yet, or the value
 * as the author reads it, whole where the row cuts it short.
 */
function optionTitle(option: FieldOption): string {
  const { field } = option;
  if (field.noPageFor !== undefined) {
    return `${option.label}: No page for ${field.noPageFor} yet`;
  }
  return field.preview === undefined
    ? option.label
    : `${option.label}: ${field.preview}`;
}

/**
 * A thumbnail's address, where it is one a picture may be drawn from: the
 * site's own path or a web address, never a script's.
 */
function drawableThumbnail(address: string | undefined): string | undefined {
  if (address === undefined) return undefined;
  return /^(?:https?:\/\/|\/(?!\/))/i.test(address) ? address : undefined;
}

/**
 * A picture's value, small, before its name; the name says what it is, so
 * the picture itself is not read out.
 */
function Thumbnail({
  address,
}: {
  address: string | undefined;
}): React.JSX.Element | null {
  const drawn = drawableThumbnail(address);
  return drawn === undefined ? null : (
    <img
      className="nx-binding-option__thumb"
      src={drawn}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * A readable field's value as the author reads it: its text, or "(empty)"
 * for one holding nothing, with a draft's marked.
 */
function ShownValue({
  field,
}: {
  field: BindingFieldChoice;
}): React.JSX.Element {
  return (
    <>
      {field.preview !== undefined ? (
        <span className="nx-binding-option__preview">{field.preview}</span>
      ) : field.empty === true ? (
        <span className="nx-binding-option__preview nx-binding-option__empty">
          (empty)
        </span>
      ) : null}
      {/* A draft's value is shown with the word beside it, so the author
          sees the real value and knows it isn't live yet. */}
      {field.draft === true ? (
        <span className="nx-binding-option__tag">Draft</span>
      ) : null}
    </>
  );
}

/** The picker's row: the name, then the value as the author reads it, or why not. */
function OptionRow({ option }: { option: FieldOption }): React.JSX.Element {
  const { field } = option;
  return (
    <span className="nx-binding-option">
      <Thumbnail address={field.thumbnail} />
      <span className="nx-binding-option__name">
        {option.parent === undefined ? null : (
          <span className="nx-binding-option__parent">{option.parent} › </span>
        )}
        {choiceLabel(field)}
      </span>
      {/* The format a pick writes, said quietly beside the name and read
          with it, so the author knows the value will be formatted. */}
      {option.format === undefined ? null : (
        <span className="nx-binding-option__tag">{option.format.label}</span>
      )}
      {/* Words, not a colour or an icon alone: each is part of the option's
          own text, so a screen reader announces it with the field. */}
      {field.noPageFor !== undefined ? (
        // Why a related entry can't be picked yet, in words read with it.
        <span className="nx-binding-option__tag">
          {`No page for ${field.noPageFor} yet`}
        </span>
      ) : !field.public ? (
        <span className="nx-binding-option__tag" data-tone="private">
          <EyeOff aria-hidden="true" size={12} />
          Not public
        </span>
      ) : (
        <ShownValue field={field} />
      )}
    </span>
  );
}

/**
 * A list's item as a source the picker lists, named for the list's entries
 * ("Each post in the list"): the nearest list's first, binding no list, then
 * each list further out, binding it by its id.
 */
function itemPickerSource(
  item: ItemSource,
  nearest: boolean,
  sample: ListSample | undefined,
  pictures: ReadonlyMap<string, string>
): PickerSource {
  const list = item.list?.id;
  return {
    binding:
      nearest || list === undefined
        ? { source: "item" }
        : { source: "item", list },
    label: item.name,
    fields: itemChoices(item.fields, sample, undefined, pictures),
  };
}

/**
 * The item of every list the block sits in, nearest first, as picker
 * sources: each list's fields, with the values of the entry the author
 * clicked on the canvas to select the block, else the first entry's, and the
 * pictures they name by id. `loading` while a list's fields are being read.
 */
function useItemPickerSources(
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined
): {
  readonly sources: readonly PickerSource[];
  readonly loading: boolean;
  readonly nearest: string | undefined;
} {
  const items = useListItems(document, nodeId, services, true);
  const clicked = useClickedEntries(nodeId);
  const samples = useListSamples(
    services?.readListSample,
    items.flatMap(item => {
      const list = item.list;
      if (list === undefined) return [];
      const entry = clicked?.get(list.id);
      return [{ props: list.props, ...(entry === undefined ? {} : { entry }) }];
    })
  );
  const pictures = useSamplePictures(
    services?.readMedia,
    items.map((item, index) => ({
      fields: item.fields,
      sample: samples[index],
    }))
  );
  return {
    sources: items.map((item, index) =>
      itemPickerSource(
        item,
        index === 0,
        samples[index],
        pictures[index] ?? new Map()
      )
    ),
    loading: items.some(item => item.loading),
    nearest: items[0]?.list?.id,
  };
}

/**
 * The picker: the fitting fields by source, nearest first (the list item a
 * block sits in, then the page, its Singles and the site, the last two
 * folded while an item is listed), each with its value, searched, moved
 * through by key.
 */
export function BindingPicker({
  prop,
  blockLabel,
  document,
  nodeId,
  services,
  current,
  entryLink,
  onPick,
}: {
  prop: EditableProp;
  blockLabel: string;
  /** The document the block is in, where its list is found. */
  document: BlockDocument;
  nodeId: string;
  services: ContentServices | undefined;
  /** The link's entry, where the prop is a link's destination. */
  entryLink: EntryLink | undefined;
  /** The prop's binding when it has one, marked in the list. */
  current: Binding | undefined;
  onPick: (option: FieldOption) => void;
}): React.JSX.Element {
  const listed = useBindingSources(services, true);
  const items = useItemPickerSources(document, nodeId, services);
  const settings = settingSource(document, nodeId, prop, entryLink?.id);
  const formatIn = usePreviewFormatIn(services);
  const name = propLabel(prop.name, prop.schema);
  // The list's fields are waited for with the page's, so the groups are
  // drawn once, in their order, rather than the item's arriving above.
  if (listed === "loading" || items.loading) {
    return <p className="nx-binding-picker__note">Reading the fields…</p>;
  }
  if (listed === "failed") {
    return (
      <p className="nx-binding-picker__note" role="alert">
        The fields could not be read. Close this and try again.
      </p>
    );
  }
  return (
    <PickerBody
      // A component's settings first, as nearest of all, then the lists'.
      sources={[
        ...(settings === undefined ? [] : [settings]),
        ...items.sources,
        ...listed,
      ]}
      nearest={settings !== undefined || items.sources.length > 0}
      prop={prop}
      name={name}
      blockLabel={blockLabel}
      formatIn={formatIn}
      entryLink={entryLink}
      current={
        current === undefined ? undefined : asListed(current, items.nearest)
      }
      onPick={onPick}
    />
  );
}

/**
 * The picker's list once its sources are read: the fitting fields by
 * source, the field bound now marked, a Single and the site folded while a
 * list's item is listed (`nearest`), and the hint under it.
 */
function PickerBody({
  sources,
  nearest,
  prop,
  name,
  blockLabel,
  formatIn,
  entryLink,
  current,
  onPick,
}: {
  sources: readonly PickerSource[];
  nearest: boolean;
  prop: EditableProp;
  name: string;
  blockLabel: string;
  formatIn: PreviewFormatIn;
  entryLink: EntryLink | undefined;
  current: Binding | undefined;
  onPick: (option: FieldOption) => void;
}): React.JSX.Element {
  // Previewed in the page's language and the site's zone.
  const options = pickerOptions(sources, prop, formatIn, entryLink);
  // A source with nothing to offer this prop is not listed: an empty group
  // only lengthens the list.
  const offering = new Set(options.map(option => option.group));
  // A source the host could not read is said, above the fields that did.
  const failed = sources.filter(source => source.readFailed === true);
  const marked =
    current === undefined ? undefined : boundOption(options, current);
  return (
    <div className="nx-binding-picker">
      <ChoiceList
        choices={options}
        currentKey={marked?.key}
        onPick={onPick}
        label={`Fields for ${name}`}
        searchLabel="Find a field"
        noMatch="No field matches."
        groups={pickerGroups(sources, offering, {
          // Folded while a list's item is nearer, except the source the
          // prop is bound to now, which is shown marked.
          folding: nearest,
          open: marked?.group,
        })}
        renderChoice={choice => <OptionRow option={choice} />}
        choiceTitle={optionTitle}
        searchFrom={0}
        leading={
          <PickerLeading
            failed={failed}
            // A component's settings' group is keyed by its source.
            settings={offering.has("setting")}
          />
        }
      />
      <p className="nx-binding-picker__hint">
        {options.length === 0
          ? `No field can fill ${withArticle(blockLabel.toLowerCase())}'s ${name.toLowerCase()}.`
          : `Only fields ${withArticle(blockLabel.toLowerCase())}'s ${name.toLowerCase()} can show are listed.`}
      </p>
    </div>
  );
}

/**
 * What the picker says between its search and its rows: how many pages use
 * the component, over its settings where they are listed, and a source the
 * host could not read.
 */
function PickerLeading({
  failed,
  settings,
}: {
  failed: readonly PickerSource[];
  settings: boolean;
}): React.JSX.Element {
  return (
    <>
      {settings ? <SettingsReach /> : null}
      {failed.length === 0 ? null : (
        <p className="nx-binding-picker__failed" role="status">
          {`Could not read ${failed.map(sourceName).join(", ")}. Close this and try again.`}
        </p>
      )}
    </>
  );
}

/** A field as the chip names it and a format judges it, wherever it was read. */
export type NamedField = Omit<BindingFieldShape, "fields"> & {
  readonly label?: string;
  readonly fields?: readonly NamedField[];
};

/**
 * The name a field is listed by: the host's label where it gives one ("Site
 * URL"), else its stored name as a person reads it.
 */
export function choiceLabel(field: NamedField): string {
  return field.label ?? fieldLabel(field.name);
}
