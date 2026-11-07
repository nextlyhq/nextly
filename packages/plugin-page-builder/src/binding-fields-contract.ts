/**
 * What the binding fields route takes and answers, named where both ends can
 * read it.
 *
 * The inspector's field picker lists, for the page being edited, the fields a
 * binding can read: the entry's, each Single's and the site settings', a
 * relation's own fields one step in. Each is listed only where the person
 * editing may read it, with what a visitor would see of it: whether the
 * public may read it, and a short preview of its value, read as the person
 * editing reads it. Which fields fit a prop is the picker's to judge, by the
 * engine's own rule.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives.
 *
 * @module binding-fields-contract
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";

/** Where the picker reads its fields, under this plugin's namespace. */
export const BINDING_FIELDS_ROUTE_PATH = "/binding-fields";

/** What the picker asks: the entry the page being edited shows. */
export interface BindingFieldsRequest {
  /**
   * The entry the document's entry bindings read: the page's own, or the
   * entry a template is previewed with. Without an id there is no entry to
   * read, and the entry's fields are not listed.
   */
  readonly source: {
    readonly kind: "collection" | "single";
    readonly slug: string;
    readonly id?: string;
  };
  /** The language being edited. */
  readonly locale?: string;
}

/** One field a binding can read, as the picker lists it. */
export interface PickerField extends BindingFieldShape {
  /** Whether a visitor may read it; a binding to one shows its fallback. */
  readonly public: boolean;
  /**
   * The start of its value, as the person editing reads it. Absent for a
   * field visitors can't read, an empty one, one whose value is not text, a
   * number or a yes-or-no, and one whose value is a draft's.
   */
  readonly preview?: string;
  /** Set when the value differs from what the published entry holds. */
  readonly draft?: true;
  /** A relation's own fields, one step in, as the entry it names holds them. */
  readonly fields?: readonly PickerField[];
}

/** One source of bound values, as the picker groups its fields. */
export interface PickerSource {
  /** How a binding names the source. */
  readonly binding:
    | { readonly source: "entry" }
    | { readonly source: "single"; readonly sourceKey: string }
    | { readonly source: "site" };
  /** The source's name: a collection's or a Single's label. */
  readonly label: string;
  readonly fields: readonly PickerField[];
}

/** The sources, in the order the picker lists them: entry, Singles, site. */
export interface BindingFieldsResponse {
  readonly sources: readonly PickerSource[];
}
