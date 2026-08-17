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

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  BuilderShell,
  Canvas,
  InsertPanel,
  useEditorState,
} from "@nextlyhq/builder/shell";
import { useSuppressAdminChrome } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo, useState } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { emptyBlockDocument } from "../fields/blocks-document";
import { siteSheet } from "../site-style";

import { BlocksSummary } from "./BlocksSummary";

export interface BlocksFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads and writes. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
}

/**
 * Every left panel the editor can fill today.
 *
 * The inserter only; layers and the rest are not built. The shell draws all
 * seven regardless and disables the ones nothing fills, so the rail describes
 * the editor's shape while never opening a region with nothing in it. Listing a
 * panel here that renders nothing would reserve space and shrink the canvas to
 * show it, which is why this grows one entry at a time rather than being
 * declared ahead of the panels.
 */
const AVAILABLE_PANELS = ["insert"] as const;

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

export function BlocksField<TFieldValues extends FieldValues = FieldValues>({
  name,
  control,
}: BlocksFieldProps<TFieldValues>) {
  const [open, setOpen] = useState(false);
  const { field } = useController({ name, control });

  return open ? (
    <BlocksEditor
      // Remounted per opening: the editor seeds its own history from the value
      // it opened with, and a key change is what discards a previous session's
      // undo stack rather than carrying it into a document it cannot describe.
      key={String(field.value === undefined ? "empty" : "seeded")}
      initialValue={field.value}
      onCommit={field.onChange}
      onClose={() => setOpen(false)}
    />
  ) : (
    <div className="flex flex-col gap-3">
      <BlocksSummary name={name} control={control} />
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Edit blocks
        </button>
      </div>
    </div>
  );
}

/**
 * The editor itself, mounted only while open.
 *
 * Separate component so the hooks below — editor state, and the chrome request
 * — run only when there is an editor. Calling them from the control above would
 * ask the admin to hide its navigation for every entry form holding a blocks
 * field, open or not.
 */
function BlocksEditor({
  initialValue,
  onCommit,
  onClose,
}: {
  initialValue: unknown;
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
}) {
  const initialDocument = useMemo(
    () => documentFrom(initialValue),
    [initialValue]
  );
  const editor = useEditorState({ initialDocument });

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
        // Switched on the panel id rather than rendering the inserter for
        // whatever the rail reports open. The shell asks for the panel it
        // opened, and a renderer ignoring that argument would draw the inserter
        // under every heading the moment a second panel is listed above.
        renderPanel={panel =>
          panel === "insert" ? <InsertPanel editor={editor} /> : null
        }
      >
        <Canvas
          document={editor.document}
          siteStyles={siteSheet()}
          selectedId={editor.selectedId}
          onSelect={editor.select}
        />
      </BuilderShell>
    </div>
  );
}
