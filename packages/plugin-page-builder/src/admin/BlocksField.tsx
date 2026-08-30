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
  resolveSiteTokens,
  isPlainRecord,
  DEFAULT_LIMITS,
  type DocumentLimits,
  getBlock,
  hasBlock,
  registerBlocks,
  registryNestingSource,
  previewContainerFor,
  newId,
  type BlockDocument,
  type BreakpointSet,
  type NamedClass,
  type SiteTokenSet,
  type BreakpointId,
  type FontFaceDef,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { CORE_CATEGORIES, coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  DEFAULT_PREFERENCES,
  registrySlotSource,
  type LeftPanel,
} from "@nextlyhq/builder";
import {
  BlockKeyboardActions,
  authoredBreakpoints,
  BlockToolbar,
  BreakpointManager,
  BreakpointSwitcher,
  type CanvasZoom,
  breakpointsAtWidth,
  editedBreakpointAtWidth,
  offeredTiers,
  selectableTiers,
  widthForBreakpoint,
  BlockContextMenu,
  EditorCommandPalette,
  BuilderShell,
  Canvas,
  DropIndicator,
  EmptyContainerAppenders,
  InsertPanel,
  InspectorPanel,
  selectionIsInspectable,
  pageStyleTrace,
  LayersPanel,
  TokensPanel,
  OnboardingChecklist,
  SelectionBreadcrumb,
  SpacingOverlay,
  useBuilderChecklist,
  useCanvasDrag,
  useEditorState,
  useInlineEditing,
  documentAfter,
  type InlineEditOutcome,
  ClassManagerPanel,
  type ClassCreation,
  FontsPanel,
  type ClassRenameOutcome,
} from "@nextlyhq/builder/shell";
import {
  loadInlineRichTextEditor,
  useDocumentCheckpoint,
  usePluginClientConfig,
  useEntryFieldsPanel,
  useReportUnsavedWork,
  useSuppressAdminChrome,
} from "@nextlyhq/plugin-sdk/admin";
// From @nextlyhq/ui rather than sonner: the Toaster the admin mounts is ui's,
// and sonner keeps its queue in module state, so a toast published into another
// bundled copy would never reach it.
import {
  chordMatches,
  detectApplePlatform,
  parseKeys,
  toast,
} from "@nextlyhq/ui";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useController,
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { classUsageOf } from "../class-usage";
import { emptyBlockDocument } from "../fields/blocks-document";
import { hostFetchPolicy, readRemotePatterns } from "../host-policy";
import {
  classOverrideOf,
  tokenOverrideOf,
  tokenSaveOutcome,
  siteBreakpoints,
  siteSheet,
  type SiteStyleData,
} from "../site-style";
import { readSiteStyleRecord } from "../site-style-record";

import { BlocksSummary } from "./BlocksSummary";
import { DocumentStatusPill } from "./DocumentStatusPill";
import { useSaveSiteStyle, useSiteStyle } from "./site-style-client";
import { withValueAtPath } from "./snapshot-merge";
import { useShown } from "./use-shown";

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
const AVAILABLE_PANELS = [
  "insert",
  "layers",
  "tokens",
  "fonts",
  "classes",
] as const;

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
 * Whether the empty-container appender should be suppressed right now.
 *
 * Two independent reasons collapse into one boolean here, named, rather than
 * inlined at the JSX call site: a drag in progress, where the document is
 * mid-change, and the author having turned empty-container chrome off, where
 * the container this control would sit over has collapsed to zero height. A
 * bare `||` at the call site reads as one condition; naming it is what says
 * these are two unrelated causes that happen to share an operator.
 */
function emptyContainerAppenderHidden(
  dragging: boolean,
  showEmptyElements: boolean
): boolean {
  return dragging || !showEmptyElements;
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
/**
 * The faces the site loads, or `undefined` while that is not yet known.
 *
 * The same third state `offerableTokens` keeps, and for the same reason: a site
 * that self-hosts nothing legitimately has no faces, so a surface cannot tell
 * "none stored" from "the read has not come back" by looking at the value. The
 * fonts panel draws those two differently, and would otherwise report a site
 * mid-load as one loading no fonts at all.
 *
 * Unlike tokens there are no engine defaults to layer underneath — a font file
 * is something a site provides or does not — so the resolved list is returned
 * as it stands, including an empty one.
 */
function offerableFaces(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): readonly FontFaceDef[] | undefined {
  if (pending || error !== null) return undefined;
  return style?.fonts ?? [];
}

/**
 * The tokens as the PAGE renders them, defaults included.
 *
 * Deliberately not `offerableTokens`. A studio edits what the site AUTHORED —
 * showing the engine's defaults as rows an author can rename would offer edits
 * that write nothing — while a report on what the page draws has to read what
 * the page draws. `resolveSiteTokens` layers the engine's own underneath, and
 * one of them is `font.body: system-ui`, a real typeface every site renders
 * with. Reading the authored set had the panel announce "no typeface tokens"
 * for a site whose every page was using one.
 */
function renderedTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  return resolveSiteTokens(style?.tokens);
}

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

/**
 * The tokens studio, and the state that belongs to it rather than to the editor.
 *
 * Its own component because the token set an author is part-way through editing
 * is the STUDIO's business: the editor around it owns a document, and a panel's
 * unsaved half-state living in that editor is state with no reader outside one
 * branch of one render.
 *
 * Saved as it is edited rather than behind a save button. A token is site-wide,
 * so the canvas behind this panel is the preview — an unsaved edit would show
 * the author a page no visitor would see, with no other surface on which to
 * notice the difference.
 */
function TokensStudio({
  merged,
  supplied,
  pending,
}: {
  /** The site's tokens as the canvas compiles them: config under stored. */
  merged: SiteTokenSet | undefined;
  /** What the site's own code supplies, which the stored tier layers over. */
  supplied: SiteTokenSet | undefined;
  /** Whether the read is still in flight, as against having failed. */
  pending: boolean;
}): React.JSX.Element {
  const { save } = useSaveSiteStyle();
  /*
   * What the CANVAS resolves, which is what the studio has to show and edit.
   *
   * `resolveSiteTokens` layers the engine's own defaults — `color.primary`,
   * `color.text`, `space.4` and the rest — under whatever the site states, and
   * the renderer compiles with it. Without that step here, the studio reports
   * every category empty on a site that states no tokens of its own, while the
   * page it is previewing is actively using them and the colour picker beside
   * it offers them. They could then be neither seen nor overridden: adding a
   * token and renaming it to a default's label does not reach one, because the
   * rename freezes the new token's own identity.
   *
   * The baseline for the override is resolved for the same reason. Storing what
   * differs from the CONFIG alone would write every engine default into the
   * database on the first edit — the same fault as saving the merged set, one
   * tier further down.
   */
  const editable = merged === undefined ? undefined : resolveSiteTokens(merged);
  const baseline = resolveSiteTokens(supplied);
  /*
   * The studio's own latest set, and the authority while it is open.
   *
   * `useSiteStyle` answers from a query refetched only after a save lands, so
   * two edits made before that — two blurs, two removals, a double Add — would
   * both compose against the SAME snapshot and the second would overwrite the
   * first. Nothing would report it: the mutation serialises the payloads and
   * neither fails. Composing against this means every edit builds on the last.
   */
  const [edits, show, shownNow] = useShown<SiteTokenSet | null>(null);
  const [issue, setIssue] = useState<string | undefined>(undefined);
  /*
   * The last set a save is KNOWN to have stored, and what a refused edit falls
   * back to — not "whatever was on screen before it", which after an earlier
   * refusal is itself a value the site never accepted.
   */
  const persisted = useRef<SiteTokenSet | null>(null);
  /* The most recent edit handed to a save, and the one question both branches
   * of an answer ask: is this still about what the author is looking at? */
  const latest = useRef<SiteTokenSet | null>(null);

  const commit = (next: SiteTokenSet): void => {
    show(next);
    setIssue(undefined);
    latest.current = next;
    void save(
      "tokens",
      /*
       * Only what DIFFERS from the site's own defaults. `merged` is what the
       * canvas compiles, so saving it whole would copy every config token into
       * the database on the first edit and mask the site's code from then on.
       */
      tokenOverrideOf(baseline, next)
    ).then(result => {
      const outcome = tokenSaveOutcome(
        result.saved,
        result.issues,
        next,
        latest.current,
        persisted.current
      );
      if (result.saved) persisted.current = next;
      if (outcome.tokens !== undefined) show(outcome.tokens);
      if (outcome.issue !== undefined) setIssue(outcome.issue ?? undefined);
    });
  };

  return (
    <TokensPanel
      tokens={edits ?? editable}
      supplied={baseline}
      issue={issue}
      absence={pending ? "pending" : "failed"}
      onChange={commit}
      /*
       * The set as it is at the moment an import needs it, rather than the one
       * the panel last rendered with. `shown` is written before React is told
       * anything, so it answers for an edit the panel has not been re-rendered
       * with yet.
       */
      currentTokens={() => shownNow() ?? editable}
    />
  );
}

