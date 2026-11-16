/**
 * `@nextlyhq/admin/kit/document`: the document surfaces.
 *
 * What a plugin's document view, action or panel works with: the document's
 * values and actions, its panel, and the save and checkpoint hooks.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/document
 */
/**
 * Which document a field is rendered inside.
 *
 * Exported for the plugin surface: a contributed field that has to address the
 * document — to record against it, to query it, to link to it — cannot derive
 * that from the props a field receives, which name a value and nothing else.
 */
export {
  useDocumentIdentity,
  type DocumentIdentity,
} from "../components/features/entries/EntryForm/EntryFormContext";

/**
 * Which language the surrounding document is being edited in. Separate from the
 * identity for the same reason the status is: a document is the same document
 * in every language, so a consumer reading only the identity should not
 * re-render when the language changes.
 */
export {
  useDocumentLocale,
  type DocumentLocale,
} from "../components/features/entries/EntryForm/EntryFormContext";

/**
 * A field's address in its document, with a repeater's row named by its saved
 * id rather than its position. Exported for the plugin surface: a field that
 * links to a view of itself names itself by this, so the link opens the same
 * row however the rows are reordered.
 */
export {
  useFieldAddress,
  type FieldAddress,
} from "../components/features/entries/EntryForm/useFieldAddress";

/**
 * How the surrounding document stands, for a field that covers the editor's own
 * chrome. Separate from the identity deliberately: which document this is does
 * not change with the language, and how it stands does.
 */
export {
  useDocumentStatus,
  hasPendingWorkingDraft,
  type DocumentStatus,
} from "../components/features/entries/EntryForm/EntryFormContext";

/**
 * The surrounding document's full-page preview, for a field that shows the
 * page and offers to open it as the editor's own Preview action does. Null
 * wherever that action is absent.
 */
export {
  useDocumentPreview,
  type DocumentPreview,
} from "../components/features/entries/EntryForm/EntryFormContext";

/**
 * The fields an active takeover hid, for the surface that took the body over.
 *
 * A takeover collapses the form body to the takeover field alone, so the rest
 * of the entry is removed from the page rather than merely covered. Whatever
 * took the body over is the only surface left that can still show them.
 */
export { useEntryFieldsPanel } from "../components/features/entries/EntryForm/EntryFormContext";

/**
 * A field telling the form it holds work the form's values do not contain.
 *
 * Exported for the plugin surface: a contributed field with its own editing
 * state is invisible to the dirty flag everything else is derived from.
 */
export { useReportUnsavedWork } from "../components/features/entries/EntryForm/UnsavedWorkContext";

/**
 * The document's actions, for a surface drawn inside its editor: the actions
 * the header draws and running one with a true answer, the one save state,
 * committing work a surface holds before a save, and counting a write the
 * document depends on. Exported for the plugin surface: a document view
 * replaces the form body and its header with it.
 */
export {
  useDocumentActions,
  useBeforeDocumentAction,
  useTrackedWrite,
  type DocumentActions,
} from "../components/features/entries/EntryForm/useDocumentActionHooks";

export type {
  BeforeDocumentAction,
  DocumentActionOutcome,
  DocumentSaveState,
  StoreReadiness,
} from "../components/features/entries/EntryForm/useDocumentActionBindings";

export type {
  ActionGroup,
  ActionPlacement,
  DocumentAction,
} from "../components/features/entries/EntryForm/document-actions";

export type { SubmitRefusal } from "../components/features/entries/EntryForm/submit-outcome";

/**
 * The header's save state and leading action, drawn for a document view that
 * replaces the header. Exported for the plugin surface, so the view shows the
 * header's own controls rather than a copy of them.
 */
export {
  DocumentSaveIndicator,
  DocumentPrimaryAction,
} from "../components/features/entries/EntryForm/DocumentSurfaceControls";

/**
 * How a document view restores its own field from a recovery point, as an edit
 * it can undo. Exported for the plugin surface.
 */
export {
  useDocumentRestore,
  type DocumentRestoreHandler,
} from "../components/features/entries/EntryForm/DocumentRestoreContext";

export {
  pillStateFromForm,
  PILL_LABEL,
  type PillState,
} from "../components/features/entries/EntryForm/panels/DocumentPanel";

/**
 * Put a contributed surface's live state somewhere a crash cannot take it.
 *
 * Exported for the plugin surface alongside the identity above: a field holding
 * its own editing state has work at risk that the form cannot see, because that
 * state does not reach the form until the surface commits it.
 */
export {
  useDocumentCheckpoint,
  type UseDocumentCheckpointOptions,
  type UseDocumentCheckpointResult,
  type AutosaveStatus,
} from "../hooks/useDocumentCheckpoint";

export type { DocumentLockGates } from "../components/features/entries/EntryForm/document-lock-affordances";

/**
 * An admin place's renderer and its tab strip, for `plugin-sdk/admin`: a
 * plugin's own page draws the contributions sent to a place it declared with
 * the parts core's pages use.
 */
// A document's live values, for a plugin's component inside the editor.
export {
  useDocumentField,
  useDocumentValues,
  type DocumentField,
} from "../components/features/entries/EntryForm/document-values";
