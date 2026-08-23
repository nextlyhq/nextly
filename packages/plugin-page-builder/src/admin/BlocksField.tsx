"use client";

/**
 * The blocks field's control: a summary of what the field holds, and the way in
 * to the editor that changes it.
 *
 * Composes `BlocksSummary` rather than replacing it. The summary is a pure
 * read-only account of the document and stays that way — it is what the form
 * shows at rest, and it is worth keeping testable without an editor around it.
 *
 * ## Why the editor opens OVER the form rather than inside it
 *
 * A block canvas needs the window. Rendered inline it would compete with the
 * form's own measure, and every published page it previews is wider than the
 * column a field occupies — so an inline canvas previews a layout at a width
 * the site never uses. Opening it over the form gives the canvas the viewport
 * and leaves the form exactly as it was underneath, still holding its other
 * fields' unsaved state.
 *
 * ## Why "Done" and not a close glyph
 *
 * The editor covers the form completely, so the way back is the only way back.
 * The shell owns that affordance and its wording — it renders an exit only when
 * given a handler, labels it rather than drawing a bare glyph, and confirms
 * first when the document is dirty. This component supplies the handler and
 * does not restate any of that.
 *
 * That handler is also the EVIDENCE for `canExit`. The admin only hides its
 * navigation rail for a surface that can be left, and it is told so by this
 * component — derived from the handler that does the leaving, never asserted
 * beside it, so the claim and the affordance cannot drift apart.
 *
 * @module @nextlyhq/plugin-page-builder/admin/BlocksField
 */

