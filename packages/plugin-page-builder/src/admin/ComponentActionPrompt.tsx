"use client";

/**
 * The forms behind "Detach from component", "Duplicate component" and
 * "Update a pattern", each mounted only while the author has asked for it.
 *
 * - **Detach** asks the server for the plan when it opens, which writes
 *   nothing: the ops that replace the placement with the blocks it draws, as
 *   the canvas shows them, and whether the component has unpublished changes,
 *   which is said before the author confirms. Confirming applies the ops as
 *   one undoable step.
 * - **Duplicate** names the copy, then the server creates it, published, and
 *   answers with the op pointing this one placement at it, applied once the
 *   canvas holds the copy. Other placements keep the original.
 * - **Update a pattern** picks the pattern to replace (the one the selection
 *   was inserted from, when it says), and says that pages which inserted it
 *   earlier keep their copies.
 *
 * @module admin/ComponentActionPrompt
 */
import {
  findNode,
  isComponentInstance,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  useModalKeyboardHold,
  type EditorState,
} from "@nextlyhq/builder/shell";
import { useDocumentLocale } from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@nextlyhq/ui";
import * as React from "react";

import type { DetachResult } from "../component-actions-contract";

import {
  useDetach,
  useDuplicate,
  useUpdatePattern,
} from "./component-actions-client";
import type { ComponentLibraryRead } from "./component-library-client";
import { focusAfterClose, subjectOf } from "./library-dialog";
import { usePatternLibrary } from "./pattern-library-client";

/** Which form, and the page it acts on, snapshotted at the gesture. */
export interface ComponentActionRequest {
  readonly action: "detach" | "duplicate" | "update-pattern";
  readonly document: BlockDocument;
}

