"use client";

/**
 * The editor's side of shared styles on a block: what the Style tab borrows
 * to edit a shared style as its target, and "Save as shared style…", the
 * block verb every menu runs, with the dialog it raises.
 *
 * Gathered here so the editor component only hands them on: the author's
 * right (`update-site-style`), the class surface's writes, the usage route's
 * reads and the blocks on the open page all meet in one place.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/shared-style-verb
 */
import {
  SaveSharedStyleDialog,
  type EditorState,
  type PageClassBlocks,
  type SharedStyleVerbHost,
  type SharedStylesHost,
} from "@nextlyhq/builder/shell";
import { useCan } from "@nextlyhq/plugin-sdk/client";
import { toast } from "@nextlyhq/ui";
import { useMemo, useState, type JSX } from "react";

import { useSharedStylesClient } from "../shared-styles-client";

import type { ClassSurface } from "./site-style-studios";

/** What {@link useSharedStyleVerb} hands the editor. */
export interface SharedStyleVerb {
  /** For the inspector's Style tab. */
  readonly host: SharedStylesHost;
  /** For the block verbs, which offer "Save as shared style…". */
  readonly verb: SharedStyleVerbHost;
  /** The dialog, while the author is saving a block's look. */
  readonly dialog: JSX.Element | null;
}

export function useSharedStyleVerb({
  editor,
  classes,
  pageClassBlocks,
}: {
  editor: EditorState;
  classes: ClassSurface;
  pageClassBlocks: PageClassBlocks;
}): SharedStyleVerb {
  // Asked of the session's grants, which the server enforces on the write
  // anyway; a role without it sees shared styles read-only.
  const mayChange = useCan("update-site-style");
  const access = useSharedStylesClient();
  // The block being saved, held from the moment the verb ran, so the
  // dialog saves the block it was opened for.
  const [saving, setSaving] = useState<string | null>(null);
  const selectedId = editor.selectedId;
  const { library, add, writeStyles } = classes;

  const host = useMemo<SharedStylesHost>(
    () => ({
      mayChange,
      writeStyles,
      usage: access.usage,
      pageBlocks: pageClassBlocks,
    }),
    [mayChange, writeStyles, access.usage, pageClassBlocks]
  );
  const verb = useMemo<SharedStyleVerbHost>(
    () => ({
      library,
      mayChange,
      onSaveAsSharedStyle: () => setSaving(selectedId),
    }),
    [library, mayChange, selectedId]
  );
  const dialog =
    saving === null ? null : (
      <SaveSharedStyleDialog
        editor={editor}
        nodeId={saving}
        offer={{ library, mayChange }}
        onAdd={add}
        onSaved={name => toast.success(`Saved as shared style ${name}`)}
        onClose={() => setSaving(null)}
      />
    );
  return { host, verb, dialog };
}
