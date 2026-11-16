/**
 * Templates for a new collection, Single or field group: declarations of the
 * fields an entity starts with, offered in the new-entity dialog.
 *
 * Built-in templates and a plugin's are the same declaration. A plugin
 * contributes its own with `registerSchemaTemplates`, from its admin module, as
 * it contributes list columns; each registration returns its removal. What a
 * template needs (a collection a link points at, a field group a field uses)
 * is read from its fields, never declared beside them, so a declaration cannot
 * disagree with itself. A template is checked when it is picked
 * (`template-check`); declaring one writes nothing.
 *
 * @module lib/builder/schema-templates
 */
import { useSyncExternalStore } from "react";

import { BUILT_IN_TEMPLATES } from "./builtin-templates";

/** The kind of entity a template creates. */
export type SchemaTemplateKind = "collection" | "single" | "fieldGroup";

/**
 * One field a template adds, in the shape the Builder stores a field: a plain
 * declaration, with nothing to run.
 *
 * @experimental The Schema Builder's templates are being redesigned; this
 * shape may change before that work is complete.
 */
export interface SchemaTemplateField {
  /** The stored name: lower snake case, as the Builder names a field. */
  name: string;
  label?: string;
  /** A field type: one of the Builder's own, or one a plugin contributes. */
  type: string;
  required?: boolean;
  unique?: boolean;
  /** Keeps a value per language, in a translated entity. */
  localized?: boolean;
  defaultValue?: string | number | boolean;
  /** A dropdown's or radio group's choices. */
  options?: readonly { label: string; value: string }[];
  /** A link to entries: the collection it links to. */
  relationTo?: string;
  /** A link to entries holding several. */
  hasMany?: boolean;
  /** A field using a field group: the field group's address. */
  component?: string;
  /** A group's or repeating rows' own fields. */
  fields?: readonly SchemaTemplateField[];
  admin?: {
    description?: string;
    placeholder?: string;
    width?: "25%" | "33%" | "50%" | "66%" | "75%" | "100%";
  };
}

/**
 * A template: what it creates, how the gallery files and shows it, and the
 * fields it adds.
 *
 * @experimental The Schema Builder's templates are being redesigned; this
 * shape may change before that work is complete.
 */
export interface SchemaTemplate {
  /** Unique among one source's templates. */
  id: string;
  kind: SchemaTemplateKind;
  /**
   * For a collection or a Single where a plugin offers a choice of what
   * editors make: entries with fields, or pages designed visually. Absent is
   * entries.
   */
  makes?: "entries" | "pages";
  /** The gallery's category: "Content", "Commerce"… */
  category: string;
  name: string;
  description: string;
  /** A Lucide icon name, as the dialog's icon picker uses. */
  icon?: string;
  fields: readonly SchemaTemplateField[];
}

/** A template as the gallery offers it: who it comes from, null for built in. */
export interface OfferedTemplate {
  template: SchemaTemplate;
  source: string | null;
}

/** Each plugin's registrations, in the order made. */
let registered: readonly OfferedTemplate[] = [];
const listeners = new Set<() => void>();

function replace(next: readonly OfferedTemplate[]): void {
  registered = next;
  for (const listener of listeners) listener();
}

/**
 * Offer templates in the new-entity dialog, under `source`: the plugin's name
 * as the gallery shows it beside each one. Returns the registration's removal.
 *
 * @experimental The Schema Builder's templates are being redesigned; how a
 * plugin contributes them may change before that work is complete.
 */
export function registerSchemaTemplates(
  source: string,
  templates: readonly SchemaTemplate[]
): () => void {
  const added: readonly OfferedTemplate[] = templates.map(template => ({
    template,
    source,
  }));
  replace([...registered, ...added]);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    replace(registered.filter(each => !added.includes(each)));
  };
}

const BUILT_IN: readonly OfferedTemplate[] = BUILT_IN_TEMPLATES.map(
  template => ({ template, source: null })
);

/** Every template offered now: the built-in ones, then each plugin's. */
export function offeredTemplates(): readonly OfferedTemplate[] {
  return registered.length === 0 ? BUILT_IN : [...BUILT_IN, ...registered];
}

/** The plugins' registrations, for `useSyncExternalStore`. */
function snapshot(): readonly OfferedTemplate[] {
  return registered;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The templates offered for one kind, following every registration. */
export function useSchemaTemplates(
  kind: SchemaTemplateKind
): readonly OfferedTemplate[] {
  const plugins = useSyncExternalStore(subscribe, snapshot, snapshot);
  return [...BUILT_IN, ...plugins].filter(each => each.template.kind === kind);
}
