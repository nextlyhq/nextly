/**
 * What the editor's two form routes take and answer, named where both ends
 * can read it: the forms a Form block's "Form: <pick a form>" lists, and one
 * picked form as the canvas draws it.
 *
 * Both are read as the person editing: a provider lists and describes what
 * that person may see, and nothing else travels.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives.
 *
 * @module forms/editor-forms-contract
 */
import type { FormDescription, FormListing } from "@nextlyhq/plugin-sdk/blocks";

/** Where the Form block's picker reads the site's forms. */
export const EDITOR_FORMS_ROUTE_PATH = "/forms/editor/list";

/** Where the canvas reads one picked form. */
export const EDITOR_FORM_ROUTE_PATH = "/forms/editor/describe";

/** The query names the describe route reads. */
export const EDITOR_FORM_PARAMS = {
  provider: "provider",
  ref: "ref",
  locale: "locale",
} as const;

/** One provider other than the simple form, with the forms it lists. */
export interface EditorFormProvider {
  readonly id: string;
  /** What authors read: "Forms" in "Fields … come from Forms." */
  readonly label: string;
  /**
   * The forms the person editing may pick, as the provider lists them for
   * that person. Empty where the provider failed to list them: the picker
   * still knows the provider is installed.
   */
  readonly forms: readonly FormListing[];
}

/** What the list route answers: every provider the site has. */
export interface EditorFormsResponse {
  readonly providers: readonly EditorFormProvider[];
}

/**
 * One picked form, as the canvas draws it for its author.
 *
 * - `published` and `draft`: drawn from its description, as a visitor will
 *   see it once it is published.
 * - `closed`: it takes no answers now; a visitor reads `message` in its
 *   place.
 * - `missing`: there is none by that reference for this person: deleted, or
 *   from a provider the site no longer has.
 */
export type EditorFormResponse =
  | {
      readonly state: "published" | "draft";
      readonly drawing: FormDescription;
    }
  | { readonly state: "closed"; readonly message?: string }
  | { readonly state: "missing" };
