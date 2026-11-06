"use client";

/**
 * The Delete component dialog: what deleting a component would do, the offer
 * to turn each copy into plain blocks and then delete it, the delete while it
 * runs, and how it ended.
 *
 * Opening it asks the route for a dry run, which writes nothing. Its states,
 * by what the route answers (`component-delete/contract.ts`):
 *
 * - **Checking**: the dry run is on its way.
 * - **Counting**: the dry run counted part of the site only; it is asked
 *   again, and nothing is offered until the count is whole, so a component
 *   whose uses are still being found never reads as unused.
 * - **Nothing uses it**: delete it at once, or Cancel.
 * - **Used**: the documents that use it, named where the author may read
 *   them and counted where not, with "Turn each copy into plain blocks, then
 *   delete", or Cancel. Published documents with unpublished changes, and the
 *   documents the author may not be allowed to change, are said beside it.
 * - **A Layout uses it**, or **a document stops it**: why, for each, and
 *   nothing to confirm. Nothing was changed.
 * - **No permission**: the usage, and that the author may not delete
 *   components.
 * - **Someone else's delete**: nothing to confirm until theirs is finished.
 * - **Your paused delete**: resume it.
 * - **Deleting**: each call carries the delete on by one step, while the
 *   dialog stays open; the bar counts the documents finished. Closing pauses
 *   the delete, which the next opening offers to resume.
 * - **Partly done**: the documents left, each with why, so the component was
 *   kept; trying again picks up where it stopped.
 * - **Deleted**.
 * - **Error**: the refusal's own words, and Try again.
 *
 * Focus starts on Cancel, the safe choice, as every confirmation in the
 * admin does; when a state change removes the focused control, focus returns
 * to the dialog's first button. A hidden live region says each state as it
 * comes, the delete's progress included.
 *
 * @module admin/DeleteComponentDialog
 */
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Progress,
  Spinner,
} from "@nextlyhq/ui";
import { CircleCheck } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import type {
  ComponentDeleteResult,
  DocumentList,
  LeftDocument,
} from "../component-delete/contract";
import { MESSAGES, SOMEONE_ELSE_IS_DELETING } from "../component-delete/words";

import {
  checkComponentDelete,
  documentCount,
  documentHref,
  documentTitle,
  planComplete,
  progressOf,
  stepComponentDelete,
  underWay,
  type DeleteCall,
} from "./component-delete-client";

/** Which component the dialog deletes, and what follows. */
export interface DeleteComponentDialogProps {
  readonly componentId: string;
  /**
   * The component's title, as the author knows it; null where the screen
   * already shows which component it is (its own edit screen).
   */
  readonly name: string | null;
  readonly open: boolean;
  /** Closed with the component still there: cancelled, refused or paused. */
  readonly onClose: () => void;
  /** Closed once the component is gone. */
  readonly onDeleted: () => void;
  /** What the button that leaves a deleted component says. */
  readonly leaveLabel: string;
}

/** Where the dialog is. */
type View =
  | { readonly kind: "checking" }
  /** The dry run's answer, whole or still counting. */
  | { readonly kind: "checked"; readonly result: ComponentDeleteResult }
  | {
      readonly kind: "deleting";
      /** The last step's answer; null before the first one lands. */
      readonly result: ComponentDeleteResult | null;
    }
  /** A step that stopped the delete: refused before converting, or left. */
  | { readonly kind: "stopped"; readonly result: ComponentDeleteResult }
  | { readonly kind: "deleted" }
  | { readonly kind: "someone-else"; readonly message: string }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "failed";
      readonly message: string;
      /** What Try again does: check again, or start the delete again. */
      readonly retry: "check" | "delete";
    };

/** How long a part-counted plan waits before it is asked again. */
const RECOUNT_MS = 1500;

/** How long the dialog waits between two steps of the delete. */
const STEP_GAP_MS = 250;

/** How many documents a list names before "and N more". */
const NAMED_SHOWN = 5;

