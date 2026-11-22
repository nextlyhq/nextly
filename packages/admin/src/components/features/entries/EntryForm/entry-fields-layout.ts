/**
 * Where the entry page draws each of the document's fields, for a surface
 * that covers the page and draws them its own way: the document's identity
 * (title and slug), the page's own content, or a plugin's tab that takes the
 * field over (`fields` on the tab).
 *
 * A document view asks this to send an author to a field the page refused
 * to save, and to find the fields it draws in its own way (another editor of
 * the same kind) before it hands the rest to the entry's own renderer. It is
 * the same answer the entry page acts on, derived from the same fields: the
 * content the page draws, and the tabs drawn on it.
 *
 * @module components/features/entries/EntryForm/entry-fields-layout
 */
import {
  computeFieldsBeside,
  type LayoutField,
} from "@admin/lib/builder/takeoverLayout";

/** Where the entry page draws a field. */
export type EntryFieldTab =
  /** The document's identity: its title or its slug. */
  | { kind: "page" }
  /** The page's own content. */
  | { kind: "content" }
  /** A plugin's tab, by the contribution's id. */
  | { kind: "tab"; id: string };

/** A top-level field the page's own content draws, as a surface names it. */
export interface EntryContentField {
  name: string;
  /** The field's type, such as `"text"` or a plugin's own type. */
  type: string;
  /** The field's label as the form shows it, or its name where it has none. */
  label: string;
}

/** The entry page's layout of the document's fields. */
export interface EntryFieldsLayout {
  /**
   * Where the field at a form path (`"summary"`, `"seo.title"`,
   * `"sections.0.heading"`) is drawn: the tab holding the top-level field it
   * sits in. Null where the page draws it nowhere: a hidden field, one a
   * plugin's switch keeps off this type, or a path naming no field.
   */
  tabOf: (path: string) => EntryFieldTab | null;
  /** The top-level named fields the page's own content draws, in order. */
  contentFields: readonly EntryContentField[];
}

/** The fields drawn as the document's identity rather than its content. */
const IDENTITY_FIELDS = new Set(["title", "slug"]);

function isHidden(field: LayoutField): boolean {
  return field.admin?.hidden === true;
}

/**
 * Whether `name` is the value a top-level field holds at the form's root:
 * its own name, or, for a nameless field that only arranges others (a row),
 * the name of a field inside it, as the form stores those at the root.
 */
function holds(field: LayoutField, name: string): boolean {
  if (typeof field.name === "string") return field.name === name;
  return (field.fields ?? []).some(child => holds(child, name));
}

/** A content field as a surface names it, or none for a nameless one. */
function contentFieldOf(
  field: LayoutField & { label?: unknown }
): EntryContentField[] {
  if (typeof field.name !== "string") return [];
  return [
    {
      name: field.name,
      type: field.type ?? "",
      label: typeof field.label === "string" ? field.label : field.name,
    },
  ];
}

/**
 * The layout, from the document's fields, the content the page draws (its
 * fields less those a tab takes and those kept off the type), which tab
 * takes which top-level field, and the values the fields' conditions read.
 * The content's fields are the ones the renderer would draw now, by the same
 * rule (`computeFieldsBeside`): never a hidden one, or one whose condition
 * is false.
 */
export function entryFieldsLayout<F extends LayoutField & { label?: unknown }>(
  allFields: readonly F[],
  contentFields: F[],
  takenBy: ReadonlyMap<string, string>,
  values: Record<string, unknown> = {}
): EntryFieldsLayout {
  const drawn = new Set<LayoutField>(contentFields);
  return {
    tabOf: path => {
      const first = path.split(".")[0] ?? "";
      const holder = allFields.find(field => holds(field, first));
      if (holder === undefined || isHidden(holder)) return null;
      if (IDENTITY_FIELDS.has(first)) return { kind: "page" };
      const tab = takenBy.get(first);
      if (tab !== undefined) return { kind: "tab", id: tab };
      return drawn.has(holder) ? { kind: "content" } : null;
    },
    contentFields: computeFieldsBeside(
      contentFields,
      "",
      values
    ).content.flatMap(contentFieldOf),
  };
}