/**
 * Writing the site's breakpoints, for the manager in the top bar.
 *
 * A hook rather than a callback inside the editor, because that component is
 * already the largest branch point on this surface and every decision folded
 * into it is one more path through the whole thing. What it needs from here is
 * one stable function.
 *
 * Section-scoped, so this sends the breakpoints and nothing else — the other
 * three fields of the record are owned by other studios and are not read here in
 * order to write this one.
 */
/**
 * Create a named class in the site's library, answering with its new id.
 *
 * Two documents are involved and this owns only one. The class lives in the
 * site style; putting it on a block is a node write the inspector already
 * performs, so this returns the id rather than applying it — one application
 * path, and the per-node bound stays enforced in a single place.
 *
 * The id is minted with the engine's own `newId`, which is where every other id
 * in this repository comes from. Deliberately not derived from the slug:
 * `NamedClass` keeps `id` and `slug` apart precisely so a rename cannot orphan
 * the documents referencing it, and a slug-seeded id would be a fossil of
 * whatever the class was called first.
 *
 * `orderIndex` is one past the highest in the library, so a class an author has
 * just created and applied wins over the ones already there rather than being
 * silently overridden by them.
 */
/**
 * One serialised writer for every whole-section class write.
 *
 * Every write here is read-modify-write over the WHOLE section: the payload is
 * the complete class list, because that is what `saveSection` stores. So the
 * list a write composes from decides what survives it, and the rendered
 * `library` is stale for as long as a save takes to come back through the
 * cache.
 *
 * Two things follow, and each was a separate defect.
 *
 * **Composition must happen inside the queue, not before it.** Serialising
 * only TRANSMISSION is not enough: both callers compose their payload, then
 * queue, so the second was already built without the first. `run` therefore
 * takes a FUNCTION and calls it after the previous write settles, so every
 * payload is composed against the result of the one before it.
 *
 * **One base, shared.** Creating and renaming are the same read-modify-write
 * over the same list. Two independent bases meant a rename that had not yet
 * refreshed was invisible to a creation, which then wrote a list carrying the
 * old slug — and in the other order, dropped the new class.
 *
 * A completed write ADVANCES the base; a fresh read from the host REPLACES it,
 * because the server's answer is authoritative the moment it arrives.
 */
interface ClassWrites {
  /**
   * Run one whole-section write, composed against the freshest list.
   *
   * The callback receives the base and answers with the payload it composed
   * plus its own result. Returning `next` separately is what lets this advance
   * the base ONLY when the write succeeded — a refused write changed nothing,
   * and building the following edit on it would persist something the server
   * rejected.
   */
  run: <T>(
    write: (existing: readonly NamedClass[] | undefined) => Promise<{
      result: T;
      next?: readonly NamedClass[];
    }>
  ) => Promise<T>;
}

function useClassWrites(
  library: readonly NamedClass[] | undefined
): ClassWrites {
  const held = useRef(library);
  /*
   * The host's answer supersedes anything composed locally. This runs only
   * when `library` changes identity, which is exactly when a re-read has
   * landed — during a save's window the identity is unchanged and the base
   * keeps whatever the writes advanced it to.
   */
  useEffect(() => {
    held.current = library;
  }, [library]);

  // The chain every write joins. Held as a ref so it survives re-renders: a
  // queue recreated on render would let two writes run concurrently again.
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(
      write: (existing: readonly NamedClass[] | undefined) => Promise<{
        result: T;
        next?: readonly NamedClass[];
      }>
    ): Promise<T> => {
      const started = tail.current.then(async () => {
        const answered = await write(held.current);
        if (answered.next !== undefined) held.current = answered.next;
        return answered.result;
      });
      // The chain must not break on a rejection, or every later write is
      // rejected with an error belonging to an edit the author has forgotten.
      tail.current = started.then(
        () => undefined,
        () => undefined
      );
      return started;
    },
    []
  );

  return { run };
}

/**
 * The document bounds the host renders under, as published to the browser.
 *
 * Read DEFENSIVELY and one key at a time: `clientConfig` is JSON that crossed a
 * transport, so nothing here can assume a shape. Anything unreadable falls back
 * to the engine's defaults, which is what the renderer itself falls back to —
 * so the two still agree rather than diverging in the direction that would
 * misreport which classes a page applies.
 */
function readDocumentLimits(
  clientConfig: Record<string, unknown> | undefined
): DocumentLimits {
  const declared = clientConfig?.limits;
  if (!isPlainRecord(declared)) return DEFAULT_LIMITS;
  // Built by overriding the defaults key by key rather than by asserting a
  // shape onto the transported value: the keys come from `DEFAULT_LIMITS`, so
  // a bound the engine adds later is carried without this being edited, and a
  // key the host sent that the engine does not have is ignored.
  const merged: DocumentLimits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof DocumentLimits)[]) {
    const supplied = declared[key];
    /*
     * Zero and Infinity are both LEGITIMATE bounds, so neither may be narrowed
     * away here. A host setting `maxNodes: 0` gets a renderer that draws
     * nothing, and substituting the default would have the panel mark classes
     * as present on a page that renders none of them; the engine supports an
     * infinite byte limit outright. What is refused is a value that is not a
     * number, or one below zero, which no bound can mean.
     */
    // `null` is the wire spelling for an INFINITE bound: `Infinity` is not a
    // JSON value and the client config is refused unless it survives the round
    // trip unchanged, so the publisher encodes it and this decodes it.
    if (supplied === null) {
      merged[key] = Number.POSITIVE_INFINITY;
      continue;
    }
    if (
      typeof supplied === "number" &&
      !Number.isNaN(supplied) &&
      supplied >= 0
    ) {
      merged[key] = supplied;
    }
  }
  return merged;
}

/**
 * Whether a read has FAILED rather than merely not finished yet.
 *
 * A separate function because "not arrived" and "will never arrive" are
 * different states with different wording, and reading them from one
 * expression inside the hook made the hook answer two questions at once.
 */
function classReadFailed(pending: boolean, error: unknown): boolean {
  return !pending && error !== null && error !== undefined;
}

/**
 * The library to show, or `undefined` while it is not known.
 *
 * `undefined` while the read is in flight, and the resolved list once it is
 * not — including an empty one. `useSiteStyle` names `pending` as a real third
 * state for exactly this reason: the defaults alone are a legitimate answer, so
 * a surface cannot tell "nothing is stored" from "the read has not come back"
 * by looking at the value.
 */
/**
 * The empty library, as ONE value rather than a fresh array each time.
 *
 * `?? []` builds a new array on every render, and `useClassWrites` reads a
 * changed identity as "the host has re-read" — so a site whose stored style
 * declares no classes looked like it was re-reading continuously, and any
 * render during an in-flight save reset the write base to the stale list. The
 * next queued write then composed from it and discarded the edit before it,
 * while reporting success.
 */
const NO_CLASSES: readonly NamedClass[] = Object.freeze([]);

function readableClassLibrary(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  failed: boolean
): readonly NamedClass[] | undefined {
  if (pending || failed) return undefined;
  // `undefined` above and `NO_CLASSES` here stay distinct: the first is a read
  // that has not answered, the second is one that answered with nothing.
  return siteStyle?.classes ?? NO_CLASSES;
}