/** "1 document", "3 documents". */
function documents(count: number): string {
  return `${String(count)} ${count === 1 ? "document" : "documents"}`;
}

/** A pause the dialog's loops take, as a promise. */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * The face of a dry run's answer, by what stops a delete first: someone
 * else's open delete, then the author's own paused one, then the right to
 * delete at all, then a refusal, then whether anything uses it.
 */
type CheckedFace =
  | "counting"
  | "someone-else"
  | "resume"
  | "no-permission"
  | "refused"
  | "none"
  | "used";

/** Which face a dry run's answer shows. */
export function checkedFace(result: ComponentDeleteResult): CheckedFace {
  if (result.run !== null) {
    return result.run.yours ? "resume" : "someone-else";
  }
  if (!planComplete(result.plan)) return "counting";
  if (!result.mayDelete) return "no-permission";
  if (result.status === "refused") return "refused";
  if (result.status === "none") return "none";
  return "used";
}

/** A list of documents: the first few as links, the rest counted. */
function DocumentLinks({
  list,
  label,
}: {
  list: DocumentList;
  /** The list's accessible name. */
  label: string;
}): JSX.Element | null {
  const shown = list.named.slice(0, NAMED_SHOWN);
  const more = list.named.length - shown.length + list.more;
  if (shown.length === 0 && more === 0 && list.unreadable === 0) return null;
  return (
    <div className="space-y-1">
      {shown.length > 0 ? (
        <ul
          aria-label={label}
          className="divide-y divide-border rounded-md border border-border text-sm"
        >
          {shown.map(document => (
            <li
              key={`${document.kind}:${document.slug}:${document.id ?? ""}`}
              className="px-3 py-2"
            >
              <a
                className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                href={documentHref(document)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {documentTitle(document)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {more > 0 || list.unreadable > 0 ? (
        <p className="text-sm text-muted-foreground">
          {[
            more > 0 ? `and ${String(more)} more` : null,
            list.unreadable > 0
              ? `${shown.length > 0 || more > 0 ? "and " : ""}${documents(list.unreadable)} you can't view`
              : null,
          ]
            .filter(part => part !== null)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/** The documents that stop the delete, or that it left, each with why. */
function LeftDocuments({
  left,
  label,
}: {
  left: readonly LeftDocument[];
  label: string;
}): JSX.Element | null {
  if (left.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm"
    >
      {left.map((entry, index) => (
        <li
          // A document the author may not read has no key of its own.
          key={
            entry.document === null
              ? `unreadable:${String(index)}`
              : `${entry.document.slug}:${entry.document.id ?? ""}:${entry.reason}`
          }
          className="space-y-0.5 px-3 py-2"
        >
          {entry.document === null ? (
            <span className="block font-medium text-foreground">
              A document you can&rsquo;t view
            </span>
          ) : (
            <a
              className="block truncate font-medium text-primary underline-offset-4 hover:underline"
              href={documentHref(entry.document)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {documentTitle(entry.document)}
            </a>
          )}
          <span className="block text-muted-foreground">{entry.words}</span>
        </li>
      ))}
    </ul>
  );
}

/** The bar and its line while the delete runs, or before it counted. */
function DeleteProgressBar({
  result,
}: {
  result: ComponentDeleteResult | null;
}): JSX.Element {
  const { finished, total } = progressOf(result?.progress);
  const checking = result === null || result.status === "preflight";
  if (checking || total === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="inline-flex">
          <Spinner size="sm" />
        </span>
        <span>
          {checking
            ? "Checking every document before anything changes…"
            : "Finding the copies…"}
        </span>
      </div>
    );
  }
  const percent = Math.round((Math.min(finished, total) / total) * 100);
  const line = `${String(Math.min(finished, total))} of ${documents(total)} done`;
  return (
    <div className="space-y-2">
      <Progress value={percent} aria-label={line} />
      <p className="text-sm text-muted-foreground">{line}</p>
    </div>
  );
}

/** What the dialog says and shows in one state. */
interface Face {
  readonly title: string;
  readonly succeeded?: true;
  readonly sentence: ReactNode;
  readonly body: ReactNode;
  /** What the hidden live region says when the state comes. */
  readonly announce: string;
  readonly footer: ReactNode;
}

/** The parts of the dialog a face is drawn from. */
interface FaceArgs {
  readonly name: string | null;
  readonly leaveLabel: string;
  readonly onDelete: () => void;
  readonly onCheck: () => void;
  readonly onLeave: () => void;
  readonly cancelRef: RefObject<HTMLButtonElement | null>;
  readonly leaveRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The component's name, in bold within a sentence, or "this component"
 * where the screen already names it ("This component" opening a sentence).
 */
function Named({
  name,
  opening = false,
}: {
  name: string | null;
  opening?: boolean;
}): JSX.Element {
  if (name === null || name.trim() === "") {
    return <>{opening ? "This component" : "this component"}</>;
  }
  return <strong className="font-semibold text-foreground">{name}</strong>;
}

/** The footer's safe button: Cancel, Close or Pause. Focus starts here. */
function SafeButton({
  label,
  cancelRef,
}: {
  label: string;
  cancelRef: RefObject<HTMLButtonElement | null>;
}): JSX.Element {
  return <AlertDialogCancel ref={cancelRef}>{label}</AlertDialogCancel>;
}

/** What a used component's plan says beside its list. */
function PlanNotes({
  result,
}: {
  result: ComponentDeleteResult;
}): JSX.Element | null {
  const drafts = documentCount(result.plan?.drafts);
  const mayBeRefused = result.plan?.mayBeRefused ?? 0;
  if (drafts === 0 && mayBeRefused === 0) return null;
  return (
    <div className="space-y-2">
      {drafts > 0 ? (
        <Alert variant="warning" role="note">
          <AlertDescription>
            {`${documents(drafts)} ${drafts === 1 ? "has" : "have"} unpublished changes. ${drafts === 1 ? "Its" : "Their"} copies are turned into plain blocks in the changes, but the component is kept until they are published or discarded. Then delete it again.`}
          </AlertDescription>
        </Alert>
      ) : null}
      {mayBeRefused > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`You may not be allowed to change ${String(mayBeRefused)} of these. If a change is refused, the component is kept and the document is listed.`}
        </p>
      ) : null}
    </div>
  );
}

/** How many documents a plan turns into plain blocks, or else holds drafts. */
function usedBy(result: ComponentDeleteResult): number {
  const convert = documentCount(result.plan?.convert);
  return convert > 0 ? convert : documentCount(result.plan?.drafts);
}

/** The face of a dry run's answer. */
function checkedFaceOf(result: ComponentDeleteResult, args: FaceArgs): Face {
  const { name, cancelRef } = args;
  const plan = result.plan;
  const count = usedBy(result);
  const list =
    plan === undefined ? null : (
      <DocumentLinks list={plan.convert} label="Documents that use it" />
    );
  switch (checkedFace(result)) {
    case "counting":
      return {
        title: "Delete component",
        sentence: (
          <>
            {"Still finding where "}
            <Named name={name} />
            {count > 0
              ? ` is used: ${documents(count)} so far. This can take a moment on a large site.`
              : " is used. This can take a moment on a large site."}
          </>
        ),
        body: (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true" className="inline-flex">
              <Spinner size="sm" />
            </span>
            <span>Counting…</span>
          </div>
        ),
        announce: "Still counting where it is used.",
        footer: <SafeButton label="Cancel" cancelRef={cancelRef} />,
      };
    case "someone-else":
      return someoneElseFace(SOMEONE_ELSE_IS_DELETING, args);
    case "resume":
      return {
        title: "Delete component",
        sentence: (
          <>
            {"You started deleting "}
            <Named name={name} />
            {
              ", and it was paused. Resume to finish turning its copies into plain blocks and delete it."
            }
          </>
        ),
        body: null,
        announce: "Your delete of this component is paused.",
        footer: (
          <>
            <SafeButton label="Cancel" cancelRef={cancelRef} />
            <Button type="button" variant="destructive" onClick={args.onDelete}>
              Resume delete
            </Button>
          </>
        ),
      };
    case "no-permission":
      return {
        title: "Delete component",
        sentence: (
          <>
            {"You don't have permission to delete "}
            <Named name={name} />
            {count > 0 ? `. It is used in ${documents(count)}.` : "."}
          </>
        ),
        body: list,
        announce: "You don't have permission to delete this component.",
        footer: <SafeButton label="Close" cancelRef={cancelRef} />,
      };
    case "refused":
      return refusedFace(result, args, false);
    case "none":
      return {
        title: "Delete component",
        sentence: (
          <>
            {"Nothing uses "}
            <Named name={name} />
            {". Deleting it removes it for good."}
          </>
        ),
        body: null,
        announce: MESSAGES.none,
        footer: (
          <>
            <SafeButton label="Cancel" cancelRef={cancelRef} />
            <Button type="button" variant="destructive" onClick={args.onDelete}>
              Delete component
            </Button>
          </>
        ),
      };
    case "used":
      return {
        title: "Delete component",
        sentence: (
          <>
            <Named name={name} opening />
            {` is used in ${documents(count)}. Deleting it turns each copy into plain blocks first, so every page keeps showing exactly what it shows now. The blocks are no longer linked to the component.`}
          </>
        ),
        body: (
          <div className="space-y-3">
            {list}
            <PlanNotes result={result} />
            {plan !== undefined && documentCount(plan.convert) === 0 ? (
              <DocumentLinks
                list={plan.drafts}
                label="Documents with unpublished changes"
              />
            ) : null}
          </div>
        ),
        announce: `It is used in ${documents(count)}.`,
        footer: (
          <>
            <SafeButton label="Cancel" cancelRef={cancelRef} />
            <Button type="button" variant="destructive" onClick={args.onDelete}>
              Turn each copy into plain blocks, then delete
            </Button>
          </>
        ),
      };
  }
}

/** Someone else's delete is open: nothing to do until it is finished. */
function someoneElseFace(message: string, { cancelRef }: FaceArgs): Face {
  return {
    title: "Someone else is deleting this component",
    sentence: message,
    body: null,
    announce: message,
    footer: <SafeButton label="Close" cancelRef={cancelRef} />,
  };
}

/**
 * Refused, with nothing changed: the Layouts that use it, and the documents
 * that stop it, each with why. `afterStart` when the check ran as the first
 * step of a delete the author confirmed.
 */
function refusedFace(
  result: ComponentDeleteResult,
  { name, cancelRef, onCheck }: FaceArgs,
  afterStart: boolean
): Face {
  const layouts = result.layouts;
  const left = result.left ?? [];
  const layoutCount = documentCount(layouts);
  return {
    title: "This component can't be deleted yet",
    sentence: (
      <>
        {layoutCount > 0 ? (
          <>
            {layoutCount === 1
              ? "A Layout uses "
              : `${String(layoutCount)} Layouts use `}
            <Named name={name} />
            {". Choose a different component in "}
            {layoutCount === 1 ? "that Layout" : "those Layouts"}
            {" first."}
          </>
        ) : (
          <>
            <Named name={name} opening />
            {left.length === 1
              ? " can't be deleted, because of the document below."
              : " can't be deleted, because of the documents below."}
          </>
        )}
        {afterStart ? " Nothing was changed." : null}
      </>
    ),
    body: (
      <div className="space-y-3">
        {layouts !== undefined && layoutCount > 0 ? (
          <DocumentLinks list={layouts} label="Layouts" />
        ) : null}
        <LeftDocuments left={left} label="Documents that stop the delete" />
      </div>
    ),
    announce: MESSAGES.refused,
    footer: (
      <>
        <SafeButton label="Close" cancelRef={cancelRef} />
        <Button type="button" variant="outline" onClick={onCheck}>
          Check again
        </Button>
      </>
    ),
  };
}

/** The face of every state but the dry run's. */
function faceOf(view: View, args: FaceArgs): Face {
  const { cancelRef, leaveRef } = args;
  switch (view.kind) {
    case "checking":
      return {
        title: "Delete component",
        sentence: (
          <>
            {"Checking where "}
            <Named name={args.name} />
            {" is used…"}
          </>
        ),
        body: (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true" className="inline-flex">
              <Spinner size="sm" />
            </span>
            <span>Checking…</span>
          </div>
        ),
        announce: "Checking where the component is used.",
        footer: <SafeButton label="Cancel" cancelRef={cancelRef} />,
      };
    case "checked":
      return checkedFaceOf(view.result, args);
    case "deleting": {
      const { finished, total } = progressOf(view.result?.progress);
      return {
        title: "Deleting component",
        sentence: MESSAGES.running,
        body: <DeleteProgressBar result={view.result} />,
        announce:
          total === 0
            ? "Deleting the component."
            : `${String(Math.min(finished, total))} of ${documents(total)} done.`,
        footer: (
          <>
            <SafeButton label="Pause" cancelRef={cancelRef} />
            <Button type="button" variant="destructive" disabled>
              Deleting…
            </Button>
          </>
        ),
      };
    }
    case "stopped":
      if (view.result.status === "refused") {
        return refusedFace(view.result, args, true);
      }
      return {
        title: "Some copies couldn't be turned into plain blocks",
        sentence: MESSAGES.partlyDone,
        body: (
          <div className="space-y-3">
            {view.result.progress !== undefined &&
            view.result.progress.converted > 0 ? (
              <p className="text-sm text-muted-foreground">
                {`${documents(view.result.progress.converted)} turned into plain blocks.`}
              </p>
            ) : null}
            <LeftDocuments
              left={view.result.left ?? []}
              label="Documents left as they are"
            />
          </div>
        ),
        announce: MESSAGES.partlyDone,
        footer: (
          <>
            <SafeButton label="Close" cancelRef={cancelRef} />
            <Button type="button" variant="destructive" onClick={args.onDelete}>
              Try again
            </Button>
          </>
        ),
      };
    case "deleted":
      return {
        title: "Component deleted",
        succeeded: true,
        sentence: MESSAGES.done,
        body: null,
        announce: MESSAGES.done,
        footer: (
          <Button ref={leaveRef} type="button" onClick={args.onLeave}>
            {args.leaveLabel}
          </Button>
        ),
      };
    case "someone-else":
      return someoneElseFace(view.message, args);
    case "forbidden":
      return {
        title: "Delete component",
        sentence: "You don't have permission to delete this component.",
        body: null,
        announce: "You don't have permission to delete this component.",
        footer: <SafeButton label="Close" cancelRef={cancelRef} />,
      };
    case "failed":
      return {
        title: "Delete component",
        sentence:
          view.retry === "check"
            ? "Something went wrong while checking where it is used."
            : "The delete stopped before it was finished. The component is still here.",
        body: (
          <Alert variant="destructive">
            <AlertDescription>{view.message}</AlertDescription>
          </Alert>
        ),
        announce: view.message,
        footer: (
          <>
            <SafeButton label="Close" cancelRef={cancelRef} />
            <Button
              type="button"
              variant="outline"
              onClick={view.retry === "check" ? args.onCheck : args.onDelete}
            >
              Try again
            </Button>
          </>
        ),
      };
  }
}

/** The view a call that is not an answer leaves the dialog in. */
function viewOfRefusal(
  call: Exclude<DeleteCall, { kind: "answer" }>,
  retry: "check" | "delete"
): View {
  switch (call.kind) {
    case "conflict":
      return { kind: "someone-else", message: call.message };
    case "forbidden":
      return { kind: "forbidden" };
    case "failed":
      return { kind: "failed", message: call.message, retry };
  }
}

/** The dialog, by the states in the module docblock. */
export function DeleteComponentDialog({
  componentId,
  name,
  open,
  onClose,
  onDeleted,
  leaveLabel,
}: DeleteComponentDialogProps): JSX.Element {
  const [view, setView] = useState<View>({ kind: "checking" });
  // Each opening and each action, numbered: an answer that arrives for an
  // earlier one, after the author closed the dialog or moved on, changes
  // nothing, and a loop that sees a newer number stops.
  const turn = useRef(0);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const leaveRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const check = useCallback(async (): Promise<void> => {
    turn.current += 1;
    const mine = turn.current;
    setView({ kind: "checking" });
    for (;;) {
      const answer = await checkComponentDelete(componentId);
      if (turn.current !== mine) return;
      if (answer.kind !== "answer") {
        setView(viewOfRefusal(answer, "check"));
        return;
      }
      setView({ kind: "checked", result: answer.result });
      // A plan still being counted is asked again; nothing is offered on it.
      if (checkedFace(answer.result) !== "counting") return;
      await wait(RECOUNT_MS);
      if (turn.current !== mine) return;
    }
  }, [componentId]);

  const runDelete = useCallback(async (): Promise<void> => {
    turn.current += 1;
    const mine = turn.current;
    setView({ kind: "deleting", result: null });
    for (;;) {
      const answer = await stepComponentDelete(componentId);
      // Closed or moved on: the delete pauses here, and resumes when the
      // dialog is opened again.
      if (turn.current !== mine) return;
      if (answer.kind !== "answer") {
        setView(viewOfRefusal(answer, "delete"));
        return;
      }
      const result = answer.result;
      if (underWay(result)) {
        setView({ kind: "deleting", result });
        await wait(STEP_GAP_MS);
        if (turn.current !== mine) return;
        continue;
      }
      if (result.status === "done") {
        setView({ kind: "deleted" });
      } else if (
        result.status === "refused" ||
        result.status === "partly-done"
      ) {
        setView({ kind: "stopped", result });
      } else {
        setView({
          kind: "failed",
          message: "The delete answered in a way this screen doesn't know.",
          retry: "delete",
        });
      }
      return;
    }
  }, [componentId]);

  // Each opening checks afresh; closing stops whatever loop is running.
  useEffect(() => {
    if (open) {
      void check();
    } else {
      turn.current += 1;
    }
    return () => {
      turn.current += 1;
    };
  }, [open, check]);

  // A state change can remove the focused button (the confirm, as the
  // delete starts): focus then goes back to the first button, never to the
  // page behind the dialog.
  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    if (content === null) return;
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      content.contains(active)
    ) {
      return;
    }
    (leaveRef.current ?? cancelRef.current)?.focus();
  }, [open, view.kind]);

  const face = faceOf(view, {
    name,
    leaveLabel,
    onDelete: () => void runDelete(),
    onCheck: () => void check(),
    onLeave: onDeleted,
    cancelRef,
    leaveRef,
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (next) return;
        if (view.kind === "deleted") onDeleted();
        else onClose();
      }}
    >
      <AlertDialogContent
        ref={contentRef}
        // A phone keeps a gutter on both sides, and a long list scrolls
        // inside the dialog rather than past the screen.
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {/* The success colour marks the outcome on an icon, where it
                needs only 3:1, so the sentence keeps the body text colour. */}
            {face.succeeded === true ? (
              <CircleCheck
                aria-hidden="true"
                className="size-5 shrink-0 text-success"
              />
            ) : null}
            {face.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{face.sentence}</AlertDialogDescription>
        </AlertDialogHeader>
        {face.body}
        {/* Says each state as it comes, the delete's progress included;
            visible text says the same. */}
        <p className="sr-only" role="status" aria-live="polite">
          {face.announce}
        </p>
        <AlertDialogFooter>{face.footer}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
