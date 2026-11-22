/**
 * The pin action's id among a document's actions: what a document view that
 * replaces the editor's header (the page builder's menu) finds and runs it by,
 * so it offers the entry page's own action, with its toast and Undo, rather
 * than a copy.
 *
 * A module of its own, importing nothing, so the plugin surface that
 * re-exports the id takes none of the pin action's queries with it.
 *
 * @module components/features/dashboard/pin-action-id
 */
export const PIN_TO_DASHBOARD_ACTION = "pin-to-dashboard";
