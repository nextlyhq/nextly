/**
 * What Page settings show of a page's own code, decided on its own so the
 * rule is testable apart from the dialog.
 *
 * @module admin/editor/page-code-shown
 */
import type { DocumentCode } from "@nextlyhq/blocks-engine";

/**
 * Whether the builder's field can hold page code: a page's own top-level
 * field, as the server keeps it. One in a group, a list's row or a field
 * group is refused code on every save, so no tab offers to add it.
 */
export function holdsPageCode(fieldName: string): boolean {
  return !fieldName.includes(".") && !fieldName.includes("[");
}

/**
 * - `tab`: the Code tab, for someone who may change the site's settings;
 * - `line`: General's line that the page adds code, for anyone else, where
 *   it does;
 * - `none`: nothing.
 */
export type PageCodeShown = "tab" | "line" | "none";

/**
 * What Page settings show of `held`, the page's code, and of `css`, its own
 * CSS, to this person.
 */
export function pageCodeShown(args: {
  held: DocumentCode | undefined;
  css?: string | undefined;
  mayManageSite: boolean;
}): PageCodeShown {
  if (args.mayManageSite) return "tab";
  const adds =
    (args.held?.head ?? "") !== "" ||
    (args.held?.body ?? "") !== "" ||
    (args.css ?? "") !== "";
  return adds ? "line" : "none";
}
