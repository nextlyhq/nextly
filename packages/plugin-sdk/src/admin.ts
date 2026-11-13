/**
 * @nextlyhq/plugin-sdk/admin — the author-facing surface for plugin admin UI
 * (D19/D43). Register the React components referenced by `contributes.admin`
 * (menu/pages/settings/views) here, in a module imported by the Nextly admin
 * shell (which provides `@nextlyhq/admin` + React).
 *
 * @public Graduated in P9 — `plugin-form-builder` exercises the menu/pages/views
 *   registration. Dashboard widgets are declared with `defineWidget` under
 *   `contributes.dashboard`, which remains `@experimental`. See `STABILITY.md`.
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
 * The props a sign-in challenge view receives, and what its `resolve` call
 * answers (@experimental).
 *
 * A plugin registering a view under `contributes.auth.ui.challengeViews`
 * types it with these, so a change to the contract, and the deprecation of
 * `pendingToken`, reaches its author through the compiler.
 */
export type {
  ChallengeResolveResult,
  ChallengeViewProps,
} from "@nextlyhq/admin";

/**
 * The props a custom collection Edit view is handed (@experimental).
 *
 * A plugin registering `admin.components.views.Edit.Component` receives these,
 * and had no way to type against them without reaching into the admin package
 * directly. `documentLock` is the pair a colleague's claim withholds: it is
 * absent while creating, which has no document to claim, and absent from a view
 * rendered outside the entry page.
 *
 * 🔴 Republished rather than restated. The admin declares the shape and derives
 * the lock pair from the affordances the editor itself acts on, so a plugin
 * typing its own copy would go on compiling while an affordance renamed there
 * quietly stopped reaching the write gates that read it.
 */
export type { CustomEditViewProps, DocumentLockGates } from "@nextlyhq/admin";

/**
 * What a plugin's document view receives (@experimental): which document it
 * is of, the document form's `control`, whether a colleague's claim makes it
 * read-only, and `exit` back to the document's own edit screen.
 *
 * Republished rather than restated, for the reason the edit-view props above
 * are: the admin builds this object, and a plugin's own copy of the shape
 * would keep compiling after a field the admin hands over was renamed.
 */
export type { DocumentViewProps } from "@nextlyhq/admin";

/**
 * What the components a plugin puts on a collection's document screen
 * receive (@experimental), declared under `contributes.admin.views[slug]`
 * (see `PluginDocumentActionOverride` and `PluginPanelSection`):
 *
 * - `DocumentActionReplacementProps`: the component a replaced action opens,
 *   mounted when the author chooses the action — so a dialog renders open —
 *   with `documentLock` and `mayWrite()` (ask it immediately before the
 *   write, after anything awaited), and `close(result?)` to end it:
 *   `"deleted"` leaves the document for its
 *   collection's list as the built-in Delete does, `"changed"` reads it
 *   again, and nothing means the author backed out.
 * - `DocumentPanelSectionProps`: a panel section's body, with the document's
 *   `collectionSlug` and `entryId`, `documentLock` (hold writes while
 *   `actionsDisabled`), `mayWrite()`, and `documentChanged(result)`, the same
 *   two results.
 * - `SidebarSectionProps`: a side panel section declared at an edit page's
 *   place (`kind: "sidebarSection"`): the place's `context` and `entry`, as
 *   every contributed component receives them, and on a collection entry's
 *   page also every field of `DocumentPanelSectionProps`.
 * - `DocumentTabProps`: a tab declared at an edit page's place
 *   (`kind: "tab"`): the place's `context` and `entry`, `setBadge` to show a
 *   count beside the tab's label, the document form's `control` to read what
 *   the author typed and write values the bar's Save stores, and
 *   `documentLock`. Handed on a saved entry, a new one and a Single alike.
 *
 * All are drawn inside the document's editor, so `useDocumentLocale()` names
 * the language being edited — the one a replaced Unpublish acts on — and
 * `useDocumentActions()` answers for the same document.
 *
 * Republished rather than restated: the admin builds these objects.
 *
 * ```tsx
 * function RemoveLayoutDialog({ entryId, close }: DocumentActionReplacementProps) {
 *   return (
 *     <Dialog open onOpenChange={open => !open && close()}>
 *       …
 *       <Button onClick={async () => { await removeLayout(entryId); close("deleted"); }}>
 *         Remove
 *       </Button>
 *     </Dialog>
 *   );
 * }
 * ```
 */
export type {
  DocumentActionReplacementProps,
  DocumentChangeResult,
  DocumentPanelSectionProps,
  DocumentTabProps,
  SidebarSectionProps,
} from "@nextlyhq/admin";