function useClassSurface(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  error: unknown,
  /** The site's own config, whose classes storage layers over. */
  config: { classes?: readonly NamedClass[] } | undefined
) {
  // Derived outside the hook, so this decides nothing and only distributes what
  // was decided — which is what keeps the component rendering the inspector
  // free of the branch.
  const failed = classReadFailed(pending, error);
  const library = readableClassLibrary(siteStyle, pending, failed);
  const configured = config?.classes;
  /*
   * ONE writer for both edits. Creating and renaming are the same
   * read-modify-write over the same list, so two independent queues let a
   * rename that had not yet refreshed be invisible to a creation — which then
   * wrote a list carrying the old slug, and in the other order dropped the new
   * class.
   */
  const writes = useClassWrites(library);
  /*
   * Which name each class is heading for while its rename is on the network.
   *
   * Held HERE because it must survive the manager panel being unmounted, which
   * the rail does on every switch. State rather than a ref: the panel renders
   * from it, so a change has to reach the screen.
   */
  const [pendingSlugs, setPendingSlugs] = useState<Record<string, string>>({});
  const markPending = useCallback(
    (classId: string, slug: string | undefined) => {
      setPendingSlugs(current => {
        if (slug === undefined) {
          if (!(classId in current)) return current;
          const { [classId]: _gone, ...rest } = current;
          return rest;
        }
        if (current[classId] === slug) return current;
        return { ...current, [classId]: slug };
      });
    },
    []
  );
  return {
    library,
    /*
     * Which absence, so the selector can say so. A read that FAILED will not
     * finish, and a surface that goes on saying "loading" describes a state
     * the site is not in — the distinction the tokens studio already draws.
     */
    absence: failed ? ("failed" as const) : ("pending" as const),
    /*
     * Withheld while the library is unknown. A failed read leaves
     * `useSiteStyle` answering with the config defaults alone, so creating
     * against it would compose a library missing everything stored — and the
     * save would then delete those classes rather than add one.
     */
    create: useCreateClass(writes, configured),
    /** Which classes are mid-rename, for the manager's no-op check. */
    pendingSlugs,
    /*
     * Withheld the same way and for the same reason: renaming against a
     * library missing everything stored would save that partial list, which
     * deletes the classes it could not see rather than renaming one.
     */
    rename: useRenameClass(writes, configured, markPending),
  };
}

function useCreateClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  // Its own write handle rather than one passed in. The caller is already the
  // largest component in this file, and a dependency a hook can obtain for
  // itself is a statement that does not need to live there.
  const { save: saveSection } = useSaveSiteStyle();
  return useCallback(
    async (slug: string) =>
      // Composed INSIDE the queue, so a creation following a rename builds on
      // that rename rather than on the list they both started from.
      //
      // The result type is stated rather than inferred: inference takes the
      // first branch it meets, which is the refusal, and the success branch
      // then fails to assign.
      writes.run<ClassCreation>(async existing => {
        if (existing === undefined) {
          return {
            result: {
              ok: false as const,
              reason:
                "This site's classes could not be read, so none can be added.",
            },
          };
        }
        const classId = newId();
        const next: NamedClass[] = [
          ...existing,
          {
            id: classId,
            slug,
            orderIndex: nextOrderIndex(existing),
            styles: {},
          },
        ];
        /*
         * Only what DIFFERS from the site's own config classes. The base is the
         * MERGED set the canvas compiles, so saving it whole would copy every
         * config class into the database on the first creation and mask the
         * site's code from then on — the argument `tokenOverrideOf` already
         * makes for tokens.
         */
        const result = await saveSection(
          "classes",
          classOverrideOf(configured, next)
        );
        // `next` is returned ONLY on success, so a refused write never becomes
        // the base the following edit builds on.
        if (result.saved) {
          return { result: { ok: true as const, classId }, next };
        }
        const reasons = Object.values(result.issues);
        // An empty `issues` is still a refusal — the transport could not
        // describe it. Reporting it as saved is the one outcome that must never
        // be silent, which is the rule the breakpoints writer below follows too.
        return {
          result: {
            ok: false as const,
            reason:
              reasons.length > 0
                ? reasons.join(" ")
                : "This class could not be saved.",
          },
        };
      }),
    [writes, configured, saveSection]
  );
}

/**
 * Rename one class, through the same section write that creates one.
 *
 * Answers the OUTCOME rather than reporting success by staying quiet. A site
 * style save is a network write and the panel clears its field as soon as the
 * author finishes typing, so a refusal that returned nothing would leave the
 * row reading as renamed until the next read contradicted it.
 */
function useRenameClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined,
  /**
   * Record which name a class is heading for while its write is in flight.
   *
   * Held by the CALLER rather than by the panel, because a rename outlives the
   * panel: switching rail panels unmounts the manager, and a field remembering
   * its own pending name lost it on exactly the switch that makes the window
   * long enough to matter. Without it, an author who reverts a rename after
   * coming back has the revert read as a no-op while the first write lands.
   */
  markPending: (classId: string, slug: string | undefined) => void
) {
  const { save: saveSection } = useSaveSiteStyle();
  return useCallback(
    async (classId: string, slug: string): Promise<ClassRenameOutcome> => {
      markPending(classId, slug);
      try {
        return await writes.run<ClassRenameOutcome>(async existing => {
          if (existing === undefined) {
            return {
              result: {
                ok: false as const,
                reason:
                  "This site's classes could not be read, so none can be renamed.",
              },
            };
          }
          const next = existing.map(entry =>
            entry.id === classId ? { ...entry, slug } : entry
          );
          const result = await saveSection(
            "classes",
            classOverrideOf(configured, next)
          );
          if (result.saved) return { result: { ok: true as const }, next };
          const reasons = Object.values(result.issues);
          return {
            result: {
              ok: false as const,
              reason:
                reasons.length > 0
                  ? reasons.join(" ")
                  : "This class could not be renamed.",
            },
          };
        });
      } finally {
        /*
         * Cleared however it went, and in a `finally` so a rejection cannot
         * leave a class permanently reading as mid-rename. A refused write
         * leaves the class with the name it had; a successful one is followed
         * by a read carrying the new one. Either way the stored slug is the
         * answer again.
         */
        markPending(classId, undefined);
      }
    },
    [writes, configured, saveSection, markPending]
  );
}

/** One past the highest position in the library, or zero for an empty one. */
function nextOrderIndex(library: readonly NamedClass[]): number {
  return library.reduce(
    (highest, entry) =>
      Number.isFinite(entry.orderIndex)
        ? Math.max(highest, entry.orderIndex + 1)
        : highest,
    0
  );
}

function useBreakpointWriter(
  configSiteStyle: SiteStyleData | undefined
): (next: BreakpointSet) => Promise<string | undefined> {
  const { save: saveSiteStyle } = useSaveSiteStyle();
  /*
   * Whether the HOST states breakpoints in its config, which is what makes an
   * empty stored set unrepresentable. Read from the config tier rather than from
   * the merged value, because the merged one cannot tell a stored set from a
   * defaulted one — which is the ambiguity being guarded.
   *
   * Through the SAME base filter the manager uses. A config carrying only the
   * built-in `{ id: "base" }` row states no authored breakpoint, so counting it
   * refuses the one save that returns such a site to its base-only state — and
   * tells the author to remove a config row the manager deliberately hides as
   * built in. Three surfaces now ask this question and all three ask it once.
   */
  const configuredAuthored = authoredBreakpoints(configSiteStyle?.breakpoints);
  const configured =
    configuredAuthored.viewport.length > 0 ||
    configuredAuthored.container.length > 0;

  return useCallback(
    async (next: BreakpointSet): Promise<string | undefined> => {
      /*
       * An empty set is not storable as an intention while the host states
       * defaults, so it is refused rather than reported as saved.
       *
       * `resolveSiteStyle` layers the stored record over the host's config and
       * decides "was anything stored" with `hasBreakpoints`, which is
       * `viewport.length > 0 || container.length > 0`. So writing
       * `{ viewport: [], container: [] }` succeeds, reads back as NOTHING
       * STORED, and the config defaults return — the author removes every row,
       * is told it saved, and watches them reappear.
       *
       * Refusing says what happened and where the remaining breakpoints come
       * from, which is the one thing the author cannot see from this screen.
       * Representing "explicitly none" would take a stored-format change, and
       * that is not a decision this callback should make silently.
       */
      const emptied = next.viewport.length === 0 && next.container.length === 0;
      if (emptied && configured) {
        return "Your site's configuration defines these breakpoints, so removing them all here would restore them. Remove them from the config instead.";
      }
      const result = await saveSiteStyle("breakpoints", next);
      if (result.saved) return undefined;
      const reasons = Object.values(result.issues);
      // `issues` can be empty on a refusal the transport could not describe.
      // Answering `undefined` there would report a save that did not happen,
      // which is the one outcome that must never be silent.
      return reasons.length > 0
        ? reasons.join(" ")
        : "These breakpoints could not be saved.";
    },
    [saveSiteStyle, configured]
  );
}

