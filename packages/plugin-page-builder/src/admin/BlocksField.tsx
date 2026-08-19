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
  OnboardingChecklist,
  SelectionBreadcrumb,
  useBuilderChecklist,
  useCanvasDrag,
  useEditorState,
  useInlineText,
} from "@nextlyhq/builder/shell";
import {
  useDocumentCheckpoint,
  usePluginClientConfig,
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
import { siteSheet } from "../site-style";

import { BlocksSummary } from "./BlocksSummary";
import { DocumentStatusPill } from "./DocumentStatusPill";
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
 * The inserter and the layers tree; the rest are not built. The shell draws all
 * seven regardless and disables the ones nothing fills, so the rail describes
 * the editor's shape while never opening a region with nothing in it. Listing a
 * panel here that renders nothing would reserve space and shrink the canvas to
 * show it, which is why this grows one entry at a time rather than being
 * declared ahead of the panels.
 */
const AVAILABLE_PANELS = ["insert", "layers"] as const;

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
        availablePanels={AVAILABLE_PANELS}
        // Whether the page is live, which the admin's own chrome would have
        // shown had this editor not asked for it to be hidden. `undoDepth` is
        // the editor's OWN dirty signal: the form's is false for as long as the
        // editor is open, because the document is committed on the way out.
        topBar={<DocumentStatusPill isDirty={editor.undoDepth > 0} />}
        // The shell owns the region; this fills it. Rendered unconditionally
        // rather than only when something is selected, because the panel states
        // "select a block to edit it" — a region that appears and disappears
        // with the selection makes the canvas resize on every click.
        inspector={<InspectorPanel editor={editor} />}
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
          <Canvas
            document={editor.document}
            siteStyles={siteSheet()}
            selectedId={editor.selectedId}
            selectedIds={editor.selection.ids}
            onSelect={editor.select}
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
              </>
            }
          />
        </BlockKeyboardActions>
      </BuilderShell>
    </div>
  );
}
