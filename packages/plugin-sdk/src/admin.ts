/**
 * @nextlyhq/plugin-sdk/admin — the author-facing surface for plugin admin UI
 * (D19/D43). Register the React components referenced by `contributes.admin`
 * (menu/pages/settings/views) here, in a module imported by the Nextly admin
 * shell (which provides `@nextlyhq/admin` + React).
 *
 * @public Graduated in P9 — `plugin-form-builder` exercises the menu/pages/views
 *   registration. Dashboard widgets (`PluginAdminWidget`, D22) remain
 *   `@experimental` until M8. See `STABILITY.md`.
 */
export {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/admin";

/**
 * Which document the surrounding form is editing, or `null` outside one
 * (@experimental).
 *
 * A field component receives a name and a control and nothing that says which
 * document it is inside, so anything addressing the document itself — a
 * recovery point, a related query, a link — had no way to ask. `null` is an
 * ordinary answer rather than an error: field components also render in
 * previews and pickers, which have no document.
 */
export { useDocumentIdentity, type DocumentIdentity } from "@nextlyhq/admin";
export type { ComponentPath } from "@nextlyhq/admin";

/**
 * Which language the surrounding document is being edited in (@experimental).
 *
 * A field inside a localized document can say WHICH document it is in but not
 * which language its value belongs to, so anything keyed per language — a
 * per-language draft, a translation memory, a language-scoped preview — had no
 * way to ask.
 *
 * Separate from `useDocumentIdentity` rather than folded into it: a document's
 * identity is the same whichever language you read it in, and widening the
 * identity would re-render every consumer of it on a language switch.
 *
 * `null` means the language is not knowable here — outside a form, and inside
 * one that carries no locale context, such as an embedded quick-edit. It is an
 * ordinary answer to handle, not an error.
 */
export { useDocumentLocale, type DocumentLocale } from "@nextlyhq/admin";

/**
 * How the surrounding document stands (@experimental).
 *
 * For a field that covers the editor's own chrome — the page builder takes the
 * whole window — leaving an author no way to see whether the page is live.
 *
 * Separate from `useDocumentIdentity` rather than folded into it: a document's
 * identity is the same whichever language you read it in, and its status is
 * not. This answers for the language being edited.
 *
 * It reports FACTS. What to call a published document with local edits is
 * `pillStateFromForm`'s question, because only the caller knows whether IT has
 * unsaved work — a surface holding its own document outside the form is not
 * described by the form's dirty flag.
 */
export {
  useDocumentStatus,
  pillStateFromForm,
  PILL_LABEL,
  type DocumentStatus,
  type PillState,
} from "@nextlyhq/admin";

/**
 * Tell the surrounding form this surface holds unsaved work (@experimental).
 *
 * For a field that keeps its own editing state rather than writing through the
 * form — the page builder holds its block document and commits on exit — so the
 * form's dirty flag stays false while real work is outstanding, and everything
 * derived from it is wrong together: the navigation guard does not warn, the
 * save shortcut declines, and the header shows nothing pending.
 *
 * It reports ONE BOOLEAN about itself. It cannot save, publish, or write to the
 * form; the form still decides what to do about it. Retracted automatically
 * when the surface unmounts.
 */
export { useReportUnsavedWork } from "@nextlyhq/admin";

/**
 * Render the entry's remaining fields inside a takeover surface (@experimental).
 *
 * A field whose type is registered as a TAKEOVER collapses the form body to
 * itself, so an entry edited through one has its SEO, its relations and its
 * custom fields removed from the page — not merely covered. This returns a
 * renderer for exactly those, so the surface that took the body over can offer
 * them back without the author leaving it.
 *
 * Null when nothing is hidden, which is a different answer from a renderer that
 * draws nothing: the first means offer no panel, the second means offer an
 * empty one. A shell that reserves width to display nothing reads as a broken
 * control rather than an absent feature.
 *
 * The renderer is built from the FORM'S OWN control, so what the surface draws
 * and what the form submits are one thing. Constructing a second form would
 * fork the state and lose the edit made in whichever copy did not save.
 */
export { useEntryFieldsPanel } from "@nextlyhq/admin";

/**
 * Record a recovery point for the surrounding document (@experimental).
 *
 * For a contributed field that holds its own editing state — a canvas, a
 * diagram, an editor with its own history — whose work the form cannot see
 * until the surface commits it. The caller passes the WHOLE document as it
 * believes it stands (its own live value merged over the form's other values),
 * because restoring a recovery point replaces the form's values wholesale, and
 * calls `schedule()` when its state has changed in a way worth keeping.
 *
 * Whether recording is permitted at all is the entity owner's setting and is
 * enforced on the server; a refusal is not retried, and nothing here needs to
 * ask.
 */
export {
  useDocumentCheckpoint,
  type UseDocumentCheckpointOptions,
  type UseDocumentCheckpointResult,
  type AutosaveStatus,
} from "@nextlyhq/admin";

/**
 * Token-driven layout primitives (@experimental). Compose plugin admin UI from
 * these so it inherits the admin's design system with no plugin build step:
 * `Card` (+ its parts) for surfaces, `Stack`/`Grid` for layout, `Stat` for
 * labelled metrics. Prefer these over raw utilities; reach for the Layer-2
 * safelist next, and a plugin's own `admin.styles` only for the rest.
 */
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  Stack,
  Grid,
  Stat,
} from "@nextlyhq/admin";
export type {
  CardProps,
  StackProps,
  GridProps,
  StatProps,
} from "@nextlyhq/admin";