/**
 * What the stored site style's read has DONE, in the manager's three words.
 *
 * Named rather than written inline for the reason the writer moved out of the
 * editor component: every decision folded into that function is another path
 * through the whole of it, and `fallow` reports the growth as introduced
 * complexity.
 *
 * `error === null`, not `!== undefined`. `useSiteStyle` types the field as
 * `Error | null` and normalises a successful read to `null`, so an `undefined`
 * comparison is true on success as well as on failure — the mistake that once
 * withheld the provenance trace unconditionally.
 */
function siteStyleStatus(
  pending: boolean,
  error: Error | null
): "loading" | "unavailable" | "ready" {
  if (pending) return "loading";
  return error === null ? "ready" : "unavailable";
}

/**
 * Whether anything in the editor is work the author has not saved.
 *
 * An OPEN inline edit counts, on top of the document's own history. Inline
 * editing does not touch the document until an edit finishes, so `undoDepth` is
 * still zero while an author is typing into a block — and a navigation or an
 * access-driven removal at that moment tears the canvas down without a blur,
 * leaving the guard as the only thing that could have asked first.
 *
 * Reported for an edit that is merely OPEN rather than one known to have
 * changed something, because nothing here can tell those apart until the write
 * happens. A prompt an author dismisses costs a click; the other direction
 * costs the paragraph they were writing.
 */
function hasUnsavedWork(
  editor: { undoDepth: number },
  inline: { editing: unknown; editingRich: unknown }
): boolean {
  return (
    editor.undoDepth > 0 ||
    inline.editing !== null ||
    inline.editingRich !== null
  );
}

/**
 * What to tell the author when an inline edit did not save, or `null` when
 * there is nothing to say.
 *
 * Said at all because nothing else would. An inline edit lives in the element
 * until it ends, so the document never records it, the dirty flag never moves,
 * and an edit that could not be written leaves no trace for the author to
 * notice — they would find the old words back on the page and no reason given.
 *
 * The two refusals are separated because only one of them is theirs to act on:
 * a passage that outgrew the page can be shortened, while one that was edited
 * elsewhere cannot be reconciled from here, and the useful thing to say is that
 * their version is still on screen for as long as they leave it there.
 */
function inlineEditProblem(outcome: InlineEditOutcome): string | null {
  if (outcome.status === "unavailable")
    return "Another block is still holding text that has not been saved. Finish that one first.";
  if (outcome.status === "discarded")
    return "That block changed while you were editing it, so your text was not saved.";
  if (outcome.status !== "refused") return null;
  return outcome.reason === "moved-on"
    ? "That block was edited somewhere else while you were typing. Your text is still in it \u2014 copy what you need before you leave."
    : "Your text could not be saved into this page. Shortening it may help.";
}

/**
 * Finish whatever inline edit was open, and say what the host may now do.
 *
 * An inline edit lives in the element until it ends — that is what keeps the
 * caret still while an author types — so the document a caller is holding is
 * the one from before it, and committing that would save a page missing the
 * words they were in the middle of writing.
 *
 * Says nothing to the author: the surface reports every finished edit through
 * one callback, including the ones started here, so reporting again from this
 * return value would announce the same edit twice.
 *
 * `mayClose` is separate from the document because the two answers differ: a
 * refused passage changed nothing, so there is a perfectly good document to
 * save, and the only thing that must not happen is unmounting the editor still
 * holding the words.
 */
function finishInlineEdit(
  inline: { commit: () => InlineEditOutcome },
  held: BlockDocument
): { document: BlockDocument; mayClose: boolean } {
  const outcome = inline.commit();
  return {
    document: documentAfter(outcome, held),
    mayClose: outcome.status !== "refused",
  };
}

/**
 * The form's save shortcut, parsed from the SAME spec the form registers.
 *
 * Asked of the shortcut library rather than written out here. A hand-rolled
 * `key === "s" && (metaKey || ctrlKey)` treats modifiers as a minimum, so it
 * also fires on Ctrl+Shift+S and Ctrl+Alt+S — which the manager rejects,
 * meaning the form does NOT save. Ctrl+Shift+S is the browser's Save As on
 * several platforms, so the author would have got a dialog, an inline edit
 * closed underneath it, and a field changed by a keystroke that saved nothing.
 */
const SAVE_CHORD = parseKeys("mod+s")[0];

/** Whether a key event is the form's save shortcut on this platform. */
function isSaveChord(event: KeyboardEvent): boolean {
  return (
    SAVE_CHORD !== undefined &&
    chordMatches(SAVE_CHORD, event.key, event, detectApplePlatform())
  );
}

/**
 * The interaction state to SHOW, given the state being edited and how many
 * blocks are selected.
 *
 * Suppressed rather than reset whenever the switcher is not on screen. The
 * inspector replaces its whole tab strip — for a multi-selection, and for a
 * selection it cannot inspect at all — so the state control goes with it, and
 * the panel's own tab handler cannot catch either case because the stored tab
 * value is still `style` and no tab change happens. A forced state outliving
 * its control is a canvas drawn mid-hover with nothing on screen explaining
 * why.
 *
 * Decides WHETHER THE CONTROL IS THERE rather than taking a selection count,
 * because a count cannot see the second case: an unregistered block type reads
 * as one ordinary selection while the panel shows no tabs for it. The
 * inspectability half is asked of the same predicate the panel's own early
 * return uses, so the two cannot disagree about what is inspectable.
 *
 * Derived rather than written back, so the author's choice SURVIVES: they
 * shift-click a second block, the canvas returns to the normal appearance, and
 * clicking back to one block restores the state they were editing. Writing
 * `base` into the state instead would silently discard it.
 */
function shownStyleStateFor(
  editing: StyleState,
  document: BlockDocument,
  selectedIds: readonly string[],
  selectedId: string | null
): StyleState {
  const switcherIsOnScreen =
    selectedIds.length <= 1 && selectionIsInspectable(document, selectedId);
  return switcherIsOnScreen ? editing : "base";
}

/**
 * Whether this document holds unsaved work, from EITHER surface that writes it.
 *
 * The status pill otherwise reads the editor's `undoDepth` alone, which is its
 * own history and says nothing about the form — so an author who renamed the
 * page and touched no block was told the document was saved. Two surfaces now
 * write to one document, and the pill has to answer for both.
 *
 * `dirtyFields` rather than `isDirty`, with this field excluded. The blocks
 * field belongs to the editor and is committed on the way out, so while the
 * editor is open it is either clean or dirty from a previous visit; counting it
 * here would double the undo history or report work that is already saved.
 *
 * The editor's own history is taken as an argument rather than combined at the
 * call site, so "is this document dirty" is answered in one place. It is also
 * one fewer branch inside the largest component in this package, which the
 * complexity gate refuses to let grow.
 */