/**
 * @experimental Move to a page of this admin, keeping what the current page
 * holds where the same page answers the new address — opening a document's
 * view from its edit form, for one. Takes a path starting "/admin/" and
 * refuses anything else (an absolute or external URL, a script URL, a path
 * that climbs out with "..") by throwing, naming the address.
 */
export { navigateWithinAdmin as navigateTo } from "@nextlyhq/admin";

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
 * A field's address in its document (@experimental): its path from the
 * document's root, with each repeater row named by the id it was last saved
 * with rather than its position (`sections.<rowId>.body`), so a link built on
 * it opens the same row however the rows are reordered. A row added since the
 * last save, or in a repeater whose rows set their own `id` field, has none
 * yet, and the answer says why. Outside repeaters it is the field's form path.
 */
export { useFieldAddress, type FieldAddress } from "@nextlyhq/admin";

/**
 * The surrounding document's full-page preview (@experimental).
 *
 * For a field that shows the page it holds — the page builder's entry view —
 * and offers to open it whole. `open` is the editor's own Preview handler, so
 * the field opens the page the header would, in the language being edited.
 *
 * `null` wherever the editor offers no Preview action: no preview configured,
 * an entry never saved, a reader, and outside a form. A field shows no such
 * control then, rather than one that opens nothing.
 */
export { useDocumentPreview, type DocumentPreview } from "@nextlyhq/admin";

/**
 * The signed-in user's id (@experimental).
 *
 * For a plugin that keeps something per user on a browser several people
 * share, such as the page builder's own editor preferences. Read from the
 * query the admin's chrome already holds, so it costs no request.
 *
 * `null` while the answer is not known yet, when no one is signed in, and when
 * the read failed: keep nothing for nobody rather than for a guess. Experimental
 * while its first consumer settles; the intent is to keep its name and its
 * `string | null` answer stable.
 */
export { useCurrentUserId } from "@nextlyhq/admin";

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
 * The document's actions, from inside its editor (@experimental).
 *
 * For a document view, which replaces the form body and the header with it:
 * without these it can neither offer Save or Publish nor say whether the page
 * is stored.
 *
 * - `useDocumentActions()` is the header's own actions — the same list, the
 *   same leading action, the same reasons one cannot run — with `run(id)`,
 *   which does what that action's control does and resolves to what it came
 *   to, and `saveState`, the one answer to whether the work is stored. Null
 *   outside a document editor.
 * - `useBeforeDocumentAction(handler)` runs `handler` before every action that
 *   stores the editor's work, from any control, the shortcut or `run`, while
 *   the caller is mounted: commit work held outside the form there. Throwing
 *   refuses the action; throwing an `AbortError` cancels it instead, for a
 *   handler that asked the author and was told no. Its second argument,
 *   `store.writesSettled()`, waits for the tracked writes below and answers
 *   whether they all landed: a handler that acts on the server for the store
 *   asks it first, since the store is refused when one failed. And
 *   `store.checkBeforeWrite(check)` (@experimental) has the store make
 *   `check` immediately before it writes, after every handler and tracked
 *   write: a handler that judged the work checks there that it is unchanged,
 *   and `false` runs every handler again.
 * - `useTrackedWrite()` counts a write the document depends on but does not
 *   contain. Storing actions wait for it and are refused, naming it, while its
 *   latest attempt has failed.
 *
 * Running an action never bypasses the editor: a colleague's claim, a past
 * version on screen, a save in flight and the questions Unpublish and Discard
 * draft ask all apply exactly as they do to the header's controls.
 */
export {
  useDocumentActions,
  useBeforeDocumentAction,
  useTrackedWrite,
  type DocumentActions,
  type DocumentAction,
  type ActionPlacement,
  type ActionGroup,
  type DocumentActionOutcome,
  type DocumentSaveState,
  type BeforeDocumentAction,
  type StoreReadiness,
  type SubmitRefusal,
} from "@nextlyhq/admin";

/**
 * The editor header's own save state and leading action, for a document view
 * that replaces the header (@experimental).
 *
 * - `<DocumentSaveIndicator />` is the header's save chip: Saving…, Unsaved
 *   changes, Saved (when, in its tooltip) or Not saved with Retry, in a
 *   reserved width so nothing beside it moves, and announced as the header
 *   announces it. `className` places it; it does not restyle it.
 * - `<DocumentPrimaryAction />` is the leading action (Publish, Publish
 *   changes or Save, as the header's), with the other ways to publish and
 *   Unpublish on its arrow, each row showing why it cannot run when it
 *   cannot. Every control runs through the same runner as `run`.
 *
 * Drawn by the admin, so a view offers the header's controls rather than a
 * copy that drifts from them. Both render nothing outside a document editor.
 * Experimental while the first view that uses them settles; the intent is to
 * keep both names and their props stable.
 */
export { DocumentSaveIndicator, DocumentPrimaryAction } from "@nextlyhq/admin";