export interface ComponentActionPromptProps {
  readonly request: ComponentActionRequest | null;
  readonly editor: Pick<EditorState, "selection" | "applyAll" | "select">;
  readonly library: Pick<
    ComponentLibraryRead,
    "definitions" | "components" | "retry"
  >;
  readonly onClose: () => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

/** How long a duplicate waits for the canvas to hold the copy. */
const DEFINITION_WAIT_MS = 8000;

/** The form for the verb asked for, or nothing while none is. */
export function ComponentActionPrompt(
  props: Omit<ComponentActionPromptProps, "request"> & {
    readonly request: {
      readonly action: string;
      readonly document: BlockDocument;
    } | null;
  }
): React.JSX.Element | null {
  const asked = props.request;
  if (asked === null) return null;
  if (
    asked.action !== "detach" &&
    asked.action !== "duplicate" &&
    asked.action !== "update-pattern"
  ) {
    return null;
  }
  const request: ComponentActionRequest = {
    action: asked.action,
    document: asked.document,
  };
  const ids = props.editor.selection.ids;
  if (request.action === "update-pattern") {
    return <UpdatePatternForm {...props} request={request} ids={ids} />;
  }
  const instanceId = ids.length === 1 ? ids[0] : undefined;
  const node =
    instanceId === undefined
      ? undefined
      : findNode(request.document.nodes, instanceId);
  if (node === undefined || !isComponentInstance(node)) return null;
  const named = (node.props as { componentId?: unknown }).componentId;
  const componentId = typeof named === "string" ? named : "";
  const placed = { instanceId: node.id, componentId };
  return request.action === "detach" ? (
    <DetachForm {...props} request={request} placed={placed} />
  ) : (
    <DuplicateForm {...props} request={request} placed={placed} />
  );
}

/** The placement a form acts on. */
interface Placed {
  readonly instanceId: string;
  readonly componentId: string;
}

/** The dialog every form draws, around its own body and buttons. */
function ActionDialog({
  title,
  description,
  busy,
  onClose,
  returnFocusTo,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  returnFocusTo: (() => HTMLElement | null) | undefined;
  onSubmit: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}): React.JSX.Element {
  useModalKeyboardHold("component-action-dialog", true);
  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!busy && !next) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-lg"
        onCloseAutoFocus={focusAfterClose(returnFocusTo)}
      >
        <form
          className="flex min-h-0 flex-col"
          aria-busy={busy}
          onSubmit={event => {
            // Kept from the page form around the editor, which would save
            // the page.
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto py-4">
            {children}
          </div>
          {footer}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancel and the form's own verb. */
function Buttons({
  busy,
  disabled,
  verb,
  working,
  onClose,
}: {
  busy: boolean;
  disabled: boolean;
  verb: string;
  working: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={disabled || busy}>
        {busy ? working : verb}
      </Button>
    </DialogFooter>
  );
}

/** A refusal or a failure, said where the author is looking. */
function Problem({
  text,
}: {
  text: string | undefined;
}): React.JSX.Element | null {
  if (text === undefined) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

function DetachForm({
  request,
  placed,
  editor,
  onClose,
  returnFocusTo,
}: ComponentActionPromptProps & {
  request: ComponentActionRequest;
  placed: Placed;
}): React.JSX.Element {
  const detach = useDetach();
  const locale = useDocumentLocale()?.code ?? undefined;
  const [plan, setPlan] = React.useState<DetachResult | null | undefined>();
  const send = detach.send;
  React.useEffect(() => {
    let live = true;
    void send({
      document: request.document,
      instanceId: placed.instanceId,
      ...(locale === undefined ? {} : { locale }),
      dryRun: true,
    }).then(answer => {
      if (live) setPlan(answer ?? null);
    });
    return () => {
      live = false;
    };
  }, [send, request.document, placed.instanceId, locale]);

  const name = plan?.component.title || "this component";
  const confirm = () => {
    if (plan === null || plan === undefined) return;
    if (editor.applyAll(plan.pageOps) === null) {
      toast.error(
        "The page could not take the detached blocks. Nothing changed."
      );
    } else {
      toast.success(`Detached from ${name}`);
    }
    onClose();
  };

  return (
    <ActionDialog
      title="Detach from component"
      description={`On this page, it becomes plain blocks that look exactly as they do now. Edits to ${name} will no longer reach them.`}
      busy={false}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      onSubmit={confirm}
      footer={
        <Buttons
          busy={false}
          disabled={plan === null || plan === undefined}
          verb="Detach"
          working="Detaching…"
          onClose={onClose}
        />
      }
    >
      {plan === undefined ? (
        // In the author's words, as the dialog's description speaks of it:
        // "placement" is the engine's word.
        <p className="text-xs text-muted-foreground" role="status">
          Checking what it draws…
        </p>
      ) : null}
      {plan?.unpublishedChanges === true ? (
        <Alert role="status">
          <AlertDescription>
            {name} has changes that are not published. The blocks keep what you
            see now, including those changes, even though pages placing the
            component still show its published version.
          </AlertDescription>
        </Alert>
      ) : null}
      <Problem
        text={
          plan === null
            ? (detach.error ?? "It could not be detached from the component.")
            : undefined
        }
      />
    </ActionDialog>
  );
}

function DuplicateForm({
  request,
  placed,
  editor,
  library,
  onClose,
  returnFocusTo,
}: ComponentActionPromptProps & {
  request: ComponentActionRequest;
  placed: Placed;
}): React.JSX.Element {
  const duplicate = useDuplicate(placed.componentId);
  const source = library.components.find(
    component => component.id === placed.componentId
  );
  const [title, setTitle] = React.useState(() =>
    source === undefined ? "" : `${source.title} copy`
  );
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [pending, setPending] = React.useState<{
    id: string;
    ops: readonly BuilderOp[];
  } | null>(null);

  // The re-point, applied once the canvas holds the copy and never before, so
  // the placement is never left drawing a definition the editor lacks.
  const definitions = library.definitions;
  const { applyAll } = editor;
  React.useEffect(() => {
    if (pending === null) return;
    const unused = (why: string) => {
      toast.error(
        `The copy was created, but ${why}. It is in your library, unused, and this page is unchanged.`
      );
      onClose();
    };
    if (!definitions.has(pending.id)) {
      const timer = window.setTimeout(
        () => unused("this editor could not load it"),
        DEFINITION_WAIT_MS
      );
      return () => window.clearTimeout(timer);
    }
    if (applyAll(pending.ops) === null) {
      unused("this page could not be switched to it");
      return;
    }
    toast.success("Component duplicated");
    onClose();
  }, [pending, definitions, applyAll, onClose]);

  const submit = async () => {
    if (busy || title.trim() === "") return;
    setBusy(true);
    setFailed(false);
    const answer = await duplicate.send({
      title: title.trim(),
      placement: { document: request.document, instanceId: placed.instanceId },
    });
    if (answer === undefined) {
      setBusy(false);
      setFailed(true);
      return;
    }
    library.retry();
    setPending({ id: answer.component.id, ops: answer.pageOps });
  };

  return (
    <ActionDialog
      title="Duplicate component"
      description={`A copy of ${source?.title ?? "this component"} is made, and the one you selected uses it, keeping its own values. Everywhere else keeps the original, other uses on this page included.`}
      busy={busy}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      onSubmit={() => void submit()}
      footer={
        <Buttons
          busy={busy}
          disabled={title.trim() === ""}
          verb="Duplicate"
          working="Duplicating…"
          onClose={onClose}
        />
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="nx-duplicate-title">Name of the copy</Label>
        <Input
          id="nx-duplicate-title"
          value={title}
          autoFocus
          required
          disabled={busy}
          onChange={event => setTitle(event.target.value)}
        />
      </div>
      <Problem
        text={
          failed
            ? (duplicate.error ?? "The component could not be duplicated.")
            : undefined
        }
      />
    </ActionDialog>
  );
}

/** The pattern a selection's first block says it was inserted from. */
function insertedFrom(
  document: BlockDocument,
  ids: readonly string[]
): string | undefined {
  const first =
    ids[0] === undefined ? undefined : findNode(document.nodes, ids[0]);
  const origin = (
    first as { origin?: { from?: unknown; id?: unknown } } | undefined
  )?.origin;
  return origin?.from === "pattern" && typeof origin.id === "string"
    ? origin.id
    : undefined;
}

function UpdatePatternForm({
  request,
  ids,
  editor,
  onClose,
  returnFocusTo,
}: ComponentActionPromptProps & {
  request: ComponentActionRequest;
  ids: readonly string[];
}): React.JSX.Element {
  const patterns = usePatternLibrary().patterns;
  const [chosen, setChosen] = React.useState(
    () => insertedFrom(request.document, ids) ?? ""
  );
  const update = useUpdatePattern(chosen);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const subject = subjectOf(request.document, ids);
  const pattern = patterns.find(entry => entry.id === chosen);

  const submit = async () => {
    if (busy || pattern === undefined) return;
    setBusy(true);
    setFailed(false);
    const answer = await update.send({
      document: request.document,
      selectedIds: ids,
    });
    if (answer === undefined) {
      setBusy(false);
      setFailed(true);
      return;
    }
    if (answer.pageOps.length > 0 && editor.applyAll(answer.pageOps) === null) {
      // The pattern is updated; only this page's record of it is stale.
      toast.warning(
        `Updated ${pattern.title}, but this page could not record it, so the blocks may show as changed from it.`
      );
      onClose();
      return;
    }
    toast.success(`Updated ${pattern.title}`);
    onClose();
  };

  return (
    <ActionDialog
      title="Update a pattern"
      description={`${subject} replaces the pattern's content. Pages that inserted it earlier keep their own copies.`}
      busy={busy}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      onSubmit={() => void submit()}
      footer={
        <Buttons
          busy={busy}
          disabled={pattern === undefined}
          verb="Update pattern"
          working="Updating…"
          onClose={onClose}
        />
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="nx-update-pattern">Pattern</Label>
        <Select value={chosen} onValueChange={setChosen} disabled={busy}>
          <SelectTrigger id="nx-update-pattern" aria-label="Pattern">
            <SelectValue placeholder="Choose a pattern" />
          </SelectTrigger>
          <SelectContent>
            {patterns.map(entry => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {patterns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            There are no patterns yet. Save one with “Save as pattern” first.
          </p>
        ) : null}
      </div>
      <Problem
        text={
          failed
            ? (update.error ?? "The pattern could not be updated.")
            : undefined
        }
      />
    </ActionDialog>
  );
}
