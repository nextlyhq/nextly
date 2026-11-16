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
import type { BindingFieldSource } from "@nextlyhq/builder/ops";

/** Where the picker reads its fields, under this plugin's namespace. */
export const BINDING_FIELDS_ROUTE_PATH = "/binding-fields";

/** What the picker asks: the entry the page being edited shows. */
export interface BindingFieldsRequest {
  /**
   * The entry the document's entry bindings read: the page's own, or the
   * entry a template is previewed with. Without an id there is no entry to
   * read, and the entry's fields are not listed; absent for a component's
   * document, which has no entry of its own (it reads each placing page's),
   * and then only the Singles and the site are listed.
   */
  readonly source?: {
    readonly kind: "collection" | "single";
    readonly slug: string;
    readonly id?: string;
  };
  /** The language being edited. */
  readonly locale?: string;
}

/**
 * One field, and one source of fields, as the picker lists them: the
 * builder's shapes, which the editor reads them as.
 */
export type {
  BindingFieldChoice as PickerField,
  BindingFieldSource as PickerSource,
} from "@nextlyhq/builder/ops";

/** The sources, in the order the picker lists them: entry, Singles, site. */
export interface BindingFieldsResponse {
  readonly sources: readonly BindingFieldSource[];
}
