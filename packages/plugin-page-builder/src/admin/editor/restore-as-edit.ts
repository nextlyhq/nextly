/**
 * A recovery point's document, applied to the editor as one edit, so the
 * author can undo a restore: Undo puts the stored page back, and Redo the
 * recovered one.
 *
 * @module restore-as-edit
 */
import type {
  BlockDocument,
  BuilderOp,
  DocumentKind,
} from "@nextlyhq/blocks-engine";
import {
  useEditorState,
  type EditorState,
  type UseEditorStateArgs,
} from "@nextlyhq/builder/shell";
import { useDocumentRestore } from "@nextlyhq/plugin-sdk/admin";

import { documentFrom } from "./stored-document";

/** A value with a document's list of blocks, before it is read as one. */
function hasNodes(value: unknown): value is { nodes: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

/**
 * Whether two documents carry the same envelope: everything beside their
 * blocks (format version, kind, settings, media index, and anything a later
 * format adds). No edit changes the envelope (the op layer keeps the current
 * document's), so a restore whose envelope differs is declined rather than
 * half applied: recovered blocks saved under the current envelope would, say,
 * leave the media they use unprotected, or be saved as a format they aren't.
 */
function sameEnvelope(a: BlockDocument, b: BlockDocument): boolean {
  const { nodes: _aNodes, ...aEnvelope } = a;
  const { nodes: _bNodes, ...bEnvelope } = b;
  return canonical(aEnvelope) === canonical(bEnvelope);
}

/** A value as JSON with every object's keys in order, so key order can't differ. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        )
      : inner
  );
}

/**
 * Applies `value` as ONE edit: every block on the page removed, then the
 * recovered blocks placed in order. Atomic, so it lands whole or not at all.
 *
 * Declines (false) a value that isn't a document of the field's kinds, one of
 * another kind than the page, one whose envelope differs (format version,
 * settings, media index, …), and one the editor refuses (a lock, say). The
 * admin then restores the old way.
 *
 * @param editor - the editor's state: its document and its batch apply
 * @param value - the field's value in the recovery point, unparsed
 * @param kinds - the document kinds the field accepts
 * @returns whether the restore was applied as an edit
 */
export function restoreAsEdit(
  editor: Pick<EditorState, "document" | "applyAll">,
  value: unknown,
  kinds: readonly DocumentKind[] | undefined
): boolean {
  if (!hasNodes(value)) return false;
  const next = documentFrom(value, kinds);
  const current = editor.document;
  if (next.kind !== current.kind) return false;
  if (!sameEnvelope(next, current)) return false;
  const ops: BuilderOp[] = [
    ...current.nodes.map(node => ({ kind: "remove" as const, id: node.id })),
    ...next.nodes.map((node, index) => ({
      kind: "insert" as const,
      node,
      at: { index },
    })),
  ];
  if (ops.length === 0) return true;
  return editor.applyAll(ops) !== null;
}

/**
 * The editor's state, with a recovery point's restore registered as one edit
 * of it. One hook, so an editor and the restore it answers can't be wired
 * apart.
 *
 * @param args - the editor state's own arguments
 * @param kinds - the document kinds the field accepts
 * @returns the editor's state
 */
export function useRestorableEditorState(
  args: UseEditorStateArgs,
  kinds: readonly DocumentKind[] | undefined
): EditorState {
  const editor = useEditorState(args);
  useDocumentRestore(value => restoreAsEdit(editor, value, kinds));
  return editor;
}
