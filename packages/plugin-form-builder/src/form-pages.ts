/**
 * The form editor's pages, read by the plugin's declaration (which gives each
 * page its address) and by the editor (which draws a tab for each). One list,
 * so a tab cannot lead to an address nobody declared, nor an address go
 * without its tab.
 *
 * No React and no admin imports here: the server reads this module too.
 *
 * @module form-pages
 */

/**
 * The form editor, the forms collection's own edit view. The admin draws it at
 * the form's edit address and at each page's address below, so it stays
 * mounted, unsaved work and all, while a person moves between the tabs.
 */
export const FORM_EDITOR_VIEW =
  "@nextlyhq/plugin-form-builder/admin#FormBuilderView";

/** A page of the form editor. */
interface FormPage {
  /** What the editor calls it, and the tab's label. */
  readonly label: string;
  /**
   * The address segment after the form's own, or `undefined` for Builder,
   * which is the form's edit address itself.
   */
  readonly path: string | undefined;
}

/** One page's id: its address segment, or `"builder"` for the edit address. */
export type FormPageId =
  | "builder"
  | "preview"
  | "settings"
  | "notifications"
  | "submissions";

/** A page as the list spells it: its id's segment, or none for Builder. */
type DeclaredFormPage = FormPage & {
  readonly path: Exclude<FormPageId, "builder"> | undefined;
};

/** Every page, in the order the tabs show them. */
export const FORM_PAGES: readonly DeclaredFormPage[] = [
  { label: "Builder", path: undefined },
  { label: "Preview", path: "preview" },
  { label: "Settings", path: "settings" },
  { label: "Notifications", path: "notifications" },
  { label: "Submissions", path: "submissions" },
];

/** A page's id. */
export function formPageId(page: DeclaredFormPage): FormPageId {
  return page.path ?? "builder";
}

/**
 * The page an address segment names: Builder for none, or for a segment that
 * is not one of the editor's pages.
 */
export function formPageOf(view: string | undefined): FormPageId {
  const page = FORM_PAGES.find(
    each => each.path !== undefined && each.path === view
  );
  return page === undefined ? "builder" : formPageId(page);
}

/** The pages with an address of their own, for the plugin's declaration. */
export function addressedFormPages(): { path: string; label: string }[] {
  return FORM_PAGES.flatMap(page =>
    page.path === undefined ? [] : [{ path: page.path, label: page.label }]
  );
}
