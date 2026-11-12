/**
 * Client-free component paths shared by the fixture plugins' definitions,
 * loaded in a Node config context, and their admin components, loaded in the
 * browser, so `plugin.ts` never imports a client component.
 */

/** The quiet icon button the release notes fixture draws at the rail's foot. */
export const RELEASE_NOTES_BUTTON_PATH =
  "playground/item-place-fixture#ReleaseNotesButton";

/** The dialog body the What's new fixture's menu item opens. */
export const WHATS_NEW_DIALOG_PATH =
  "playground/item-place-fixture#WhatsNewDialogBody";
