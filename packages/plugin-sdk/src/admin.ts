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
 * The entry's remaining fields, drawn for a takeover surface (@experimental).
 *
 * A field whose type is registered as a TAKEOVER covers the whole form, so an
 * entry edited through one has its title, its slug, its SEO and its relations
 * put out of reach. This is how the surface that covered them offers them back
 * without the author leaving it and losing their undo history.
 *
 * Pass the asking field's path; it is excluded from what comes back, along with
 * any field whose condition currently hides it. What you get is the fields
 * ALREADY DRAWN, or `null`.
 *
 * ```tsx
 * const fields = useEntryFieldsPanel(name);
 * // One value answers both questions, so a rail and its panel cannot disagree.
 * const panels = fields === null ? BASE_PANELS : [...BASE_PANELS, "settings"];
 * // ...and the same value is what fills it.
 * renderPanel={panel => (panel === "settings" ? fields : null)}
 * ```
 *
 * `null` means OFFER NO PANEL, and it covers both reasons that can be true:
 * there is no surrounding entry form — a preview, a standalone harness — or
 * there is one with nothing left to show. A surface that reserves width to
 * display nothing reads as a broken control rather than an absent feature, so
 * the two are deliberately not distinguished: a caller does the same thing with
 * either.
 *
 * A NODE rather than a renderer, because a caller makes two decisions from this
 * — whether to offer a region, and what to put in it — and those must not be
 * able to disagree. Handed a renderer, the only thing a caller could gate on
 * was whether the renderer existed, which is true for every entry form whether
 * or not it draws anything.
 *
 * It is built from the FORM'S OWN control, so what the surface draws and what
 * the form submits are one thing. Constructing a second form would fork the
 * state and lose the edit made in whichever copy did not save.
 */
export { useEntryFieldsPanel } from "@nextlyhq/admin";

/**
 * Edit this site's rich text from your own surface (@experimental).
 *
 * Returns the node classes and theme the admin's own rich-text field uses, so a
 * surface that renders rich text outside that field — the page builder's canvas
 * is the first — registers the SAME nodes. Sharing the registry is not a nicety:
 * Lexical recognises content by the identity of the classes that wrote it, and
 * an editor built on a different set reads existing content as PLAIN TEXT,
 * silently, at read time, on documents that already saved.
 *
 * ASYNC because the classes bring Lexical and PrismJS with them — a 630KB chunk
 * that `@nextlyhq/admin` deliberately keeps behind a dynamic import. Awaiting it
 * is what stops that weight reaching consumers who never open an editor.
 *
 * You still build the editor: this hands over the registry and the theme, not a
 * mounted component, because where an editor mounts and how it is toolbarred is
 * the surface's own business.
 *
 * @example
 * ```ts
 * const { nodes, theme } = await loadRichTextEditorKit();
 * const editor = createEditor({ namespace: "canvas", nodes: [...nodes], theme });
 * ```
 */
export { loadRichTextEditorKit, type RichTextEditorKit } from "@nextlyhq/admin";

/**
 * Edit ONE passage in place, anywhere on your own surface (@experimental).
 *
 * The companion to {@link loadRichTextEditorKit}, for the case that kit cannot
 * serve on its own: building an editor from the registry means calling
 * `createEditor`, which means importing Lexical — and a second declarer of
 * Lexical is exactly the failure sharing the registry exists to prevent. This
 * hands over the operations instead, so a consumer edits rich text without ever
 * naming a Lexical type.
 *
 * ONE editor, moved between elements. `attach` releases whatever it held
 * before and hands back a SESSION, so at most one passage is live at a time —
 * which is both what Lexical's own ecosystem supports and an honest model of a
 * caret. A session that has been superseded reads as nothing and detaches as a
 * no-op, so a consumer that lost the editor cannot read another's passage or
 * tear down the live one.
 *
 * The element is made editable on attach and given back exactly as it arrived
 * on detach, markup included — `setRootElement` neither sets `contentEditable`
 * nor undoes the attribute, inline styles and replaced children it writes, and
 * a consumer should not have to know that.
 *
 * `attach` answers with a STATUS, and a caller must narrow it rather than
 * treating a refusal as a failure to report. It refuses for two unrelated
 * reasons and says which, because only one of them is anything a caller can
 * act on:
 *
 * - `"unsupported"` — this passage cannot be represented here, and nothing
 *   about it changes by waiting: a node type this registry does not know, or a
 *   decorator node whose visible output comes from `decorate()` and is mounted
 *   by a React plugin this raw editor does not use. Either way the editor would
 *   hold less than the document does and the next keystroke would write that
 *   back, so leaving the passage as the page rendered it is the only outcome
 *   that cannot lose work.
 * - `"held"` — the editor is busy protecting an edit whose words exist nowhere
 *   else, because writing it back was refused. Nothing is wrong with the
 *   passage you asked for; the surface holding on has to finish first. Worth
 *   SAYING to whoever is looking at the screen, or their gesture appears to do
 *   nothing at all.
 *
 * Its undo history is created at `attach` and given away at `detach`, so it
 * covers the open passage alone. A surface with its own history — the page
 * builder's document ops are one — keeps everything larger, and a finished edit
 * is one entry there rather than one per keystroke.
 *
 * Values cross as `unknown` in both directions: the stored shape is defined in
 * `@nextlyhq/blocks-engine`, which this package does not depend on, and
 * restating it here would be a second declaration of one format. Narrow a
 * result with that package's own `isRichTextValue`.
 *
 * ASYNC for the same 630KB reason the kit is.
 *
 * @example
 * ```ts
 * const editor = await loadInlineRichTextEditor();
 * const attachment = editor.attach(element, node.props.content);
 * if (attachment.status === "refused") {
 *   // Only one of the two is worth telling anyone about.
 *   if (attachment.reason === "held") notify("Finish the other edit first.");
 *   return;
 * }
 * const { session } = attachment;
 * session.focus();
 * // ...the author types...
 * const next = session.read();
 * session.detach();
 * ```
 */
