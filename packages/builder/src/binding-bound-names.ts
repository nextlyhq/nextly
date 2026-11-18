/**
 * The names a bound prop is said by: where its value comes from, the field's
 * own name and path, and the source a field outside the listed ones names.
 * `binding-controls.tsx` reads these for the chip and its menu, and
 * `useBoundFieldOf` answers the same for the image controls.
 *
 * @module binding-bound-names
 */
import type {
  Binding,
  BindingFieldShape,
  BlockDocument,
} from "@nextlyhq/blocks-engine";

import {
  choiceLabel,
  type EntryLink,
  type NamedField,
  sourceName,
} from "./binding-picker";
import { useBindingSources } from "./binding-picker-reads";
import type { BindingFieldSource } from "./binding-services";
import { settingBoundFrom } from "./binding-setting-source";
import type { ContentServices } from "./content-controls";
import { fieldLabel } from "./inspector";
import { useItemSource, type ItemSource } from "./item-binding-source";

/**
 * A bound path named segment by segment as the picker names it, through the
 * source's fields where they are read; a segment the source does not list is
 * named from its own key.
 */
function pathName(
  path: string,
  fields: readonly NamedField[] | undefined
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

/** The source a binding reads, once the sources are read and it is among them. */
export function boundSource(
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

/**
 * A source named from the binding alone, for one the host did not list: a
 * Single with nothing saved yet, or an entry it could not read. Named from
 * its key, so the chip still says where the field comes from.
 */
function unlistedSourceName(binding: Binding): string {
  if (binding.source === "single") return fieldLabel(binding.sourceKey);
  return binding.source === "site" ? "Site" : "This entry";
}

/** Where a binding reads, named, and that source's fields where they are read. */
interface BoundFrom {
  /** `undefined` only while the sources are being read. */
  readonly name: string | undefined;
  readonly fields: readonly NamedField[] | undefined;
  /**
   * Set where `$bind` names one field by its whole key, dots and all, as a
   * component's setting id does, rather than a path through its fields.
   */
  readonly whole?: true;
}

/**
 * Where a binding reads: a list's item from its list's collection, any other
 * source from the host's sources, and one the host did not list from the
 * binding itself once the sources are read.
 */
function boundFrom(
  binding: Binding,
  sources: readonly BindingFieldSource[] | "loading" | "failed",
  item: ItemSource | undefined
): BoundFrom {
  if (item !== undefined) return { name: item.name, fields: item.fields };
  const found = boundSource(binding, sources);
  if (found !== undefined) {
    return { name: sourceName(found), fields: found.fields };
  }
  return {
    name: sources === "loading" ? undefined : unlistedSourceName(binding),
    fields: undefined,
  };
}

/** The field a binding reads, named, and its source. */
export function boundNames(
  binding: Binding,
  from: BoundFrom,
  /** The bound prop, and the link it is the entry of, where it is one. */
  at: { readonly prop: string; readonly entryLink?: EntryLink | undefined }
): { readonly field: string; readonly source: string | undefined } {
  if (from.whole === true) {
    const field = boundField(binding, from);
    return {
      field: field === undefined ? binding.$bind : choiceLabel(field),
      source: from.name,
    };
  }
  // A link's entry is named by the relation it goes through ("Author"): the
  // entry the link goes to, not the id the binding reads of it.
  const segments = binding.$bind.split(".");
  const path =
    at.prop === at.entryLink?.id && segments.length > 1
      ? segments.slice(0, -1).join(".")
      : binding.$bind;
  return { field: pathName(path, from.fields), source: from.name };
}

/**
 * The field a binding reads, as its source lists it: one step into a
 * relation or a group at most, as a path may go. `undefined` until the
 * source's fields are read, and for a field they don't list.
 */
export function boundField(
  binding: Binding,
  from: BoundFrom
): NamedField | undefined {
  if (from.whole === true) {
    return from.fields?.find(field => field.name === binding.$bind);
  }
  const [first, inner, ...rest] = binding.$bind.split(".");
  if (rest.length > 0) return undefined;
  const top = from.fields?.find(field => field.name === first);
  if (inner === undefined) return top;
  return top?.fields?.find(field => field.name === inner);
}

/**
 * Where a bound prop reads, as the chip names it: the host's sources read
 * once, or the list's collection for an item, then `boundFrom`. The one way
 * the editor finds a binding's source, for the chip and for any control that
 * asks what the bound field is.
 */
export function useBoundFrom(
  binding: Binding,
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined
): {
  /** Where the binding reads, named, with its fields once they are read. */
  readonly from: BoundFrom;
  /** The host's sources as read, for what else is worded from them. */
  readonly sources: ReturnType<typeof useBindingSources>;
  /** The list's item source, for an item binding. */
  readonly item: ItemSource | undefined;
} {
  const sources = useBindingSources(services, true);
  const item = useItemSource(binding, document, nodeId, services);
  // A component's setting is named from the component itself.
  const from =
    settingBoundFrom(binding, document) ?? boundFrom(binding, sources, item);
  return { from, sources, item };
}

/**
 * The field a bound prop reads, as its source lists it: `undefined` while the
 * sources are read, and for a field they don't list. Derived from the same
 * source the chip names, so a control reading the field's type and the chip
 * naming it cannot disagree.
 */
export function useBoundFieldOf(
  binding: Binding,
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined
): Omit<BindingFieldShape, "fields"> | undefined {
  const { from } = useBoundFrom(binding, document, nodeId, services);
  return boundField(binding, from);
}