/**
 * How a document view restores its own field from a recovery point
 * (@experimental).
 *
 * Without it, the admin restores a recovery point by drawing the view afresh
 * over the restored values, and the view's own history starts again, so the
 * restore can't be undone. A view that registers `useDocumentRestore` is asked
 * first: the admin resets every OTHER field to the recovery point and calls
 * `restore` with this field's recovered value, unparsed, and the view applies
 * it as one edit of its own, which the author can undo. Returning false
 * declines (a value the view can't apply as an edit), and the admin restores
 * the old way. One handler per view; it does nothing outside a document view.
 *
 * Experimental while the first view that uses it (the Page Builder) settles.
 * Adding it changes no existing export; the intent is to keep the name and the
 * handler's shape stable.
 */
export {
  useDocumentRestore,
  type DocumentRestoreHandler,
} from "@nextlyhq/admin";

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
 * @experimental The widget kit: the parts core's own dashboard cards are drawn
 * from, for a widget's own component (`defineWidget` with
 * `view: { component }`). The host always draws the card's frame and every
 * state; these are the body-level parts, reading the card's size tier and the
 * admin's theme tokens, so a plugin card matches core's beside it in light and
 * dark.
 *
 * - `FrameState`: what a component returns when its own data says the card is
 *   not ready (empty, not available, an error, or still loading), which the
 *   frame then draws in its place, as on every other card.
 * - `Widget`: the parts of a card's body core's own cards are drawn with.
 *   `Widget.Figure` (one number, written for the card's tier), `Widget.List`
 *   (rows with one action each), `Widget.Table` (rows across named columns, a
 *   table on a wide card), `Widget.BarChart` and `Widget.SeriesChart` (charts
 *   that take plain data, drawn in the shared chart colours, with an optional
 *   `unit` for their tooltips), `Widget.FooterLink` (one link drawn in the
 *   card's own footer, where core's cards draw "View all") and
 *   `Widget.useTitleCount` (a hook: the count it is given is drawn beside the
 *   card's title and read with it, as the Needs your attention card shows its
 *   items: a number, a short phrase such as "2 of 5 done", or with `true`
 *   after it a floor drawn "N+"; `undefined` shows none).
 *
 * The number and change formatters and the chart colour accessor are exported
 * from this package's root, not here: every module of the admin is a client
 * module, and the root is server-safe, so a Server Component can call them.
 *
 * Import them from here, never from `@nextlyhq/admin` directly: the admin is the
 * host's single copy, and a plugin that bundled its own would draw its parts
 * outside the card it sits in.
 */
export { FrameState, Widget } from "@nextlyhq/admin";
/**
 * @experimental A row's time as core's list cards word it, and the clock they
 * move it on with, for a widget's own list:
 *
 * - `formatWidgetTime(iso, now)`: "just now", "5m ago", "3h ago", "2d ago",
 *   and from a week on the date, in the timezone and date format the admin is
 *   set to, with its year.
 * - `useWidgetClock()`: the current time, moved on once a minute while the
 *   card is mounted and stopped when it unmounts, the `now` to word times
 *   from, so "just now" does not stay "just now".
 *
 * Core's own, so a plugin's times read and move as the cards beside it do.
 */
export { formatWidgetTime, useWidgetClock } from "@nextlyhq/admin";
/**
 * @experimental A field's key as the admin's screens word it, where the
 * field carries no label of its own or is held only by its key:
 * `humanizeFieldName("membersOnly")` is "Members Only". Core's one humaniser,
 * so a plugin names a field as the admin does. The same function the root
 * entry offers server code.
 */
export { humanizeFieldName } from "@nextlyhq/admin";
/**
 * @experimental `useRefreshDashboard()`: a function that asks every card on
 * the dashboard, and the header's summary, again, for a widget whose own
 * write changes what they answer (a card marking a row done, say). Each card
 * keeps what it shows until its answer arrives. Core's own reads, so a plugin
 * names no query of the admin's.
 */
export { useRefreshDashboard } from "@nextlyhq/admin";
export type {
  CardEmptyContent,
  CardState,
  SkeletonShape,
  WidgetBarChartGroup,
  WidgetBarChartProps,
  WidgetChartUnit,
  WidgetFigureProps,
  WidgetListProps,
  WidgetListTotal,
  WidgetRenderSize,
  WidgetRowAction,
  WidgetSeries,
  WidgetSeriesChartProps,
  WidgetSeriesInterval,
  WidgetSeriesPoint,
  WidgetTableColumn,
  WidgetTableProps,
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
 * in this file is. That is not a formality — `plugin-sdk` peers on `admin`, and
 * takes from `ui` only its server-safe subpaths, for its root; `ui`'s root
 * barrel carries a `"use client"` banner that the layering guard admits only
 * by subpath.
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
  FieldLayout,
  FieldShellProps,
  FieldShellRenderProps,
  FieldWidth,
  FormSectionProps,
  FormActionsProps,
} from "@nextlyhq/admin";

/**
 * The status badge a table cell or a header carries (@experimental here; the
 * component is `@public` in `@nextlyhq/ui`). Its `success`, `warning`,
 * `destructive` and `info` variants are quiet chips with a status dot, so a
 * column of statuses reads calm and the word carries the meaning. Forwarded
 * so a plugin page assembles a table, its statuses and its form from one
 * import, the same component the admin's own lists draw.
 */
export { Badge } from "@nextlyhq/admin";
export type { BadgeProps } from "@nextlyhq/admin";

/**
 * The parts a plugin page needs beyond a form (@experimental here): a notice
 * above the content, a panel that slides in from the edge, tabs inside a card,
 * a progress bar, a menu of row actions and a hint on hover. The same objects
 * the admin's own pages draw, forwarded through `@nextlyhq/admin` like the
 * controls above, so a plugin page needs no look of its own for any of them.
 *
 * - `Alert` takes `variant`: `info`, `success`, `warning` or `destructive`.
 * - `Sheet` is the admin's side panel; `SheetContent` takes `side`.
 * - `Tabs` switches between panels inside a page. For tabs that are routes,
 *   use `PageTabs`.
 * - `Progress` takes a `value` out of `max` (100 by default), and `variant`
 *   `default`, `success` or `error`.
 * - `DropdownMenu` is the menu behind a button, such as a row's actions.
 * - `Tooltip` needs a `TooltipProvider` above it; the admin provides one, so a
 *   plugin page adds its own only when it renders outside the admin.
 */
export {
  Alert,
  AlertDescription,
  AlertTitle,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Progress,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/admin";
export type {
  AlertDescriptionProps,
  AlertProps,
  AlertTitleProps,
  SheetCloseProps,
  SheetContentProps,
  SheetDescriptionProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetProps,
  SheetTitleProps,
  SheetTriggerProps,
  TabsContentProps,
  TabsListProps,
  TabsProps,
  TabsTriggerProps,
  ProgressProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSeparatorProps,
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
 * Ask for the admin's content panel to start folded away while this page is
 * mounted (@experimental), for a page that needs the width: a builder with a
 * field list, a preview and a settings panel. The icon rail stays, the top
 * bar shows a toggle that brings the panel back, and the reader's choice is
 * remembered under `key` (name the page, `"forms.builder"`, not the record it
 * shows), so the next visit starts the way they left it.
 */
export { useFoldedPanel } from "@nextlyhq/admin";

/**
 * A store for one of the person's interface preferences, kept by the admin's
 * own rules (@experimental): for a plugin that remembers a choice in the
 * browser, such as an editor's panels or its recently opened pages.
 *
 * - Where the site turns remembering off (`NEXTLY_ADMIN_DEVICE_MEMORY=off`),
 *   nothing is written to the browser's storage, and the choice holds for
 *   the page alone.
 * - Signing out forgets it, in every open tab, with everything else the
 *   admin kept about the person.
 * - `lifetime: "tab"` keeps it for the tab alone, in its session storage.
 *
 * `read`, `write` and `remove` never throw. Key it per person (with
 * `useCurrentUserId`) where two people may share a browser.
 */
export { devicePreferenceStore } from "@nextlyhq/admin";
export type {
  DevicePreferenceOptions,
  DevicePreferenceStore,
} from "@nextlyhq/admin";

/**
 * Draw a page's own content into the admin's one top bar (@experimental):
 * `name="start"` is the bar's left part (where a breadcrumb goes) and
 * `name="end"` its right part, for the page's own actions such as Save. The
 * children stay in the page's tree, so they keep its state and context, and
 * are drawn in the bar for as long as the page is mounted. Outside the admin's
 * shell (a unit test) they render where they stand.
 */
export { TopBarPlace } from "@nextlyhq/admin";
export type { TopBarPlaceName, TopBarPlaceProps } from "@nextlyhq/admin";

/**
 * A page's frame and its header, the pieces core's pages are drawn from
 * (@experimental), so a plugin's page looks like a core one.
 *
 * - `PageFrame` takes the page's `type`, and the type decides its width:
 *   `"list"` runs full width within the gutter, `"form"` is a 56rem column
 *   under the page's left edge, `"editor"` runs full width with no gutter so
 *   a side panel meets the window's edge, and `"workspace"` takes no gutter and
 *   no padding, for a page that lays out its own surface.
 * - `PageHeader` draws the page's title as its `h1`, with an optional
 *   `description`, `actions` trailing the title, `meta` chips beside it, a
 *   leading `media` visual and a `tabs` row (`PageTabs` with a `PageTab` per
 *   section, each a link with its own address).
 *
 * A plugin page that draws no `PageFrame` is drawn as a Workspace page. A page
 * that draws one gets no second frame from the admin. Content for the admin's
 * top bar still goes through `TopBarPlace`.
 */
export { PageFrame, PageHeader, PageTab, PageTabs } from "@nextlyhq/admin";
export type {
  PageFrameProps,
  PageHeaderProps,
  PageTabProps,
  PageTabsProps,
  PageType,
} from "@nextlyhq/admin";

/**
 * The live values of the document being edited (@experimental), for any
 * component a plugin draws inside the editor: a block, a side panel section
 * or a tab, on an entry, a new one or a Single. A place's `entry` prop is the
 * document as it was read; these are the document as it is being typed.
 *
 * - `useDocumentValues(paths)`: the named fields by their dot paths
 *   (`"seo.title"`), drawing again only when one of them changes.
 * - `useDocumentField(path)`: one field's value, whether it may be written
 *   now, and `set(next)`, which writes as the author typing would and marks the
 *   document changed, or writes nothing and answers `false` while the
 *   document's content is held. `set(null)` returns a field to automatic.
 *
 * Both read the editor's own form, never the nearest form context, so a
 * plugin component with a form of its own still reads the document. Both
 * answer `null` outside a document editor.
 */
export { useDocumentField, useDocumentValues } from "@nextlyhq/admin";
export type { DocumentField } from "@nextlyhq/admin";

/**
 * Draw the contributions sent to an admin place (@experimental): blocks with
 * `TargetSlot`, tabs with `PlaceTabs`, in the order the server sent them and
 * each behind its own error boundary, as core's pages draw theirs.
 *
 * For a place the plugin declared under `contributes.admin.places`, on one of
 * its own pages: other plugins' blocks and tabs added there arrive already
 * filtered for the signed-in reader, and each receives the place's `context`
 * and the page's `entry` when it passes one. Pass `context={null}` while the
 * page does not know its ids yet; nothing contributed is drawn until it does.
 * A plugin's place has no built-in parts, so the page draws its own content
 * beside the slot.
 *
 * A contributed tab receives `PlaceTabProps`: the place's `context` and
 * `entry`, and `setBadge`, which shows a count beside the tab's label
 * (`PlaceTabBadge`) or none with `null`. A tab stays mounted while another is
 * open, so its count stays current and what it holds is kept.
 */
export { PlaceTabs, TargetSlot } from "@nextlyhq/admin";
export type {
  PlaceContributionProps,
  PlaceProps,
  PlaceTabBadge,
  PlaceTabProps,
  PlaceTabsProps,
  TargetSlotProps,
} from "@nextlyhq/admin";

/**
 * The unified admin data table + its extension points (@experimental). Render
 * `DataTable` (batteries-included) or `DataTableView` (controlled) to match the
 * admin's lists, and contribute cell renderers, columns, column transforms, and
 * row/bulk actions to any list. Contributions are keyed by a list `target`: a
 * collection slug, a fixed key like `"users"`/`"media"`, or `"*"` for all lists.
 * Each registration returns the function that takes it back; a list on screen
 * follows both, so a contribution that depends on something the admin can
 * change while open need not wait for the list to be opened again.
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
 * Rows in groups and rows that open a region below them (@experimental),
 * taken by `DataTableView` and `ListView` as `grouping` and `rowDetail`.
 * `DataTableGrouping` places each row in a `DataTableGroup` and draws the
 * group under a header row with its title, a badge, a count (by default its
 * rows, in words) and actions; each group is a row group named by its title,
 * and with `collapsible` its title is the button that folds its rows.
 * `DataTableRowDetail` gives a row a toggle in its first column, a button with
 * `aria-expanded` that opens a region below the row, named by the row's
 * identifying cell. Either state is the list's, or the page's when it passes
 * the ids. The narrow card view draws the same groups as sections and the
 * same toggle inside each card.
 *
 * Intended to be stable: they are the table's own props, and they graduate
 * with `ListView` once a first-party plugin's list exercises them.
 */
export type {
  DataTableGroup,
  DataTableGrouping,
  DataTableRowDetail,
} from "@nextlyhq/admin";

/**
 * The admin's list surface around that table (@experimental): `ListView`
 * composes `DataTableView` with the one toolbar every admin list draws — the
 * search field, filters in a dropdown or inline, the columns menu and
 * list-wide actions — the empty state (with a separate one for a search that
 * matched nothing), and slots above and below the table. Every table prop is
 * forwarded untouched. `useTableColumns` gives the columns to render and the
 * columns menu's control from one remembered choice per list, keeping the
 * row's identifying column out of the menu; `useListColumns` is the lower
 * half, for a list that offers every column. `ListToolbar`, `ListColumnsMenu`
 * and `ListEmptyState` are the parts, for a surface that lays out its own
 * list.
 *
 * Intended to be stable: these are the components the admin's own lists draw
 * today, and they graduate once a first-party plugin's list exercises them.
 */
export {
  ListView,
  ListToolbar,
  ListColumnsMenu,
  ListEmptyState,
  useListColumns,
  useTableColumns,
} from "@nextlyhq/admin";
export type {
  ListViewProps,
  ListToolbarProps,
  ListColumnsControl,
  ListEmpty,
  ListSearch,
  ListSlots,
  UseListColumnsOptions,
  UseTableColumnsOptions,
  UseTableColumnsResult,
} from "@nextlyhq/admin";

/**
 * Where a plugin's page sits, drawn in the admin's top bar (@experimental).
 * Pass `<Breadcrumbs items={...} />` as `PageHeader`'s `breadcrumbs`: inside
 * the admin shell the trail is drawn in the top bar's left part, the last item
 * as the page itself and the one before it as the way back on a narrow bar;
 * rendered outside the shell (a test, a standalone page) it is drawn where it
 * stands. `placement: "inline"` keeps a trail inside the page's content, such
 * as a folder path.
 *
 * Intended to be stable: every core page draws its trail with it.
 */
export { Breadcrumbs } from "@nextlyhq/admin";
export type { BreadcrumbItem, BreadcrumbsProps } from "@nextlyhq/admin";

/**
 * A segmented control (@experimental): a radio group drawn as one row of
 * options, for a short choice that should stay in view — a page's View / Edit
 * switch, a filter of three states, a setting such as a title separator.
 * Arrow keys, Home and End move the choice, as a radio group does. `compact`
 * (the default) sits on a muted track for a header or toolbar; `bordered` is
 * the form setting's look. Name it with `aria-label` or `aria-labelledby`.
 *
 * Intended to be stable: it is the control the dashboard's card settings use.
 */
export { SegmentedChoice } from "@nextlyhq/admin";
export type {
  SegmentedChoiceProps,
  SegmentedChoiceSize,
  SegmentedOption,
} from "@nextlyhq/admin";

/**
 * A checklist with progress (@experimental), the one the dashboard's "Set up
 * your project" card draws: `Checklist` puts a progress bar over an ordered
 * list, and `ChecklistItem` is one step, marked open, done or skipped, with
 * its name, a hint line and its buttons. The bar is a picture only; say the
 * count in words beside the list's title ("4 of 6 done"). `columns={2}` lays
 * the steps in two columns where the list is wide enough, and
 * `doneStyle="struck"` strikes a done step's name through. `ChecklistMark`
 * and `ChecklistProgress` are the parts, for a layout of its own.
 *
 * Intended to be stable once a first-party plugin's setup list exercises it.
 */
export {
  Checklist,
  ChecklistItem,
  ChecklistMark,
  ChecklistProgress,
} from "@nextlyhq/admin";
export type {
  ChecklistProps,
  ChecklistItemProps,
  ChecklistMarkProps,
  ChecklistProgressProps,
  ChecklistStatus,
  ChecklistDoneStyle,
} from "@nextlyhq/admin";

/**
 * A settings row whose control is a group (@experimental): label and help on
 * the left, several controls on the right, named as one group with
 * `role="group"`. For a single control use `FieldShell` with
 * `layout="row"`, which draws the same two-column grid and points its label
 * at the control.
 *
 * Intended to be stable: the admin's own settings pages draw their grouped
 * rows with it.
 */
export { SettingsRowGroup } from "@nextlyhq/admin";
export type { SettingsRowGroupProps } from "@nextlyhq/admin";

/**
 * Where a flow of a few steps is (@experimental): a numbered row of steps,
 * each done, current or to come, the one the email provider setup draws.
 * `current` is the current step's index from 0; it carries
 * `aria-current="step"`, and a done step says "(done)" in words as well as
 * with a tick. A done step with an `href` links back to its page, or with
 * `onSelect` runs it from a button; a step not yet reached never does.
 *
 * Intended to be stable: the admin's own guided setup draws its steps with it.
 */
export { Stepper } from "@nextlyhq/admin";
export type { StepperProps, StepperStep, StepState } from "@nextlyhq/admin";

/**
 * The admin's drop area for a file a plugin screen reads itself, rather than
 * uploads to the media library (@experimental): drag a file onto it or press
 * it to choose one, and it is handed to `onFiles` as it is; what the file
 * must be is the screen's to judge and say. It looks as the Media library's
 * upload area does, and is meant to stay part of this surface.
 */
export { FileDropArea } from "@nextlyhq/admin";
export type { FileDropAreaProps } from "@nextlyhq/admin";

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
 * The shared field picker (@experimental), beside the field-UI kit above and
 * replacing its `FieldTypePicker` for adding a field. One picker serves every
 * surface: search first (names, descriptions, categories and synonyms, older
 * and developer names included), a most-used group then categories, keyboard
 * alone, and a label-only add step with "Add and add another". Your surface
 * configures it with `FieldPickerConfig` (its built-in `types`, the `surface`
 * whose plugin types join them, `exclude`, `mostUsed`, `deriveName`, and
 * optionally `fieldGroups`) and owns where the field goes: `onAdd` hands you
 * the choice and the picker writes nothing.
 * - `describeFieldTypes` turns catalog rows into the `FieldTypeDescription`s
 *   the picker takes (each row plus its search words).
 * Experimental until every built-in surface uses it; the kit above stays
 * exported and working beside it.
 */
export { FieldPicker, describeFieldTypes } from "@nextlyhq/admin";
export type {
  FieldPickerProps,
  FieldPickerConfig,
  FieldPickerChoice,
  FieldGroupOption,
  FieldTypeDescription,
} from "@nextlyhq/admin";

/**
 * The shared field settings panel (@experimental): the one panel every surface
 * uses to add and edit a field, the same for a field just added and one that
 * already existed. Five tabs (General, Validation, Display, Conditions,
 * Advanced), with the settings that make the field its type first in General,
 * and every setting it shows kept in the definition. Each change reaches your
 * `onChange` at once with the whole field, so there is no Apply step: your
 * surface stores it, and the panel writes nothing.
 *
 * Your surface configures it with `FieldSettingsSurface`: the `surface` whose
 * plugin types it names, `deriveName` (a name follows its label until the
 * field is saved), the settings it `fixed` and why (shown beside them), its
 * `extraSettings` by tab, and its `conditions`. Pass `saved` for a field your
 * surface has saved, `ancestors` for where it sits (its API path is shown, such
 * as `authors[].social[].url`), and `siblings` for the fields its condition may
 * read.
 * - `FieldTypeSettings` is what a type shows of its own settings: its
 *   `defining` settings, first in General, and the rest by tab.
 * Experimental until every built-in surface uses it.
 */
export { FieldSettingsPanel } from "@nextlyhq/admin";
export type {
  FieldSettingsControlProps,
  FieldSettingsField,
  FieldSettingsPanelProps,
  FieldSettingsSurface,
  FieldSettingsConditionsProps,
  FieldSettingsSurfaceControlProps,
  FieldSettingsTab,
  FieldTypeSettings,
  FixedFieldSetting,
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
 * A media item by id, as a query a component renders from: a thumbnail, a
 * preview. The admin's own read of one item, cached by id.
 *
 * @experimental
 */
export { useMediaItem } from "@nextlyhq/admin";
/**
 * Read a media item by id from code that draws a page, outside a component's
 * render. The same query as `useMediaItem`, so the two share one cache and
 * one read in flight.
 *
 * @experimental
 */
export { useMediaResolver } from "@nextlyhq/admin";
/**
 * Search the media library's images by name from code outside a component's
 * render, such as a picker that searches as the author types: the newest
 * twelve images for an empty search. Read through the same list query as the
 * library's own dialog, with the signed-in author's access. Rejects when the
 * library cannot be read, and when the given signal aborts.
 *
 * @experimental
 */
export { useMediaSearcher } from "@nextlyhq/admin";

/**
 * @experimental The media library as a dialog a plugin can open: browse,
 * search and upload, then hand back the chosen items. The page builder's
 * inspector opens it to choose an image; a plugin's own inspector may do the
 * same. Store the chosen item's `id`, which stays right when the file is moved
 * or renamed, rather than its `url`, which does not.
 */
export { MediaPickerDialog } from "@nextlyhq/admin";
export type { MediaPickerDialogProps } from "@nextlyhq/admin";

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
 * @experimental The translator for this plugin's own admin strings, declared
 * in `contributes.translations`: `t("acme-shop.cart.title")`, read in the
 * interface language in effect, then English, then the key itself.
 */
export { usePluginTranslate } from "@nextlyhq/admin";

/**
 * @experimental Read a route this plugin contributed, from this plugin's own
 * admin components.
 *
 * The two halves of a plugin could not reach each other: a plugin may serve an
 * HTTP route and may render admin components, and there was no client for the
 * second to call the first with. An author's choice was to hand-roll the
 * session, its refresh and the error envelope, or to read something else.
 *
 * The path is built from the plugin's package NAME through the dispatcher's own
 * `pluginRouteFullPath`, so a caller cannot address a namespace the server does
 * not serve — a mistake that does not raise, because a request to a path
 * nothing serves answers with nothing and reads as an empty result.
 *
 * The plugin names ITSELF. There is no ambient plugin identity in the admin: a
 * component is rendered through a registry by string path, so nothing in its
 * React context says which plugin contributed it — which is why
 * `usePluginClientConfig` takes the name too.
 *
 * `pending` is a REAL third state beside the data. `undefined` is both "the
 * route answered nothing" and "the route has not answered", and a surface that
 * cannot tell them apart draws its empty state over a read in flight.
 */
export { usePluginRoute } from "@nextlyhq/admin";

/**
 * @experimental Read a route this plugin contributed once, outside React.
 *
 * For a read a hook cannot express: a search an author is typing, each read
 * cancelling the one it replaces through `signal`. It goes through the same
 * session handling as `usePluginRoute`, so an expired session is renewed
 * rather than surfacing as a failure, and a refusal rejects with the admin's
 * parsed error. Not cached. Answers `undefined` for an empty answer.
 */
export { readPluginRoute } from "@nextlyhq/admin";

/**
 * @experimental Write to a route this plugin contributed.
 *
 * The other half of `usePluginRoute`, and it was the missing half: a plugin
 * could READ its own route and had nothing to write to it with, so any feature
 * that saved something was back to hand-rolling the session, its refresh and
 * the error envelope — the exact problem the read hook was added to remove.
 *
 * The plugin names ITSELF here too, for the same reason, and `invalidates`
 * names the plugin's own read paths so a save refreshes the list it belongs in.
 * Those paths are resolved through this plugin's name, so one plugin cannot
 * invalidate another's cached reads however it spells a path.
 *
 * `write` RESOLVES on failure rather than rejecting, answering `undefined`, and
 * reports the cause on `error`. A rejecting promise is the idiomatic TanStack
 * shape and a footgun on a surface handed to plugin authors: a caller who does
 * not wrap the await gets an unhandled rejection for a failure already
 * reported. It is the same shape the read hook has, so there is one thing to
 * learn rather than two.
 */
export { usePluginRouteMutation } from "@nextlyhq/admin";

/**
 * @experimental Write to a route this plugin contributed once, outside React.
 *
 * The write half of `readPluginRoute`. Where `usePluginRouteMutation` reports
 * a failure on `error` at the next render, this REJECTS with the admin's
 * parsed error, so a caller that must hand a refusal's reasons back at the
 * moment it awaits can. Same session handling and CSRF token as the hook; not
 * cached, and it invalidates nothing. Experimental while its first caller
 * settles; the intent is to keep its name and options stable.
 *
 * `keepalive: true` (optional, additive) sends the write so the browser
 * finishes it after the page is hidden or closed, while its body fits the
 * 64 KB browsers allow; a larger one goes as an ordinary request.
 */
export { writePluginRoute } from "@nextlyhq/admin";
/**
 * `PluginRouteInvalidation` is what a write names as gone stale. A plugin
 * serving both mounts has to say which one an entry belongs to, so the type has
 * to be nameable by the author building that array rather than reconstructed
 * from the hook's parameter.
 *
 * Stated here rather than inside the export list: the public-surface snapshot
 * reads that list as names, so a comment between them is recorded as one.
 */
export type {
  PluginRouteMethod,
  PluginRouteWrite,
  PluginRouteWriter,
  PluginRouteInvalidation,
} from "@nextlyhq/admin";
export type { PluginRouteRead, PluginRouteRequest } from "@nextlyhq/admin";

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
 *
 * `apiErrorMessage` is the third of the set and the one most surfaces want: a
 * sentence to put in front of a person, assembled from the per-field reasons
 * when there are any and from the top-level message when there are not. It is
 * published rather than left to be rebuilt because rebuilding it is how a
 * plugin comes to show "Validation failed." — which is true, and says nothing
 * about which field — while the admin's own screens show the reasons.
 */
export {
  useSingleDocument,
  useUpdateSingleDocument,
  apiErrorMessage,
  isApiError,
  toastMutationResult,
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
  PluginPageStartupRead,
  PluginCollectionView,
  OverridableDocumentAction,
  PluginDocumentActionOverride,
  PluginDocumentActionOverrides,
  PluginDocumentView,
  PluginFieldTypeDocumentView,
  PluginMenuItem,
  PluginPanelSection,
} from "nextly";
/**
 * @experimental A standalone plugin's panel declarations, as the package root
 * exports them: its groups, and the count or badge on a menu item.
 */
export type {
  PluginAdminPanel,
  PluginItemCount,
  PluginMenuItemFields,
  PluginPanelGroup,
} from "nextly";

/**
 * `WEB_FONT_FORMATS` — the web font formats the host accepts, serves and
 * advertises: each one's type, file suffix, `format()` keyword and the four
 * bytes it begins with. Published so a plugin that takes a font file reads
 * the table the upload gate checks rather than restating it. Intended to be
 * stable: the host's own table, which changes only with a release that says
 * so.
 */
export { WEB_FONT_FORMATS } from "nextly/config";
