/**
 * The Settings dialog's place, as the editor offers it: what is being edited
 * (a page, or a design drawing a collection's entries) and what a tab there
 * may change, the document's own metadata, through one undoable edit.
 *
 * @module admin/editor/settings-place
 */
import type {
  BlockDocument,
  BuilderOp,
  DocumentCode,
  DocumentKind,
  DocumentSeo,
} from "@nextlyhq/blocks-engine";
import {
  useCurrentUserId,
  useDocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useRef } from "react";
import type { Control, FieldValues } from "react-hook-form";

import type {
  PageBuilderSettingsContext,
  PageBuilderSettingsTabProps,
} from "../../settings-place-contract";

import {
  useOwnDesignEntry,
  useTemplateCollection,
} from "./template-preview-strip";

/** What the dialog draws the place with. */
export interface SettingsPlace {
  /** Null while who is looking, or which document, is not known yet. */
  context: PageBuilderSettingsContext | null;
  tabProps: PageBuilderSettingsTabProps;
  /**
   * Make the edits tabs hold (`holdEdit`), and answer the document the last
   * one made; null where none was made.
   */
  flushHeld: () => BlockDocument | null;
  /**
   * The code the document adds to its own page (`settings.code`), and how
   * to change it: one edit of the document, undone with the editor's Undo
   * and saved with the page, as `seo` is. The editor's own, never handed to
   * another plugin's tab.
   */
  pageCode: {
    value: DocumentCode | undefined;
    /** Answers whether the edit was made. */
    set: (next: DocumentCode | null) => boolean;
  };
  /**
   * The document's own CSS (`settings.customCss`), and how to change it:
   * one edit of the document, as `pageCode` is. The editor's own, never
   * handed to another plugin's tab.
   */
  pageCss: {
    value: string | undefined;
    /** Answers whether the edit was made; `null` removes the CSS. */
    set: (next: string | null) => boolean;
  };
}

/** The editor, as far as the place reads and edits it. */
interface PlaceEditor {
  document: BlockDocument;
  apply: (op: BuilderOp) => BlockDocument | null;
}

/** The document's own metadata, where it states any. */
function seoOf(document: BlockDocument): DocumentSeo | undefined {
  return document.settings?.seo;
}

/** What the editor's document is to the place, once all of it is known. */
function placeContextOf(
  document: "page" | "template" | null,
  identity: ReturnType<typeof useDocumentIdentity>,
  userId: string | null | undefined,
  drawn: string | undefined,
  ownEntry: string | null | undefined
): PageBuilderSettingsContext | null {
  if (document === null || identity?.kind !== "collection") return null;
  if (userId === null || userId === undefined) return null;
  return {
    userId,
    document,
    collection: identity.slug,
    entryId: identity.documentId ?? null,
    draws: drawsOf(document, drawn, ownEntry),
  };
}

/** The collection a design draws, and the one entry an own design draws. */
function drawsOf(
  document: "page" | "template",
  drawn: string | undefined,
  ownEntry: string | null | undefined
): PageBuilderSettingsContext["draws"] {
  if (document !== "template" || drawn === undefined) return null;
  return { collection: drawn, entryId: ownEntry ?? null };
}

/**
 * The place for the document the editor has open: a page or a design, never
 * a Layout or a component, which state nothing for a page of their own.
 */
export function useSettingsPlace<TFieldValues extends FieldValues>(
  editor: PlaceEditor,
  control: Control<TFieldValues>,
  kind: DocumentKind,
  field?: string
): SettingsPlace | null {
  const identity = useDocumentIdentity();
  const userId = useCurrentUserId();
  const drawn = useTemplateCollection(control);
  const ownEntry = useOwnDesignEntry(control);
  const document: "page" | "template" | null =
    kind === "page" ? "page" : kind === "template" ? "template" : null;
  const context = useMemo(
    () => placeContextOf(document, identity, userId, drawn, ownEntry),
    [document, identity, userId, drawn, ownEntry]
  );
  const { apply } = editor;
  const value = seoOf(editor.document);
  const held = useHeldEdits();
  const tabProps = useMemo(
    (): PageBuilderSettingsTabProps => ({
      seo: {
        value,
        // One edit of the document, so the editor's Undo takes it back and
        // its Save stores it with the rest of the page.
        set: next => {
          const made = apply({ kind: "seo", seo: next });
          held.made(made);
          return made !== null;
        },
      },
      design: editor.document,
      control: control as unknown as Control<FieldValues>,
      writable: true,
      holdEdit: held.hold,
      ...(field === undefined ? {} : { designField: field }),
    }),
    [value, apply, editor.document, control, held, field]
  );
  const code = editor.document.settings?.code;
  const pageCode = useMemo(
    () => ({
      value: code,
      set: (next: DocumentCode | null) =>
        apply({ kind: "code", code: next }) !== null,
    }),
    [code, apply]
  );
  const css = editor.document.settings?.customCss;
  const pageCss = useMemo(
    () => ({
      value: css,
      set: (next: string | null) =>
        apply({ kind: "code", customCss: next }) !== null,
    }),
    [css, apply]
  );
  if (document === null) return null;
  return { context, tabProps, flushHeld: held.flush, pageCode, pageCss };
}

/**
 * The edits the place's tabs hold, made on `flush`: the document the last
 * edit made is kept as it is made, since the editor's own document is the
 * one from before it until it renders again.
 */
function useHeldEdits(): {
  hold: (make: () => void) => () => void;
  made: (document: BlockDocument | null) => void;
  flush: () => BlockDocument | null;
} {
  const holding = useRef(new Set<() => void>());
  const last = useRef<BlockDocument | null>(null);
  return useMemo(
    () => ({
      hold: make => {
        holding.current.add(make);
        return () => {
          holding.current.delete(make);
        };
      },
      made: document => {
        if (document !== null) last.current = document;
      },
      flush: () => {
        last.current = null;
        for (const make of [...holding.current]) make();
        return last.current;
      },
    }),
    []
  );
}
