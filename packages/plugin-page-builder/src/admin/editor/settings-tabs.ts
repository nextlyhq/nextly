/**
 * Page settings' tabs: their ids, which tab holds a field the page refused
 * to save, and how the field is found and focused once that tab is shown.
 * Its own module, free of the dialog, so the rule is testable on its own.
 *
 * @module admin/editor/settings-tabs
 */
import type { EntryFieldTab } from "@nextlyhq/plugin-sdk/admin";

/** The dialog's own first tab: the page's title, address and header & footer. */
export const GENERAL_TAB = "general";

/** The dialog's own second tab: every other field of the page. */
export const FIELDS_TAB = "fields";

/** The Code tab's value: the page's own code, last in the row. */
export const CODE_TAB = "code";

/** The plugin a contribution id belongs to: what comes before its first dot. */
function pluginOf(id: string): string {
  return id.split(".")[0] ?? id;
}

/**
 * Which Page settings tab shows a field, from where the entry page draws it,
 * or null where Page settings does not show it.
 *
 * - The document's identity (title, slug) is on General.
 * - The page's own content is on `contentTab`: Fields on a page, General on
 *   another document, and nowhere where nothing is left for Fields.
 * - A field a plugin's tab takes on the entry page is on that plugin's tab
 *   here, where the same plugin adds one: the entry page's tab and this
 *   dialog's are two contributions of one plugin, told apart by place.
 */
export function tabForField(
  where: EntryFieldTab | null,
  shown: { contentTab: string | null; placeTabs: readonly string[] }
): string | null {
  if (where === null) return null;
  if (where.kind === "page") return GENERAL_TAB;
  if (where.kind === "content") return shown.contentTab;
  const plugin = pluginOf(where.id);
  return shown.placeTabs.find(id => pluginOf(id) === plugin) ?? null;
}

/**
 * Whether a form path is in the field the builder is editing (`fieldName`,
 * itself or inside it, as `content.nodes.0`, or the named group around it):
 * that field is edited on the canvas, never in Page settings, so a save it
 * refused keeps the message's usual way to it.
 */
export function inEditedField(path: string, fieldName: string): boolean {
  return path.split(".")[0] === fieldName.split(".")[0];
}

/** What can take the focus inside a field's own wrapper. */
const FOCUSABLE =
  "input:not([type=hidden]), textarea, select, button, [tabindex]:not([tabindex='-1']), [contenteditable='true']";

/**
 * Focus the field at a form path inside `container`: inside the form's
 * wrapper for it (`data-field`), the control that edits it where one says so
 * (`data-field-control`, the address's Edit), else its first control; or the
 * input named by the path. Answers whether one took the focus.
 */
export function focusFieldIn(container: HTMLElement, path: string): boolean {
  // Quoted in the selector: only a quote or a backslash needs escaping there.
  const escaped = path.replace(/["\\]/g, "\\$&");
  const wrapper = container.querySelector<HTMLElement>(
    `[data-field="${escaped}"]`
  );
  const target =
    wrapper?.querySelector<HTMLElement>("[data-field-control]") ??
    wrapper?.querySelector<HTMLElement>(FOCUSABLE) ??
    container.querySelector<HTMLElement>(`[name="${escaped}"]`) ??
    wrapper;
  if (target === null || target === undefined) return false;
  target.scrollIntoView({ block: "center" });
  target.focus();
  return container.ownerDocument.activeElement === target;
}