export {
  loadInlineRichTextEditor,
  type InlineRichTextAttachment,
  type InlineRichTextEditor,
  type InlineRichTextRefusal,
  type InlineRichTextSession,
} from "@nextlyhq/admin";

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
 * The controls a form is built from (@experimental).
 *
 * Layout primitives alone left an author with a `Card` and a `Grid` and nothing
 * to put inside them, so the escalation path above — layout, then the Layer-2
 * safelist, then the plugin's own `admin.styles` — sent every plugin needing a
 * button to its last step. That step is the one surface the design linter
 * cannot see: it runs over this repository, not over a third party's
 * stylesheet. So the tokens and the linter were being defended everywhere
 * except at the door plugin authors actually use.
 *
 * The set is what an ordinary settings form cannot be assembled without, which
 * is why it stops where it does. It is not the whole component library:
 * exporting a component makes its props public API, and a name added later is
 * a smaller event than a name withdrawn.
 *
 * Routed through `@nextlyhq/admin` rather than `@nextlyhq/ui`, as every block
 * in this file is. That is not a formality — `plugin-sdk` peers on `admin` and
 * does not depend on `ui` at all, and `ui`'s root barrel carries a
 * `"use client"` banner that the layering guard admits only by subpath.
 */
export {
  Button,
  Input,
  Textarea,
  Checkbox,
  Switch,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FieldShell,
  FormSection,
  FormActions,
} from "@nextlyhq/admin";
export type {
  FieldShellProps,
  FieldShellRenderProps,
  FieldWidth,
  FormSectionProps,
  FormActionsProps,
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
 * - `ValidationRulesEditor` — the whole set of validation rules a field
 *   accepts, drawn from an allowed list the caller ASKS core for rather than
 *   deriving from type names. `drawsAnyValidationRule` answers whether it would
 *   render anything, so a surface never restates which types have no options.
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
  ValidationRulesEditor,
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
} from "@nextlyhq/admin";

/**
 * @experimental Upload a file into the media library, as the admin's own
 * dropzone does.
 *
 * The one route a plugin has to put bytes on this site. It matters because
 * several things a plugin may author cannot reference a file anywhere else:
 * a `@font-face` is refused unless its `src` is a path on this origin, so a
 * plugin offering a font has to store the file here first and point at the id
 * it gets back.
 *
 * `mutateAsync({ file })` resolves to the stored `Media` record — its `id`
 * addresses the bytes, and its `mimeType` is the type upload validation
 * settled on rather than the one the browser guessed, which is the value to
 * carry into anything that names a format.
 */
export { useUploadMedia } from "@nextlyhq/admin";

/**
 * @experimental Reads the `clientConfig` this plugin declared in
 * `contributes.admin.clientConfig`, which is how a plugin's server-side
 * configuration reaches its browser components.
 *
 * Delivered through `/api/admin-meta`, which requires no authentication — so
 * the value reaches anonymous callers and must hold nothing secret.
 */
export { usePluginClientConfig } from "@nextlyhq/admin";

/**
 * @experimental Read and write a Single this plugin owns, through the same
 * client the admin's own Single form uses.
 *
 * `useSingleDocument(slug)` is a TanStack Query hook whose cache key already
 * carries the locale and the draft overlay; `useUpdateSingleDocument(slug)` is
 * the matching mutation. A plugin fetching its own Single some other way would
 * be a second answer to how that one document caches and when it invalidates,
 * and the two would disagree the first time either learned something — which is
 * the failure a plugin surface cannot see, because each half looks correct.
 *
 * A write is PARTIAL: the fields named are the fields changed, and every other
 * field of the document is left as it was. Measured across SQLite, Postgres and
 * MySQL. So several surfaces owning different fields of one Single can each
 * send only their own and never clobber one another.
 *
 * A refused write REJECTS. The service answers `{ success: false }`,
 * `unwrapServiceResult` turns that into a throw, the route answers non-2xx, and
 * the fetcher raises an `ApiError` — so `mutateAsync` rejects rather than
 * resolving with an envelope to inspect. Handle it: an unhandled rejection is
 * what a plugin gets for awaiting the mutation and reading the result.
 *
 * The reason is on the error rather than in a return value, so it is reached
 * with `validationIssues(reason)`: the per-field complaints the refusal
 * carries, each `{ path, code, message }`, keyed by `path` — the document field
 * that was refused — which is what lets a surface put the message on the
 * section that produced it. Note `path`, not `field`: the service-level
 * envelope spells it the other way, and that envelope is not what survives the
 * transport.
 *
 * Read it with the guards rather than a cast, because the mutation's error is
 * typed `Error` and that is not a narrowing this SDK could honestly avoid. Not
 * every rejection is an `ApiError`: a request that fails before a response
 * exists — offline, DNS, CORS — rejects with the native error and carries no
 * `status` and no payload. `isApiError` separates the two, and
 * `validationIssues` answers with an empty array for everything that is not a
 * validation failure, so a surface keying issues by field needs no branch for
 * the transport case.
 */
export {
  useSingleDocument,
  useUpdateSingleDocument,
  isApiError,
  validationIssues,
  type SingleDocument,
  type ApiError,
  type ValidationIssue,
} from "@nextlyhq/admin";
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
  ValidationRulesEditorProps,
  ValidationRuleValues,
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