import {
  hasBlock,
  registerBlocks,
  registryNestingSource,
  type BlockDocument,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { CORE_CATEGORIES, coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { registrySlotSource } from "@nextlyhq/builder";
import {
  BlockKeyboardActions,
  BlockToolbar,
  EditorCommandPalette,
  BuilderShell,
  Canvas,
  DropIndicator,
  InsertPanel,
  InspectorPanel,
  LayersPanel,
  TokensPanel,
  OnboardingChecklist,
  SelectionBreadcrumb,
  SpacingOverlay,
  useBuilderChecklist,
  useCanvasDrag,
  useEditorState,
  useInlineText,
} from "@nextlyhq/builder/shell";
import {
  useDocumentCheckpoint,
  usePluginClientConfig,
  useEntryFieldsPanel,
  useReportUnsavedWork,
  useSuppressAdminChrome,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useController,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { emptyBlockDocument } from "../fields/blocks-document";
import { hostFetchPolicy, readRemotePatterns } from "../host-policy";
import {
  tokenOverrideOf,
  tokensAfterRefusal,
  siteBreakpoints,
  siteSheet,
  type SiteStyleData,
} from "../site-style";
import { readSiteStyleRecord } from "../site-style-record";

import { BlocksSummary } from "./BlocksSummary";
import { DocumentStatusPill } from "./DocumentStatusPill";
import { useSaveSiteStyle, useSiteStyle } from "./site-style-client";
import { withValueAtPath } from "./snapshot-merge";

export interface BlocksFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads and writes. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
  /**
   * The document is being READ, not edited, so no way in is offered.
   *
   * The admin passes this to every field through one `commonProps`, and a field
   * that ignores it does not merely look wrong: this one opened a full-screen
   * editor bound to whichever form was nearest, which in a version-history view
   * is the SNAPSHOT'S. Committing there writes into a past version of the
   * document — `VersionSnapshotForm` states that as impossible in its own
   * docblock, and nothing was enforcing it.
   */
  readOnly?: boolean;
  /**
   * The field is unavailable — no permission, or a form mid-submit.
   *
   * Accepted alongside `readOnly` because the admin sets the two independently,
   * and a field honouring one of them is a field that is wrong half the time.
   * Both mean the same thing here: there is no way in.
   */
  disabled?: boolean;
}

/**
 * Every left panel the editor can fill today.
 *
 * The inserter, the layers tree and the tokens studio; the rest are not built.
 * The shell draws all seven regardless and disables the ones nothing fills, so
 * the rail describes the editor's shape while never opening a region with
 * nothing in it. Listing a panel here that renders nothing would reserve space
 * and shrink the canvas to show it, which is why this grows one entry at a time
 * rather than being declared ahead of the panels.
 */
const AVAILABLE_PANELS = ["insert", "layers", "tokens"] as const;

/**
 * With an entry-fields panel to fill, `settings` joins them.
 *
 * Derived rather than declared twice: the shell draws a panel outside
 * `availablePanels` as disabled and "coming soon", and warns against OPENING
 * one nothing renders into — reserving width to display nothing reads as a
 * broken control rather than an absent feature. So the list and the renderer
 * move together by construction, and the rail cannot disagree with the body.
 */
const AVAILABLE_PANELS_WITH_SETTINGS = [
  ...AVAILABLE_PANELS,
  "settings",
] as const;

/** Names the registry attributes these blocks to, for diagnostics. */
const PLUGIN_SOURCE = "@nextlyhq/plugin-page-builder";

/**
 * Put the core blocks in the BROWSER's registry.
 *
 * The plugin registers them during its own setup, which runs in the server
 * process. The engine's registry is module state, so the copy loaded into the
 * admin's client bundle is a different one and starts empty — and everything
 * the editor asks flows through it: `allBlocks` fills the inserter,
 * `registryNestingSource` decides what a position accepts, and the renderer
 * resolves a node's type to something it can draw.
 *
 * Registering once, here, rather than handing each of those its own list is
 * what keeps them agreeing. Given separate lists, the palette could offer a
 * block the renderer cannot draw and the nesting rule has never heard of — and
 * an empty registry fails SILENTLY in the permissive direction, because a block
 * nobody has heard of declares no parent and is therefore allowed everywhere.
 *
 * Filtered by `hasBlock` because registration refuses a redefinition, and this
 * runs again on every hot reload and every remount of the editor.
 */
function ensureCoreBlocksRegistered(): void {
  const missing = coreBlocks.filter(block => !hasBlock(block.name));
  if (missing.length > 0) registerBlocks(missing, { source: PLUGIN_SOURCE });
}

/**
 * A stored value that is not a usable document is treated as absent.
 *
 * The field's value arrives from storage, so it is whatever a previous version,
 * a migration, an import or a hand-edited row left there — `null`, a string of
 * JSON, an object from the old `{version, root}` shape. The canvas walks
 * `nodes`, so anything without an array there would throw inside the render
 * rather than at this boundary, and an editor that crashes on open gives an
 * author no way to repair the value.
 *
 * Exported for its own tests: it is the only place a malformed stored document
 * is turned into a safe one, and it is worth asserting directly rather than
 * through a rendered editor.
 */
export function documentFrom(value: unknown): BlockDocument {
  if (typeof value !== "object" || value === null) return emptyBlockDocument();
  const candidate = value as Partial<BlockDocument>;
  return Array.isArray(candidate.nodes)
    ? (value as BlockDocument)
    : emptyBlockDocument();
}

/**
 * Whether this field may be edited at all.
 *
 * Exported and tested apart from the render for the same reason `documentFrom`
 * is: this package has no DOM harness, and the rule is worth pinning on its own
 * because getting it wrong is not cosmetic. A blocks field that ignored
 * `readOnly` offered a full-screen editor from inside a version-history view,
 * bound to the SNAPSHOT'S form — so committing wrote into a past version of the
 * document.
 *
 * Both flags mean the same thing here. The admin sets them independently —
 * `readOnly` for a document being read, `disabled` for no permission or a form
 * mid-submit — and a field honouring one of them is a field that is wrong half
 * the time.
 */
export function canEditBlocks(options: {
  readOnly?: boolean;
  disabled?: boolean;
}): boolean {
  return options.readOnly !== true && options.disabled !== true;
}

export function BlocksField<TFieldValues extends FieldValues = FieldValues>({
  name,
  control,
  readOnly = false,
  disabled = false,
}: BlocksFieldProps<TFieldValues>) {
  const [open, setOpen] = useState(false);
  const { field } = useController({ name, control });

  const editable = canEditBlocks({ readOnly, disabled });

  /*
   * Closed if the form becomes read-only while the editor is up.
   *
   * Not a hypothetical: a permission can be revoked and a form can start
   * submitting under an open editor. Rendering the summary instead of the
   * editor from that render on is not enough on its own — the state has to go
   * back too, or reopening later would show an editor seeded from a value the
   * author has not seen since.
   */
  if (open && !editable) setOpen(false);

  return open && editable ? (
    <BlocksEditor
      // Remounted per opening: the editor seeds its own history from the value
      // it opened with, and a key change is what discards a previous session's
      // undo stack rather than carrying it into a document it cannot describe.
      key={String(field.value === undefined ? "empty" : "seeded")}
      initialValue={field.value}
      onCommit={field.onChange}
      onClose={() => setOpen(false)}
      // Named and controlled so the editor can record its live document as
      // part of the whole document's recovery point — see `useCheckpoints`.
      name={name}
      control={control}
    />
  ) : (
    <div className="flex flex-col gap-3">
      <BlocksSummary name={name} control={control} />
      {/*
        No button at all rather than a disabled one.
        
        A disabled control says "you could do this, but not now", which is the
        wrong sentence for a document that cannot be edited at all — and the
        summary above already says what the field holds. An affordance that
        cannot ever act here is one an author spends attention on.
      */}
      {editable ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Edit blocks
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Record the LIVE document as this author's recovery point while the editor is
 * open.
 *
 * The form cannot do this for itself. Its own recording writes the values it
 * holds, and this field's value is deliberately not among them until the editor
 * exits — so an author who spends twenty minutes laying out a page and then
 * loses the tab has, from the form's point of view, changed nothing at all. The
 * recording is what closes that gap; the commit-on-exit rule above is what
 * makes it necessary, and neither is a workaround for the other.
 *
 * Recorded as the WHOLE document rather than as this field alone, because
 * restoring a recovery point replaces the form's values wholesale: a snapshot
 * carrying only the layout would restore cleanly and blank the title beside it.
 *
 * The very document the editor opened with is deliberately not recorded. It is
 * what the server already holds, and storing it would offer the author their
 * own unmodified page back as "unsaved changes from a moment ago".
 */
function useCheckpoints<TFieldValues extends FieldValues>({
  name,
  control,
  document,
}: {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  document: BlockDocument;
}): void {
  const values = useWatch({ control });
  const snapshot = useMemo(
    () => withValueAtPath(values as Record<string, unknown>, name, document),
    [values, name, document]
  );

  const { schedule } = useDocumentCheckpoint({ snapshot });

  /*
   * A new document object is what an edit produces — the editor's state is
   * replaced rather than mutated — so reference inequality is the signal, and
   * a render caused by anything else asks for nothing.
   */
  const openedWith = useRef(document);
  useEffect(() => {
    if (document === openedWith.current) return;
    schedule();
  }, [document, schedule]);
}

/**
 * The editor itself, mounted only while open.
 *
 * Separate component so the hooks below — editor state, and the chrome request
 * — run only when there is an editor. Calling them from the control above would
 * ask the admin to hide its navigation for every entry form holding a blocks
 * field, open or not.
 */
/**
 * The tokens an inspector may offer, or `undefined` while the site's own tier
 * is still unknown.
 *
 * Withheld on exactly the two states that hold the CANVAS back, and for the
 * same reason. Until the stored read answers, the merged value is the config
 * defaults alone — a real design rather than a placeholder — so a picker fed
 * from it offers a token by a name and a colour the site may have overridden,
 * and the identity an author chooses then resolves to something else on the
 * published page. The error path matters as much as the pending one: `pending`
 * is false there while the value has still fallen back to defaults.
 *
 * `undefined` rather than an empty set, because the control reads absence as
 * "the question was never asked" and offers no picker at all — which is the
 * truth here, and is different from a site that defines no tokens.
 */
function offerableTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  // A SET even when the site defines nothing, because the renderer compiles
  // with `resolveSiteTokens`, which layers the engine's own defaults underneath.
  // A site with no tokens of its own still emits `color.text`, `color.primary`
  // and the rest, so handing over `undefined` here would have the picker offer
  // none of them — and `undefined` already means something else to the control:
  // that the question was never asked.
  return style?.tokens ?? { tokens: [] };
}

function BlocksEditor<TFieldValues extends FieldValues = FieldValues>({
  initialValue,
  onCommit,
  onClose,
  name,
  control,
}: {
  initialValue: unknown;
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
}) {
  // Before anything reads the registry. Inside the component that mounts the
  // editor rather than at module scope: this file is imported by the field
  // control, which every entry form holding a blocks field renders whether or
  // not the editor is ever opened.
  ensureCoreBlocksRegistered();

  const initialDocument = useMemo(
    () => documentFrom(initialValue),
    [initialValue]
  );
  const editor = useEditorState({ initialDocument });

  /*
   * Dragging blocks on the canvas.
   *
   * The registry answers both questions, and it is the SAME registry the
   * inserter reads — so a container the palette will put a block into is a
   * container a drag can aim at. Given separate sources the two would disagree,
   * and a block would behave differently depending on how the author reached
   * it.
   */
  const slots = useMemo(registrySlotSource, []);
  const nesting = useMemo(registryNestingSource, []);
  const drag = useCanvasDrag({ editor, slots, nesting });

  /*
   * Typing a block's text on the canvas. The hook owns the caret; which values
   * may be typed into is the block's own declaration, read by the builder.
   */
  const inline = useInlineText(editor);

  /*
   * The entry's other fields, or null when there is no surrounding form. Null
   * is what withholds the panel rather than opening an empty one.
   */
  const renderEntryFields = useEntryFieldsPanel();

  /*
   * The getting-started card, and the host's switch for it.
   *
   * `checklist === false` is the only value that turns it off: an absent
   * config and a malformed one both leave it on, because the default is the
   * behaviour a site that configured nothing asked for.
   */
  const clientConfig = usePluginClientConfig(PLUGIN_SOURCE);
  const checklist = useBuilderChecklist({
    document: editor.document,
    enabled: clientConfig?.checklist !== false,
  });

  /*
   * The site style the canvas draws with: the host's config DEFAULTS, already
   * resolved by the plugin factory and delivered as plain data. Narrowed with
   * the same checks the server writes by, so a malformed value degrades to
   * the empty style (block defaults and the engine's guaranteed tokens)
   * rather than crashing the editor.
   *
   * BOTH tiers, which is what makes the canvas a preview of the published page
   * rather than of the repository. The defaults are the host's code-stated
   * design, delivered as plain data; the stored tier is what an admin saved,
   * read through the same client every style studio uses and merged by
   * `resolveSiteStyle` — the one place those two meet, on the server and here
   * alike. Drawing from the defaults alone showed an author a page that
   * differed from the live one at exactly the properties someone had
   * deliberately overridden.
   *
   * A save re-renders this without anything being told to: the studios and this
   * canvas read one query, so the cache update IS the propagation. There is no
   * preview channel to keep in step because there are not two sources to keep
   * in step.
   */
  const configSiteStyle = useMemo(
    () => readSiteStyleRecord(clientConfig?.siteStyle),
    [clientConfig]
  );
  const {
    siteStyle: canvasSiteStyle,
    pending: siteStylePending,
    error: siteStyleError,
  } = useSiteStyle(configSiteStyle);
  /*
   * The studio's write. Section-scoped, so saving tokens leaves the fonts,
   * classes and breakpoints sections exactly as they were — four surfaces own
   * four fields of one record, and a whole-document write from any of them
   * would clobber whatever the others had saved since it last read.
   */
  const { save: saveSiteStyle } = useSaveSiteStyle();
  /*
   * The studio's own latest set, and the authority while it is open.
   *
   * `useSiteStyle` answers from a query that is only refetched after a save
   * lands, so two edits made before that — two blurs, two removals, a double
   * Add — would both compose against the SAME snapshot and the second would
   * overwrite the first. Nothing would report it: the mutation serialises the
   * two payloads and neither fails. Composing against this instead means every
   * edit builds on the one before it.
   */
  const [tokenEdits, setTokenEdits] = useState<SiteTokenSet | null>(null);
  /* What the last save said, when it refused. */
  const [tokenIssue, setTokenIssue] = useState<string | undefined>(undefined);
  /*
   * The last set a save is KNOWN to have stored, and what a refused edit falls
   * back to. Not "whatever was on screen before it": after an earlier refusal
   * that is itself a value the site never accepted, so restoring it would show
   * the author something no storage anywhere agrees with. A ref rather than
   * state because nothing renders from it.
   */
  const persistedTokens = useRef<SiteTokenSet | null>(null);
  /*
   * The most recent edit handed to a save, and the one question both branches
   * below ask: is this answer still about what the author is looking at? An
   * answer for a superseded edit must neither roll the newer one back nor
   * announce a refusal the newer save has already made irrelevant.
   */
  const latestTokenEdit = useRef<SiteTokenSet | null>(null);

  /*
   * The hosts this site loads media from, read back from the same client
   * config the plugin published them on.
   *
   * ONE read for TWO surfaces below, because the canvas and the inspector
   * enforce the same rule at different moments — the canvas when it draws a
   * block's image, the inspector when it judges a style value at the
   * keystroke — and a second read here would be a second chance to disagree
   * about what this site allows.
   *
   * `undefined` survives as `undefined` all the way to both consumers, which
   * is what leaves a site that configured nothing exactly as permissive as it
   * is today. `readRemotePatterns` is what keeps that distinction from
   * collapsing into an empty allowlist that would refuse every remote image.
   */
  const remotePatterns = useMemo(
    () => readRemotePatterns(clientConfig?.remotePatterns),
    [clientConfig]
  );

  /*
   * What the inspector judges a written URL by.
   *
   * Without this the Style tab asks the engine to validate a value with no
   * host policy, and absent means UNASKED rather than allowed — so a URL
   * naming a host this site does not load from is accepted at the keystroke,
   * previewed, and stored, then dropped by the published compiler, which does
   * apply the policy. The author sees a value that works while editing and
   * vanishes on the page.
   *
   * Carries only the host half today. The token half of `StylePolicy` arrives
   * with the client path to the stored site-style document; until then a token
   * reference is judged by the engine's own table.
   */
  const stylePolicy = useMemo(
    () => hostFetchPolicy(remotePatterns),
    [remotePatterns]
  );

  /*
   * What the canvas hands `PageRenderer` beyond the document and the sheet.
   *
   * `styleContext` is the per-node style tier, a SEPARATE input from
   * `siteStyles` that was once reaching only the published page. `PageRenderer`
   * compiles a document's own node styles only when it is given a style
   * context; without one `resolvePageStyles` withholds the sheet and — in its
   * own words — "Classes are kept either way, so blocks still carry the names
   * the rest of the system expects". The symptom is therefore silent and
   * specific: every block carries its `nx-pb-<hash>` class and nothing defines
   * it, so an author's margins, spacing and dimensions render on the published
   * page and vanish in the editor. Measured before this existed: the same
   * document rendered zero scoped rules and flush blocks here, six rules and
   * 24px gaps through the public route.
   *
   * The breakpoints come from `siteBreakpoints()` rather than a set spelled
   * here, because `site-style.ts` exists precisely so the field validator and
   * the canvas cannot disagree about what this site's breakpoints are.
   *
   * `hostPolicy` is what makes the canvas enforce the allowlist the published
   * page enforces. Absent, `RenderNode`'s image and embed boundaries test
   * `patterns === undefined || isFetchableUrl(...)` and let everything through
   * — so the editor drew media from hosts the live page drops, which is the
   * preview lying in the one direction an author cannot detect.
   *
   * Memoized as a whole because `Canvas` keys its rendered tree on this
   * object's identity: rebuilt inline it is a fresh object on every render,
   * and the tree behind it is re-rendered on every selection and keystroke.
   */
  const canvasRender = useMemo(
    () => ({
      styleContext: { breakpoints: siteBreakpoints(canvasSiteStyle) },
      ...(remotePatterns === undefined
        ? {}
        : { hostPolicy: { remotePatterns } }),
    }),
    [canvasSiteStyle, remotePatterns]
  );

  useCheckpoints({ name, control, document: editor.document });

  /*
   * Tell the form this editor holds work its values do not contain, so the
   * navigation guard warns and the save shortcut works while the canvas is
   * open. `undoDepth` rather than comparing documents: an edit and its undo
   * leave a document equal to the original but not identical to it, so a
   * reference comparison would report work that was taken back.
   *
   * Retracted when this component unmounts, which is the same moment `done`
   * commits the document and makes the form dirty for real.
   */
  useReportUnsavedWork(`blocks:${name}`, editor.undoDepth > 0);

  /*
   * Writing back on the way out rather than on every keystroke.
   *
   * The form owns the value and its dirty flag; the editor owns the document
   * and its history. Committing on each change would mark the entry dirty for
   * an edit the author then undoes, and would make the form's undo and the
   * editor's undo two answers to one question.
   */
  const done = useCallback(() => {
    onCommit(editor.document);
    onClose();
  }, [editor.document, onCommit, onClose]);

  /*
   * The editor takes the window: the shell draws its own rail, panels, top bar
   * and bottom bar, so admin chrome around it is a second set of the same
   * furniture, and the canvas is the one surface whose purpose is the space it
   * is given.
   *
   * `canExit` is derived from the handler passed to the shell as `onExit`, which
   * is what decides whether a way back is rendered at all. The admin withholds
   * the navigation rail from any surface that cannot be left, so a mount that
   * ever stops rendering an exit keeps its rail automatically instead of
   * stranding an author inside a full-screen editor.
   */
  useSuppressAdminChrome({
    layers: [
      "primaryRail",
      "subSidebar",
      "documentSidebar",
      "header",
      "pageFrame",
    ],
    canExit: true,
  });

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <BuilderShell
        onExit={done}
        availablePanels={
          renderEntryFields === null
            ? AVAILABLE_PANELS
            : AVAILABLE_PANELS_WITH_SETTINGS
        }
        // Whether the page is live, which the admin's own chrome would have
        // shown had this editor not asked for it to be hidden. `undoDepth` is
        // the editor's OWN dirty signal: the form's is false for as long as the
        // editor is open, because the document is committed on the way out.
        topBar={<DocumentStatusPill isDirty={editor.undoDepth > 0} />}
        // The shell owns the region; this fills it. Rendered unconditionally
        // rather than only when something is selected, because the panel states
        // "select a block to edit it" — a region that appears and disappears
        // with the selection makes the canvas resize on every click.
        // The policy travels with the panel because the Style tab judges a
        // written value at the keystroke and has to reach the same verdict the
        // published compiler will.
        //
        // The tokens travel with it for the same reason one step further: a
        // colour control offers the site's tokens and resolves a stored
        // reference to the name an author currently reads, and `policy.tokens`
        // cannot serve either — a `TokenLookup` answers ABOUT a name the caller
        // already holds and cannot enumerate one. This is the MERGED set the
        // canvas compiles with, so the picker offers exactly the tokens the
        // page will resolve.
        inspector={
          <InspectorPanel
            editor={editor}
            policy={stylePolicy}
            tokens={offerableTokens(
              canvasSiteStyle,
              siteStylePending,
              siteStyleError
            )}
          />
        }
        // Switched on the panel id rather than rendering the inserter for
        // whatever the rail reports open. The shell asks for the panel it
        // opened, and a renderer ignoring that argument would draw the inserter
        // under every heading the moment a second panel is listed above.
        // The trail sits in the bottom bar, which the shell owns. Passed as a
        // slot rather than rendered beside the canvas so it cannot overlap the
        // page an author is editing.
        breadcrumb={<SelectionBreadcrumb editor={editor} />}
        // Rendered only while it has somewhere to go: passing an element the
        // shell would position and then hide leaves an empty positioner over
        // the canvas.
        checklist={
          checklist.visible ? (
            <OnboardingChecklist
              steps={checklist.steps}
              onDismiss={checklist.dismiss}
            />
          ) : undefined
        }
        renderPanel={panel => {
          if (panel === "insert") {
            return (
              <InsertPanel editor={editor} categoryOrder={CORE_CATEGORIES} />
            );
          }
          if (panel === "layers") return <LayersPanel editor={editor} />;
          if (panel === "tokens") {
            const merged = offerableTokens(
              canvasSiteStyle,
              siteStylePending,
              siteStyleError
            );
            return (
              <TokensPanel
                tokens={tokenEdits ?? merged}
                supplied={configSiteStyle?.tokens}
                issue={tokenIssue}
                onChange={next => {
                  /*
                   * Saved as it is edited rather than behind a save button. A
                   * token is site-wide, so the canvas behind this panel is the
                   * preview — an unsaved edit would show the author a page no
                   * visitor would see, with no other surface on which to
                   * notice the difference.
                   */
                  setTokenEdits(next);
                  setTokenIssue(undefined);
                  latestTokenEdit.current = next;
                  void saveSiteStyle(
                    "tokens",
                    /*
                     * Only what DIFFERS from the site's own defaults. The set
                     * above is the merged one the canvas compiles, so saving it
                     * whole would copy every config token into the database on
                     * the first edit and mask the site's code from then on.
                     */
                    tokenOverrideOf(configSiteStyle?.tokens, next)
                  ).then(result => {
                    const current = latestTokenEdit.current;
                    if (result.saved) {
                      persistedTokens.current = next;
                      /*
                       * A refusal for an EARLIER edit can arrive after a later
                       * one has already cleared the message, so the studio
                       * would go on announcing that a set it did save was not
                       * saved, until the author happened to edit again.
                       */
                      if (current === next) setTokenIssue(undefined);
                      return;
                    }
                    /*
                     * A refused save leaves the panel showing what the author
                     * typed while the site still holds the old value — so the
                     * edit is put back and the refusal is said out loud.
                     * Discarding this promise makes a validation failure, a
                     * missing permission and a dropped network all look
                     * exactly like success.
                     *
                     * Rolled back only while this edit is still what is on
                     * screen: an author can type again before an answer
                     * arrives, and that later edit has its own save in flight.
                     */
                    if (current !== next) return;
                    setTokenEdits(
                      tokensAfterRefusal(current, next, persistedTokens.current)
                    );
                    setTokenIssue(
                      Object.values(result.issues ?? {})[0] ??
                        "That change was not saved."
                    );
                  });
                }}
              />
            );
          }
          /*
           * The entry's own fields — SEO, relations, whatever this collection
           * declares — which the takeover removed from the page behind this
           * editor. Rendered by the ADMIN's closure, not reconstructed here: how
           * a field is drawn is the entry form's contract, and a second
           * renderer would drift from it.
           */
          if (panel === "settings") return renderEntryFields?.(name) ?? null;
          return null;
        }}
      >
        {/*
          Inside the shell, which is what provides the shortcut context — a
          caller rendering the shell is outside it and cannot register bindings.
          It draws the live region and publishes the structural verbs to what it
          wraps, which is how the toolbar presses exactly what the keys press.
        */}
        <BlockKeyboardActions editor={editor} onEditText={inline.begin}>
          {/*
            Inside the verbs provider, which is what lets the palette run
            exactly what the keystrokes and the toolbar run.

            `onExit` is the SAME handler the shell's exit button gets, so
            leaving through the palette commits the document exactly as leaving
            through the button does. Passing a different one — or omitting it
            while the button exists — would give the editor two ways out that
            behave differently.
          */}
          <EditorCommandPalette editor={editor} onExit={done} />
          {/*
            Held back until the stored style has arrived.

            `useSiteStyle` answers with the host's defaults while the read is in
            flight, and those defaults are a legitimate design rather than a
            placeholder — so a canvas mounted on them looks finished and is
            wrong at exactly the properties an admin overrode. The author would
            see the page re-lay-out under them, and could start dragging against
            a design the site does not have.

            A FAILED read is held back for the same reason, and it is not the
            same state. When the request exhausts its retry — a network fault,
            or a 403 for an editor without `read-site-style` — `pending` goes
            false while the merged value falls back to the config defaults. So
            "not pending" alone would mount a finished-looking canvas over a
            stored tier nobody has read, which is the exact problem the wait was
            added to prevent, arrived at down the failure path instead. Absent
            is not the same as unknown, and the author is told which.

            Only the canvas waits. The shell, the rail and the inspector are all
            about the DOCUMENT, which is already in hand, and blanking them
            would make the editor feel slower than it is. After the first open
            the read is cached, so this is one brief state per session rather
            than one per opening.
          */}
          {siteStylePending || siteStyleError !== null ? (
            <p
              className="nx-inspector__note"
              data-canvas-state={siteStyleError === null ? "loading" : "failed"}
            >
              {siteStyleError === null
                ? "Loading this site\u2019s styles\u2026"
                : "This site\u2019s styles could not be loaded, so the canvas would not match the published page. Reload to try again."}
            </p>
          ) : (
            <Canvas
              document={editor.document}
              siteStyles={siteSheet(canvasSiteStyle)}
              selectedId={editor.selectedId}
              selectedIds={editor.selection.ids}
              onSelect={editor.select}
              // The style context and the host policy, derived above so both are
              // one object with one identity rather than rebuilt per render.
              render={canvasRender}
              dragHandlers={drag.handlers}
              // The pointer route into typing a block's text. Its keyboard
              // counterpart is the Enter binding above, registered in the same
              // place so a surface cannot gain one without the other.
              onDoubleClick={inline.onDoubleClick}
              // Both pieces of chrome go through the canvas rather than beside it,
              // because both are positioned in the canvas's own content
              // coordinates and the canvas root is what establishes them.
              overlay={
                <>
                  <DropIndicator target={drag.target} />
                  {/*
                  Suppressed for the duration of a drag. The bar would otherwise
                  sit over the canvas the author is aiming at, naming a block
                  that is in the middle of moving.
                */}
                  <BlockToolbar
                    editor={editor}
                    hidden={drag.draggingId !== null}
                  />
                  {/*
                  Suppressed for the same reason and by the same signal. The
                  bands report a layout that is mid-change during a drag, so
                  every value on them is about to be wrong.
                */}
                  <SpacingOverlay
                    editor={editor}
                    hidden={drag.draggingId !== null}
                  />
                </>
              }
            />
          )}
        </BlockKeyboardActions>
      </BuilderShell>
    </div>
  );
}