/**
 * Ask the admin to hide its own chrome while an immersive surface is mounted
 * (@experimental) — a full-bleed editor, a media browser, a preview mode.
 *
 * Scoped to the mount rather than to a route: the request is released when the
 * component unmounts, so navigating away restores the chrome with nothing to
 * undo. `canExit` must state whether this surface renders its own way back to
 * the admin, DERIVED from the affordance rather than asserted beside it — the
 * primary navigation rail is only ever hidden for a surface that can be left.
 */
export { useSuppressAdminChrome } from "@nextlyhq/admin";
export type { AdminChromeLayer } from "@nextlyhq/admin";

/**
 * The unified admin data table + its extension points (@experimental). Render
 * `DataTable` (batteries-included) or `DataTableView` (controlled) to match the
 * admin's lists, and contribute cell renderers, columns, column transforms, and
 * row/bulk actions to any list. Contributions are keyed by a list `target`: a
 * collection slug, a fixed key like `"users"`/`"media"`, or `"*"` for all lists.
 */
export {
  DataTable,
  DataTableView,
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
} from "@nextlyhq/admin";
export type {
  DataTableProps,
  DataTableViewProps,
  DataTableSelection,
  DataTableTarget,
  DataTableContext,
  ColumnProvider,
  ColumnTransform,
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
} from "@nextlyhq/admin";

/**
 * The field-UI kit (@experimental): controlled, form-library-agnostic
 * field-building components rendered from `nextly/field-catalog`. Each has a
 * narrow, storage-agnostic contract that never exposes admin internals, so a
 * plugin can build a field editor without importing from `@nextlyhq/admin`:
 * - `FieldTypePicker` — catalog-driven type grid; pass your surface's allowed
 *   `types` or pre-narrowed `entries`.
 * - `FieldOptionsEditor` — an option list with drag reorder, auto-generated
 *   values, CSV/JSON import, and whole-batch duplicate reporting;
 *   `withOptionIds` seeds drag ids onto plain `{label,value}` data.
 * - `FieldDefaultValueInput` — a type-aware default-value input.
 * - `ValidationNumberField` — one numeric validation bound, owning the
 *   empty-means-unset coercion, the whole/non-negative constraint for bounds
 *   that count things, and its own id.
 * - `ConditionRow` — one condition as source / operator / value, with the
 *   operators and value editor chosen from the source's type. It owns the ROW
 *   and not the container, so your surface keeps its own chrome; pass
 *   `operatorsFor` to narrow the set to what your runtime can evaluate, since
 *   offering an operator it cannot evaluate builds a condition that silently
 *   never matches.
 * - `usePluginFieldTypeEntries` — catalog rows for the plugin field types
 *   offered on a picker surface, to merge after your surface's built-in
 *   `entries` so contributed types appear in the picker, surface-filtered.
 * Compose them in plugin admin surfaces so field editing looks and behaves
 * like the rest of the admin; your plugin owns storage and the allowed-type
 * subset. See `STABILITY.md`.
 */
export {
  FieldTypePicker,
  FieldDefaultValueInput,
  FieldOptionsEditor,
  withOptionIds,
  usePluginFieldTypeEntries,
  ConditionRow,
  operatorsForType,
  operatorTakesValue,
  ValidationNumberField,
} from "@nextlyhq/admin";

/**
 * @experimental Reads the `clientConfig` this plugin declared in
 * `contributes.admin.clientConfig`, which is how a plugin's server-side
 * configuration reaches its browser components.
 *
 * Delivered through `/api/admin-meta`, which requires no authentication — so
 * the value reaches anonymous callers and must hold nothing secret.
 */
export { usePluginClientConfig } from "@nextlyhq/admin";
export type {
  FieldTypePickerProps,
  FieldDefaultValueInputProps,
  FieldDefaultOption,
  FieldOption,
  FieldOptionsEditorProps,
  ConditionOperatorName,
  ConditionRange,
  ConditionRowProps,
  ConditionSource,
  ConditionSourceOption,
  ConditionValue,
  ValidationNumberFieldProps,
} from "@nextlyhq/admin";

// The declarative `contributes.admin` contract types (the same ones exported
// from the package root) for convenience when authoring admin components.
export type {
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";