function useDocumentDirty<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>,
  ownField: string,
  editorDirty: boolean
): boolean {
  const { dirtyFields } = useFormState({ control });
  return editorDirty || Object.keys(dirtyFields).some(f => f !== ownField);
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
  // The canvas root, published by `Canvas` below and read by the drag when a
  // gesture begins somewhere that is not the canvas — a palette row, whose
  // pointerdown has no `currentTarget` the drag could measure against.
  const canvasRoot = useRef<HTMLDivElement | null>(null);
  /*
   * The same element as STATE, beside the ref rather than instead of it.
   *
   * The drag reads "where is the canvas now" during a gesture, which is what a
   * ref is for. The inspector has to REACT to the canvas appearing: it stays
   * mounted while the canvas mounts only once styles have loaded, and a ref is
   * not reactive — assigning `.current` changes no dependency, so a reader
   * listing the ref would see `null` once and never look again.
   */
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(
    null
  );
  /*
   * The interaction state being edited, owned HERE so the panel and the canvas
   * cannot disagree about it.
   *
   * One value handed to both surfaces rather than two defaults that happen to
   * match: the panel states no `liveStates`, so provenance falls back to the
   * edited state plus base — correct exactly while the canvas is simulating
   * that state. Wired from one value that precondition holds by construction.
   *
   * ONE value reaching both surfaces, which is the property that matters: the
   * panel states no `liveStates`, so its provenance falls back to the edited
   * state plus base — correct exactly while the canvas is simulating the state
   * being edited, and wrong the moment it is not. Held here rather than in
   * either consumer so that precondition holds by construction; held in both,
   * a control would report a value the canvas is not showing and nothing would
   * say so.
   *
   * Editor state, not document state. Which state an author is LOOKING at is
   * not a property of the page, so it is neither stored nor undoable, and two
   * people editing one page can be looking at different states.
   */
  const [styleState, setStyleState] = useState<StyleState>("base");
  /*
   * Memoised because it is a PROP OBJECT: rebuilt on every render it would be a new
   * identity every time, and the panel it feeds is the one surface here that
   * holds a draft. `setStyleState` is stable, so this changes exactly when the
   * state does.
   */
  // ONE derivation feeding BOTH consumers, which is what keeps the panel and the
  // canvas showing the same thing. See `shownStyleStateFor`.
  const shownStyleState = shownStyleStateFor(
    styleState,
    editor.document,
    editor.selection.ids,
    editor.selectedId
  );
  const styleStateBinding = useMemo(
    () => ({ state: shownStyleState, onChange: setStyleState }),
    [shownStyleState]
  );
  const drag = useCanvasDrag({ editor, slots, nesting, canvasRoot });
  /*
   * Is a drag happening — of EITHER kind.
   *
   * Not `draggingId`, which is the moving node's id and is null for the whole
   * of a drag from the palette: the block has no node until the release makes
   * one. Chrome gated on the id stays up while an author drags a new block in,
   * and the toolbar sits above the drop indicator, covering the position being
   * aimed at.
   *
   * Derived once and shared by the three surfaces below, so they cannot come to
   * disagree about what counts as a drag.
   */
  const dragging = drag.draggingBlockName !== null;

  /*
   * The empty-container appender's only read of a block's definition: its
   * accessible label. `{ get: getBlock }` satisfies its `BlockLookup` with no
   * adapter, because `getBlock` already returns `AnyBlockDefinition | undefined`
   * and that type carries the one field the appender reads.
   */
  const blocks = useMemo(() => ({ get: getBlock }), []);

  /*
   * Typing a block's text on the canvas. The hook owns the caret; which values
   * may be typed into is the block's own declaration, read by the builder, and
   * WHICH editor a value gets is that declaration too.
   *
   * The rich-text loader is passed rather than imported by the builder, because
   * it reaches Lexical and the builder must not: one copy of Lexical is what
   * keeps its node classes recognisable, and this package is already on the
   * admin side of that line.
   */
  /*
   * ONE place the author is told about an inline edit that did not save.
   *
   * Passed to the hook rather than read from what `commit` returns here,
   * because most edits do not end by this component calling `commit`. Leaving
   * the passage ends one; so does opening another, and so does this canvas
   * unmounting. The outcome that most needs saying — a passage whose block was
   * deleted or locked while the author typed into it — is reached almost
   * entirely by the first of those, so reporting from the return value alone
   * said nothing on the common path.
   */
  const announce = useCallback((outcome: InlineEditOutcome) => {
    const problem = inlineEditProblem(outcome);
    if (problem !== null) toast.error(problem);
  }, []);
  const inline = useInlineEditing(editor, loadInlineRichTextEditor, announce);

  /*
   * The entry's other fields, ALREADY DRAWN, or null when there are none.
   *
   * One value feeds both the rail's availability and the panel's body below,
   * so the two cannot disagree about whether there is anything to show. Asking
   * separately is what put an empty Settings panel on the rail: every entry
   * form has a renderer, so a gate on the renderer's existence is true even for
   * a collection whose only fields are its title, its slug and this one.
   */
  const entryFields = useEntryFieldsPanel(name);

  const documentDirty = useDocumentDirty(control, name, editor.undoDepth > 0);

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

  // The site-style half of the class surface. The node half stays with the
  // inspector, which already writes nodes — see `useClassSurface`.
  const classes = useClassSurface(
    canvasSiteStyle,
    siteStylePending,
    siteStyleError,
    configSiteStyle
  );

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
  /*
   * Writing the site's breakpoints, for the manager in the top bar.
   *
   * Section-scoped, so this sends the breakpoints and nothing else — the other
   * three fields of the record are owned by other studios and are not read here
   * in order to write this one.
   *
   * The result is narrowed to the shape the dialog understands: `undefined` for
   * a save that landed, and the reason otherwise. The reasons are joined rather
   * than picked from, because `issues` is keyed by path and taking the first
   * would silently drop the others — an author told about one refused field
   * while a second is also refused fixes one and is refused again.
   */
  const saveBreakpoints = useBreakpointWriter(configSiteStyle);

  /*
   * The canvas's own render inputs, and the ONE place this surface derives a
   * breakpoint set.
   *
   * `styleContext.breakpoints` is read three times over — by the canvas, by the
   * cascade compiled below, and by the inspector — and all three must be the
   * same set or the panel judges which declarations are LIVE against
   * breakpoints the cascade was not compiled with. A second call to
   * `siteBreakpoints` beside this one returns an equal set today and offers no
   * error on the day the render context grows a tier this does not have.
   *
   * Memoised, and that also settles a churn problem: `siteBreakpoints` builds a
   * fresh `{ viewport: [], container: [] }` when no site style is stored, so an
   * inline call handed the inspector a new object every render and the panel
   * re-subscribed a media query per breakpoint on every keystroke.
   */
  /*
   * The name the canvas box establishes as a query container.
   *
   * The editor canvas is not an iframe — the renderer emits its sheet into the
   * admin document — so `@media` asks the browser WINDOW and resizing the box
   * cannot change which tier applies. Compiled against a container name, the
   * viewport tiers become `@container` rules about THIS box, and the box's own
   * width decides them.
   *
   * Minted from `useId` rather than spelled here, because the name identifies
   * one mounted surface: two editors on a page sharing a literal would each
   * answer the other's queries. `previewContainerFor` is what turns the seed
   * into a name the compiler will accept, and it is the only supported way to
   * make one.
   */
  const canvasBoxId = useId();
  /*
   * The name this canvas would establish, and whether it establishes one AT
   * ALL.
   *
   * Previewing is not free: a preview compile rewrites every CONTAINER-axis
   * rule to `@container nx-not-previewable (width < 0px)`, which matches
   * nothing. That is the engine refusing to answer a question it cannot — a
   * container query resolves against an element's own query container, which a
   * preview box is not — and it is the right refusal when there are viewport
   * tiers to gain in exchange.
   *
   * With NO emitted viewport tier there is nothing to gain and the same price
   * is paid: a site whose only breakpoints are container ones would have every
   * one of them silently stop matching on the canvas while they keep working on
   * the published page. So a canvas with nothing to simulate stays published,
   * which is also what it looked like before any of this existed.
   *
   * `offeredTiers` rather than a second reading of the set, because it is
   * already the answer to "which tiers can this canvas be sized to" — and if
   * none can, there is no width to simulate.
   */
  const previewContainer = useMemo(
    () => previewContainerFor(canvasBoxId),
    [canvasBoxId]
  );

  /*
   * The two widths, which are two facts and not one.
   *
   * `requestedWidth` is what the author asked the switcher for — a ceiling, and
   * `undefined` for the full region. `measuredWidth` is what the box actually
   * got, reported by the canvas: the editor region may be narrower than the
   * tier requested, and what the container queries resolve against is the width
   * the box has, not the width it was offered.
   *
   * Only the MEASURED one decides which tier is edited. Deriving that from the
   * request would tell an author they are editing the tier they picked while
   * the box is in a narrower one, which is the disagreement between what you
   * see and what you edit that this control exists to remove.
   */
  const [requestedTier, setRequestedTier] = useState<BreakpointId | undefined>(
    undefined
  );
  /*
   * The zoom, and the scale it produces, held apart.
   *
   * The first is what the author ASKED for and the shell persists it. The
   * second is what the canvas is painting at, which while fitting is derived
   * from a region only the canvas measures — so it is reported back rather
   * than computed here, where a second derivation would disagree with the
   * screen for exactly the frame after a panel opens.
   */
  /*
   * The zoom the SHELL owns, mirrored here only to draw the canvas with it.
   *
   * Nothing writes it from this side. The shell persists the choice and reports
   * it, including the value restored on load; this holds the last report so the
   * canvas can be scaled by it. Holding it as a second source of truth and
   * syncing BACK is what produced an oscillating write of `fit, 2, fit, 2` on
   * every open — two owners, each correcting the other.
   *
   * Seeded with the same default the shell starts from, so there is no absent
   * state for the canvas to interpret. That is safe only because this direction
   * is one-way: with nothing sending a zoom back, a default held here can never
   * reach the store to overwrite what the author chose.
   */
  const [zoom, setZoom] = useState<CanvasZoom>(DEFAULT_PREFERENCES.zoom);
  const [appliedScale, setAppliedScale] = useState(1);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(
    undefined
  );

  const canvasRender = useMemo(() => {
    /*
     * ONE read of the site's breakpoints, feeding both the context and the
     * decision about whether to preview at all.
     *
     * Two calls returned equal sets today and would stop the day `siteBreakpoints`
     * normalises or defaults anything — and then preview eligibility would be
     * answering from a different set than the canvas renders, which is the
     * box/compile mismatch this whole seam exists to make unrepresentable. The
     * docblock above already says this about the context's THREE readers; the
     * eligibility question is a fourth.
     */
    const breakpoints = siteBreakpoints(canvasSiteStyle);
    return {
      styleContext: {
        breakpoints,
        /*
         * Carried on the SAME context the cascade and the inspector read, so
         * all three describe one compile. Supplied unconditionally rather than
         * only while a tier is selected: at the full width the box is still a
         * box, and a region narrower than the widest tier is already showing a
         * narrower tier's rules. Compiling `@media` there would answer for the
         * admin WINDOW instead — a wide window around a narrow canvas reports
         * the desktop tier live while the box paints the tablet one.
         */
        ...(offeredTiers(breakpoints).length === 0 ? {} : { previewContainer }),
        /*
         * Unconditional, unlike the container above. A page cannot force a
         * pseudo-class on itself, so the sheet has to carry a class alternative
         * beside each one before the canvas can show an author the hover
         * appearance they are editing — and whether they are editing one is not
         * known when the sheet is compiled.
         *
         * It costs a few bytes per state rule in a sheet only the editor sees,
         * and nothing at all in weight: the marker sits inside the `:where()`
         * that already wrapped the pseudo-class, which contributes nothing. The
         * published sheet is compiled elsewhere and never asks for this.
         */
        previewStates: true,
      },
      ...(remotePatterns === undefined
        ? {}
        : { hostPolicy: { remotePatterns } }),
    };
  }, [canvasSiteStyle, remotePatterns, previewContainer]);

  /*
   * What the canvas is previewing under, read back from the ONE context that
   * decided it rather than recomputed. The box and the inspector must be told
   * the same thing the sheet was compiled with, and a second derivation here
   * would be a second chance to answer differently.
   */
  const canvasPreviewContainer = canvasRender.styleContext.previewContainer;

  /*
   * Which tier an edit lands in, and which tiers the box is applying.
   *
   * Both derived from the MEASURED width and from the one breakpoint set above,
   * so the inspector cannot disagree with the canvas about either. Memoised
   * because `breakpointsAtWidth` builds a fresh array: passed inline it would be
   * a new identity every render, and the panel re-derives on it.
   */
  const editedBreakpoint = editedBreakpointAtWidth(
    canvasRender.styleContext.breakpoints,
    measuredWidth
  );
  /*
   * Release a requested width the site no longer offers.
   *
   * The switcher renders nothing once a site defines no viewport tiers, and it
   * cannot clear state it does not own — so an author who selects a tier and
   * then deletes it, or deletes the last one, is left with a canvas pinned to a
   * bound the stylesheet no longer has and no control on screen to release it.
   * The only way out would be to close the editor and reopen it.
   *
   * Compared against `selectableTiers`, which is the same list the switcher
   * builds its options from, so "a width this control could have set" has one
   * definition rather than two that can disagree.
   *
   * It has to be that list and not the bounded tiers alone. The unconditional
   * tier is offered at the width it applies FROM, which is not any tier's
   * bound — checked against the bounds this cleared it on the render after it
   * was chosen, so the canvas returned to filling the region and the one option
   * that reaches the base tier silently did nothing.
   */
  const requestedWidth =
    requestedTier === undefined
      ? undefined
      : widthForBreakpoint(
          canvasRender.styleContext.breakpoints,
          requestedTier
        );

  /*
   * The box's own inputs, as one object.
   *
   * Memoised because the canvas takes them as a group: rebuilt inline it would
   * be a fresh object every render, and the measurement effect behind it
   * re-subscribes on the reporter's identity.
   */
  const canvasPreview = useMemo(
    () =>
      canvasPreviewContainer === undefined
        ? undefined
        : {
            container: canvasPreviewContainer,
            ...(requestedWidth === undefined ? {} : { width: requestedWidth }),
            onMeasured: setMeasuredWidth,
          },
    [canvasPreviewContainer, requestedWidth]
  );

  const liveBreakpoints = useMemo(
    () =>
      breakpointsAtWidth(canvasRender.styleContext.breakpoints, measuredWidth),
    [canvasRender, measuredWidth]
  );

  /*
   * The cascade behind the canvas, compiled ONCE per document.
   *
   * The inspector's Style tab uses it to say whether a control's value was set
   * on this block or arrived from a class, the block's defaults or the page.
   * Only this surface can compile it: the panel sits several layers down and
   * holds neither the site's breakpoints nor the document, and compiling nearer
   * the controls would walk the cascade once per control.
   *
   * It is handed the SAME inputs the canvas is: `canvasRender.styleContext`, the
   * site sheet, and the host's remote patterns. Not a narrower context assembled
   * beside them — named classes, block bases, the token prefix and the fetch
   * predicate are each reconciled from two tiers, and a second assembly compiles
   * a cascade the page never had. The shortfall would be silent: no class
   * declaration in the trace, so every value from a named class reads as set by
   * nobody, and a `url(...)` this host refuses reads as active.
   */
  const styleCascade = useMemo(
    () =>
      /*
       * Withheld on exactly the states the CANVAS is withheld on, and for the
       * same reason one level over. While the stored tier is unread
       * `useSiteStyle` answers with the host's config defaults, so a trace
       * compiled from it describes a cascade that is not the page's: a class the
       * site adds is missing, one it overrides is wrong, and the dots say so
       * confidently.
       *
       * A FAILED read is the worse half and is not a passing state. `pending`
       * goes false while the value falls back to defaults, so gating on pending
       * alone would leave the inspector permanently certain about a tier nobody
       * has read. No dots is the honest answer; a fabricated origin is not.
       */
      /*
       * `!== null`, NOT `!== undefined`. `useSiteStyle` types `error` as
       * `Error | null` and normalises a successful read to `null`, so the
       * `undefined` comparison is true on success as well as on failure — and
       * withheld the trace unconditionally, which meant no provenance dot ever
       * appeared. The same test the canvas below uses.
       */
      siteStylePending || siteStyleError !== null
        ? undefined
        : pageStyleTrace(
            editor.document,
            canvasRender.styleContext,
            siteSheet(canvasSiteStyle),
            remotePatterns === undefined ? {} : { remotePatterns }
          ),
    [
      editor.document,
      canvasRender,
      canvasSiteStyle,
      remotePatterns,
      siteStylePending,
      siteStyleError,
    ]
  );

  useCheckpoints({ name, control, document: editor.document });

  /*
   * Which classes the OPEN document renders, for the manager's on-this-page
   * filter.
   *
   * `classUsageOf` rather than a walk written here: it is the same traversal
   * the style compiler and the usage index already share, and two walks with
   * equal limits reached by different routes select different nodes — a class
   * on a node one walk reaches and the other does not would be reported as
   * absent from a page that renders it.
   *
   * `complete` is deliberately unread. It says whether the walk hit the
   * document's node ceiling, which bounds what this could CLAIM about usage —
   * and this claims nothing about usage. It answers one question, "does the
   * open page apply this class", and a truncated walk answers that for fewer
   * nodes rather than answering it wrongly.
   */
  const documentClasses = useMemo(
    // The HOST's limits, not the engine's defaults. A site that raised or
    // lowered them renders under those, and a walk here under different bounds
    // selects different nodes — which would report a class as absent from a
    // page that renders it, or present on one that does not.
    () => classUsageOf(editor.document, readDocumentLimits(clientConfig)),
    [editor.document, clientConfig]
  );

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
  useReportUnsavedWork(`blocks:${name}`, hasUnsavedWork(editor, inline));

  /*
   * Finish an open passage before the form is asked to save it.
   *
   * An inline edit lives in the element until it ends, so the field still holds
   * the value from before it. Reporting the edit as unsaved work is what lets
   * the form submit — and reporting cannot write to the form, by that context's
   * own contract — so a save taken while a passage is open would send the
   * previous value and report success.
   *
   * Capture phase, so this runs before the form's own handler sees the chord.
   *
   * This closes the SHORTCUT. A save started any other way — a button, a
   * command palette — still leaves an open passage behind, because nothing lets
   * a surface holding uncommitted work be asked to flush before submission.
   * That is a contract the form does not have, not something this can reach.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveChord(event)) return;
      /*
       * Saved even when the passage was refused, and NOT closed either way.
       * The document is right and complete for everything except the passage
       * still open, so withholding the save would lose the rest of their work
       * to protect a paragraph that is not going anywhere: it stays in the
       * editor, on screen, and the message is what tells them it is still
       * there.
       */
      onCommit(finishInlineEdit(inline, editor.document).document);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor.document, inline, onCommit]);

  /*
   * Writing back on the way out rather than on every keystroke.
   *
   * The form owns the value and its dirty flag; the editor owns the document
   * and its history. Committing on each change would mark the entry dirty for
   * an edit the author then undoes, and would make the form's undo and the
   * editor's undo two answers to one question.
   */
  const done = useCallback(() => {
    /*
     * The open inline edit is finished FIRST, and the document it produced is
     * the one handed over.
     *
     * An inline edit lives in the element until it ends — that is what keeps
     * the caret still while an author types — so `editor.document` here is the
     * one from before it. Committing that would hand the form a document
     * missing the words the author was in the middle of writing, and the exit
     * gesture is the most common way to leave a passage open.
     */
    const finished = finishInlineEdit(inline, editor.document);
    /*
     * A REFUSED commit kept the passage open because the author's words are in
     * it and nowhere else. Closing unmounts the canvas and takes the editor
     * with it, so leaving is declined until they deal with it — they have been
     * told what happened, and their text is still where they left it.
     */
    if (!finished.mayClose) return;
    onCommit(finished.document);
    onClose();
  }, [editor.document, inline, onCommit, onClose]);

  /*
   * Opens the insert panel from the canvas itself, for the empty-container
   * appender: pressing its "+" must select the container AND show the panel
   * that fills it as one gesture, never two.
   *
   * A counter bumped on every press, not a boolean: `BuilderShell` reads this
   * as "open it AGAIN", including when the author has since closed the panel
   * by hand, and a value that repeated itself would look unchanged and do
   * nothing the second time. Starts `undefined` rather than `0` so mounting
   * the editor is not itself a press.
   */
  /*
   * A request to open one panel, carrying its own count so the shell can tell a
   * second press from the first. One piece of state for every panel that asks:
   * the appender opens `insert`, and the fonts panel sends an author to
   * `tokens` to fix a typeface the site does not provide.
   */
  const [openPanelRequest, setOpenPanelRequest] = useState<
    { panel: LeftPanel; count: number } | undefined
  >(undefined);
  const requestPanel = useCallback((panel: LeftPanel) => {
    setOpenPanelRequest(current => ({
      panel,
      count: (current?.count ?? 0) + 1,
    }));
  }, []);
  const openInsertPanel = useCallback(() => {
    requestPanel("insert");
  }, [requestPanel]);

  /*
   * Whether the author wants empty-container chrome showing at all, mirrored
   * from the shell so the appender mounted below can answer the same question
   * the dashed placeholder box's own CSS rule already answers.
   *
   * Starts at the preference's own default rather than an assumed `true`: the
   * shell reports the real value once it has read it, but that report lands
   * one render after this component's first — an assumed value would be a
   * SECOND declaration of the default that goes stale the day the shell's own
   * changes and this one does not.
   */
  const [showEmptyElements, setShowEmptyElements] = useState(
    DEFAULT_PREFERENCES.showEmptyElements
  );

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
          entryFields === null
            ? AVAILABLE_PANELS
            : AVAILABLE_PANELS_WITH_SETTINGS
        }
        // Forces the insert panel open from the empty-container appender,
        // which lives on the canvas below rather than beside the rail that
        // normally opens a panel.
        openPanelRequest={openPanelRequest}
        // The read half of the same gap: mirrors the shell's own preference
        // so the appender below can be suppressed by the SAME switch that
        // already suppresses the placeholder box it sits over.
        onShowEmptyElementsChange={setShowEmptyElements}
        onZoomChange={setZoom}
        appliedScale={appliedScale}
        // Whether the page is live, which the admin's own chrome would have
        // shown had this editor not asked for it to be hidden. `undoDepth` is
        // the editor's OWN dirty signal: the form's is false for as long as the
        // editor is open, because the document is committed on the way out.
        topBar={
          <>
            <DocumentStatusPill isDirty={documentDirty} />
            {/*
             * Gated on the SAME read the canvas and the cascade are gated on.
             * Until the stored style has answered, `canvasSiteStyle` is the
             * host's config defaults — so the dialog would open on a set the
             * site never chose, and saving from that draft would overwrite the
             * site's real breakpoints with defaults the author never saw.
             *
             * `!== null`, not `!== undefined`: `useSiteStyle` types `error` as
             * `Error | null` and normalises success to `null`, so the
             * `undefined` comparison is true on success too — the same mistake
             * that once withheld the provenance trace unconditionally.
             */}
            <BreakpointManager
              value={canvasRender.styleContext.breakpoints}
              onSave={saveBreakpoints}
              status={siteStyleStatus(siteStylePending, siteStyleError)}
            />
            {/*
             * Beside the manager, and gated on the same read for the same
             * reason it is: until the stored style has answered, the set in
             * hand is the host's config defaults, so this would size the canvas
             * to a bound the site never chose and every edit made there would
             * land in whichever tier that bound implies.
             *
             * It is handed BOTH widths. The requested one is what the author
             * chose and is what the control reports as selected; the measured
             * one is what the box got and is what it names a tier from. Fed
             * only the measured width it would unselect the option just
             * clicked whenever the region could not honour it.
             */}
            <BreakpointSwitcher
              breakpoints={canvasRender.styleContext.breakpoints}
              width={requestedWidth}
              appliedWidth={measuredWidth}
              /*
               * Stored as the TIER, not as the width it emitted.
               *
               * A width identifies an option only until the site's bounds move.
               * Editing the widest breakpoint changes the width the
               * unconditional tier applies from, and the number the author's
               * choice produced is then nobody's — so the canvas was released
               * and the editor returned to the bounded tier while the option
               * they had chosen still existed.
               *
               * The lookup is unambiguous because `selectableTiers` collapses
               * tiers sharing a bound to the one the browser paints, which is
               * the same reason the switcher offers one radio for them.
               */
              onSelect={width => {
                setRequestedTier(
                  width === undefined
                    ? undefined
                    : selectableTiers(
                        canvasRender.styleContext.breakpoints
                      ).find(tier => tier.maxWidth === width)?.id
                );
              }}
              status={siteStyleStatus(siteStylePending, siteStyleError)}
            />
          </>
        }
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
            // The SAME ref the canvas publishes its root through, so the style
            // tab reads the element a node is actually drawn as rather than
            // inferring one from the document. Two refs would let the panel
            // read a canvas that is not the one on screen.
            canvasRoot={canvasElement}
            styleState={styleStateBinding}
            classLibrary={classes.library}
            classLibraryAbsence={classes.absence}
            onCreateClass={classes.create}
            policy={stylePolicy}
            cascade={styleCascade}
            breakpoints={canvasRender.styleContext.breakpoints}
            // Which tier the Style tab writes to, and which tiers it may call
            // live. Both are the canvas's answer rather than the panel's: the
            // queries are about the preview box, and `matchMedia` cannot
            // evaluate a container query, so only the surface that owns the box
            // can observe them. The container name travels with them because
            // that is what tells the panel the window is not the authority.
            /*
             * Going to a tier is SIZING THE CANVAS to it, never setting a
             * second piece of state saying which tier is being edited. The
             * edited tier is derived from the width the box gets, so a jump
             * that wrote its own answer would put the two back in the
             * disagreement deriving them from one width exists to remove.
             *
             * A tier the compiler emits no bound for resolves to `undefined`
             * and releases the canvas to the region rather than pinning it to a
             * number nothing responds to — which is also what the unconditional
             * tier means.
             */
            // Already a TIER, so it is stored directly rather than converted
            // to a width and back.
            onJumpToBreakpoint={setRequestedTier}
            breakpoint={editedBreakpoint}
            previewContainer={canvasPreviewContainer}
            liveBreakpoints={liveBreakpoints}
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
          /*
            A lookup rather than a chain of comparisons, so the arrow answers
            in one step and adding a panel is one entry rather than one more
            branch. It also states the pairing the shell needs: every key here
            is a panel this file can fill, and `AVAILABLE_PANELS` is what the
            rail offers — reading them side by side is how a panel that is
            offered and renders nothing gets noticed.
          */
          const panels: Partial<Record<string, () => React.ReactNode>> = {
            insert: () => (
              <InsertPanel
                editor={editor}
                categoryOrder={CORE_CATEGORIES}
                beginInsertDrag={drag.beginInsertDrag}
              />
            ),
            /*
              The panel cannot work this out for itself. It is drawn here, in
              the shell's panel region, while `BlockKeyboardActions` below wraps
              the shell's CHILDREN — sibling subtrees, so nothing the panel can
              read from where it sits reports what this file knows by writing
              both. Passed as a fact rather than inferred.
            */
            layers: () => <LayersPanel editor={editor} moveHints />,
            tokens: () => (
              <TokensStudio
                merged={offerableTokens(
                  canvasSiteStyle,
                  siteStylePending,
                  siteStyleError
                )}
                supplied={configSiteStyle?.tokens}
                pending={siteStylePending}
              />
            ),
            classes: () => (
              <ClassManagerPanel
                absence={classes.absence}
                pendingSlugs={classes.pendingSlugs}
                documentClassIds={documentClasses.ids}
                /*
                  Whether that walk reached the whole document. It stops at the
                  node ceiling, and a class applied past it is missing from the
                  list — which the panel must not read as "not on this page".
                */
                documentScan={documentClasses.complete ? "complete" : "partial"}
                library={classes.library}
                onRename={classes.rename}
                /*
                  No `usage`, and no `onDelete`. The usage index is a
                  collection and this surface has no read for one, so the panel
                  reports that nothing was read rather than reporting an empty
                  index — which would say every class is unused. Deleting needs
                  that same reach plus a write stripping the class from every
                  document holding it, so it is withheld entirely rather than
                  offered as a control that cannot keep its promise.
                */
                suppliedClassIds={configSiteStyle?.classes?.map(
                  entry => entry.id
                )}
              />
            ),
            fonts: () => (
              <FontsPanel
                faces={offerableFaces(
                  canvasSiteStyle,
                  siteStylePending,
                  siteStyleError
                )}
                tokens={renderedTokens(
                  canvasSiteStyle,
                  siteStylePending,
                  siteStyleError
                )}
                absence={siteStyleError !== null ? "failed" : "pending"}
                /*
                  The fix for a token naming a family this site does not provide
                  is to edit that token, and editing belongs to the studio. This
                  shell offers one, so the jump is wired: without the callback
                  the panel suppresses the action and an author is left to find
                  the right panel and the right row themselves.
                */
                onOpenTokens={() => requestPanel("tokens")}
              />
            ),
            /*
              The document's title and slug, and the entry's own fields — SEO,
              relations, whatever this collection declares — which this editor
              covered when it took the window. Drawn by the ADMIN, not
              reconstructed here: how a field is drawn is the entry form's
              contract, and a second renderer would drift from it.

              The same value the rail was derived from, so a panel is never
              offered that this returns nothing for.
            */
            settings: () => entryFields,
          };
          return panels[panel]?.() ?? null;
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
            /*
              Wrapped rather than passed in, because the menu opens over the
              WHOLE canvas and reads which block from the selection the canvas
              has already moved. The wrapper generates no box, so the canvas
              lays out exactly as it did.
            */
            <BlockContextMenu editor={editor}>
              <Canvas
                zoom={zoom}
                /*
                  On the CANVAS, not inside `preview`. The scale is reported
                  whether or not a viewport is being previewed, and an extra key
                  on that inferred object is accepted and ignored rather than
                  refused — so the reporter simply never ran.
                */
                onScale={setAppliedScale}
                document={editor.document}
                rootRef={canvasRoot}
                onRoot={setCanvasElement}
                forcedState={shownStyleState}
                siteStyles={siteSheet(canvasSiteStyle)}
                selectedId={editor.selectedId}
                selectedIds={editor.selection.ids}
                onSelect={editor.select}
                // The style context and the host policy, derived above so both are
                // one object with one identity rather than rebuilt per render.
                render={canvasRender}
                // The box the tiers are compiled against, the width it is asked
                // to take, and the reporter that closes the loop: the request is
                // a ceiling, and everything downstream is derived from what the
                // box actually got rather than from what it was offered.
                preview={canvasPreview}
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
                    <BlockToolbar editor={editor} hidden={dragging} />
                    {/*
                  Suppressed for the same reason and by the same signal. The
                  bands report a layout that is mid-change during a drag, so
                  every value on them is about to be wrong.
                */}
                    <SpacingOverlay editor={editor} hidden={dragging} />
                    {/*
                  Suppressed during a drag for the same reason the toolbar and
                  the bands are: the document is mid-change, so a control
                  offering to fill a container names a shape that is about to
                  be different.
                  ALSO suppressed while the author has turned empty-container
                  chrome off: the dashed placeholder box collapses to zero
                  height under the same preference (`builder-chrome.css`'s
                  `[data-nx-slots]:empty` rule already matches it), and a "+"
                  left floating over nothing after that would make the
                  preference lie about what a visitor sees.
                */}
                    <EmptyContainerAppenders
                      document={editor.document}
                      slots={slots}
                      blocks={blocks}
                      hidden={emptyContainerAppenderHidden(
                        dragging,
                        showEmptyElements
                      )}
                      onAppend={nodeId => {
                        // Select first, then open. The inserter derives its
                        // target from the selection, so selecting the container
                        // is what makes the next insert land inside it — there
                        // is no second targeting path to keep in step.
                        editor.select(nodeId);
                        openInsertPanel();
                      }}
                    />
                  </>
                }
              />
            </BlockContextMenu>
          )}
        </BlockKeyboardActions>
      </BuilderShell>
    </div>
  );
}
