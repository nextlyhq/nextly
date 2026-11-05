"use client";

/**
 * "Save as shared style…": name the block's look, see the class name it will
 * have and what moves, and save.
 *
 * Opened by the block verb, which every surface runs (the block card's menu,
 * the toolbar's More, the context menu, the bar), so the form is one dialog
 * the host raises rather than a popover tied to one of them.
 *
 * The save is two writes: the new style into the site style, then the block
 * (its styles cleared, the style put on it). The style goes first and the
 * block waits for it, since a page may not reference a style the site does
 * not define; a refused style leaves the block untouched.
 *
 * @module shared-style-save-dialog
 */

import {
  findNode,
  namedClassName,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { lockViewOf } from "./inspector";
import { Refusal } from "./panel-actions";
import { sharedStyleSlug } from "./shared-style-library";
import {
  newSharedStyleName,
  planSaveAsSharedStyle,
  saveAsSharedStyleOps,
  sharedStyleMoveSummary,
  sharedStyleMoveWhat,
  type SharedStyleOffer,
} from "./shared-style-target";

/** @experimental Settles with the shared-styles editor. */
export interface SaveSharedStyleDialogProps {
  readonly editor: EditorState;
  /** The block whose look is saved. */
  readonly nodeId: string;
  readonly offer: SharedStyleOffer;
  /** Store the new style; resolves to the refusal in words, or nothing. */
  readonly onAdd: (entry: NamedClass) => Promise<string | undefined>;
  /** Told once the style is stored and on the block, with its name. */
  readonly onSaved?: (name: string) => void;
  readonly onClose: () => void;
}

/**
 * How long a saved style is waited for in the library the canvas draws from
 * before the block is moved onto it anyway: it is stored, and the canvas
 * draws it on its next read.
 */
export const SAVE_AS_DRAWN_WAIT_MS = 10_000;

/**
 * Store the new style, then move the block onto it: the refusal in words, or
 * `undefined` once both are done. The block keeps its own look until the
 * style is in the library the canvas draws from, since the library is read
 * again only after the save: moved sooner, the block is drawn for a moment
 * with neither. The block's half is built from the block as it stands then,
 * so a value it gained meanwhile is kept, where the plan's ops would drop it.
 */
async function storeAndApply(
  entry: NamedClass,
  onAdd: (entry: NamedClass) => Promise<string | undefined>,
  drawn: (id: string) => Promise<void>,
  live: () => EditorState,
  nodeId: string
): Promise<string | undefined> {
  const refused = await onAdd(entry);
  if (refused !== undefined) return refused;
  await drawn(entry.id);
  const now = live();
  const block = findNode(now.document.nodes, nodeId);
  const ops = block === undefined ? null : saveAsSharedStyleOps(block, entry);
  if (ops === null || now.applyAll(ops) === null) {
    return `${entry.label ?? entry.slug} was saved, but this block could not be changed to use it.`;
  }
  return undefined;
}

/**
 * A wait for a style to be in `library`, the library the canvas draws from as
 * the host hands it, answered as each new library arrives, and at most
 * {@link SAVE_AS_DRAWN_WAIT_MS}.
 */
function useDrawnIn(
  library: readonly NamedClass[] | undefined
): (id: string) => Promise<void> {
  const latest = React.useRef(library);
  latest.current = library;
  const waiting = React.useRef(new Set<() => void>());
  React.useEffect(() => {
    for (const check of [...waiting.current]) check();
  }, [library]);
  return React.useCallback(
    (id: string) =>
      new Promise<void>(resolve => {
        const done = (): void => {
          clearTimeout(timer);
          waiting.current.delete(check);
          resolve();
        };
        const check = (): void => {
          if (latest.current?.some(entry => entry.id === id) === true) done();
        };
        const timer = setTimeout(done, SAVE_AS_DRAWN_WAIT_MS);
        waiting.current.add(check);
        check();
      }),
    []
  );
}

/** The dialog that saves a block's look as a new shared style. */
export function SaveSharedStyleDialog({
  editor,
  nodeId,
  offer,
  onAdd,
  onSaved,
  onClose,
}: SaveSharedStyleDialogProps): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [problem, setProblem] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  // The editor as it stands when the style has been stored, for the page
  // edit that follows it.
  const live = React.useRef(editor);
  live.current = editor;
  const drawn = useDrawnIn(offer.library);
  const nameId = React.useId();
  const hintId = `${nameId}-hint`;
  const node = findNode(editor.document.nodes, nodeId);
  const slug = sharedStyleSlug(name);
  // Said while typing, once there is a class name to collide.
  const nameIssue =
    slug === "" || offer.library === undefined
      ? undefined
      : (() => {
          const checked = newSharedStyleName(name, offer.library);
          return checked.ok ? undefined : checked.reason;
        })();
  const shown = problem ?? nameIssue;

  const save = async (): Promise<void> => {
    if (saving) return;
    const plan = planSaveAsSharedStyle(
      editor.document,
      nodeId,
      name,
      offer,
      lockViewOf(editor)
    );
    if (!plan.ok) {
      setProblem(plan.reason);
      return;
    }
    setSaving(true);
    try {
      const refused = await storeAndApply(
        plan.entry,
        onAdd,
        drawn,
        () => live.current,
        nodeId
      );
      if (refused !== undefined) {
        setProblem(refused);
        return;
      }
      onSaved?.(plan.entry.label ?? plan.entry.slug);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-sm" data-save-shared-style="">
        <form
          className="nx-vars-editor__body"
          onSubmit={event => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as shared style</DialogTitle>
            <DialogDescription>
              {/*
               * While the name cannot be used (it is another style's), the
               * summary must not read as a merge into that style.
               */}
              {nameIssue === undefined
                ? `${sharedStyleMoveSummary(node?.styles, name)} Other blocks can then wear it, and a change to it reaches them all.`
                : `Choose another name to move ${sharedStyleMoveWhat(node?.styles)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="nx-vars-editor__field">
            <label className="nx-vars-editor__label" htmlFor={nameId}>
              Name
            </label>
            <Input
              id={nameId}
              value={name}
              placeholder="Card"
              autoFocus
              aria-describedby={hintId}
              aria-invalid={shown !== undefined}
              onChange={event => {
                setName(event.target.value);
                setProblem(undefined);
              }}
            />
            {/* The class the page will carry, as the Shared styles tab shows it. */}
            <p
              className="nx-vars-editor__code nx-shared-style-save__class"
              aria-live="polite"
            >
              {slug === "" ? " " : `.${namedClassName(slug)}`}
            </p>
            <p className="nx-shared-style-save__hint" id={hintId}>
              Name it for what it is, like Card or Primary button.
            </p>
          </div>
          {/* In the field-error style the other Design editors use. */}
          <Refusal refusal={shown ?? null} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || slug === "" || nameIssue !== undefined}
            >
              Save shared style
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
