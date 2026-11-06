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
 * - **Counting**: the dry run reads the site a slice at a time, each slice
 *   answering only its own documents, so the dialog adds them up and asks
 *   for the next. The documents found so far are listed as they come, and
 *   nothing is offered until every document is read, so a component whose
 *   uses are still being found never reads as unused. A refusal found on
 *   the way is shown at once: reading more cannot undo it.
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
 *   kept; trying again picks up where it stopped. A delete refused part way
 *   for want of the right says what was converted before it.
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
  Skeleton,
  Spinner,
} from "@nextlyhq/ui";
import { CircleCheck, ExternalLink } from "lucide-react";
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
  NamedDocument,
} from "../component-delete/contract";
import { MESSAGES, SOMEONE_ELSE_IS_DELETING } from "../component-delete/words";

import {
  addSlice,
  checkComponentDelete,
  documentCount,
  documentHref,
  documentTitle,
  EMPTY_TALLY,
  progressOf,
  stepComponentDelete,
  tallyRefuses,
  tallyUses,
  underWay,
  type DeleteCall,
  type DeleteTally,
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
  /**
   * The dry run as read so far: the last slice's answer, which carries the
   * right to delete and the open delete, and every slice's documents added
   * up.
   */
  | {
      readonly kind: "checked";
      readonly result: ComponentDeleteResult;
      readonly tally: DeleteTally;
    }
  | {
      readonly kind: "deleting";
      /** The last step's answer; null before the first one lands. */
      readonly result: ComponentDeleteResult | null;
    }
  /** A step that stopped the delete: refused before converting, or left. */
  | { readonly kind: "stopped"; readonly result: ComponentDeleteResult }
  | { readonly kind: "deleted" }
  | { readonly kind: "someone-else"; readonly message: string }
  /** Refused for want of the right, with what an earlier step converted. */
  | { readonly kind: "forbidden"; readonly converted: number }
  | {
      readonly kind: "failed";
      readonly message: string;
      /** What Try again does: check again, or start the delete again. */
      readonly retry: "check" | "delete";
    };

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
 * The face of the dry run as read so far, by what stops a delete first:
 * someone else's open delete, then the author's own paused one, then the
 * right to delete it, then a refusal (which reading more cannot undo), then,
 * only once every document is read, whether anything uses it. Until then it
 * is counting, so a component whose uses are still being found never reads
 * as unused.
 */
type CheckedFace =
  | "counting"
  | "someone-else"
  | "resume"
  | "no-permission"
  | "refused"
  | "none"
  | "used";

/** Which face the dry run shows, from its last answer and its tally. */
export function checkedFace(
  result: ComponentDeleteResult,
  tally: DeleteTally
): CheckedFace {
  if (result.run !== null) {
    return result.run.yours ? "resume" : "someone-else";
  }
  if (!result.mayDelete) return "no-permission";
  if (tallyRefuses(tally)) return "refused";
  if (!tally.complete) return "counting";
  return tallyUses(tally) === 0 ? "none" : "used";
}

/**
 * A document, as a link that opens it in a new tab, so the author keeps the
 * dialog and its place. The icon and the hidden words say where it opens.
 */
function DocumentLink({ document }: { document: NamedDocument }): JSX.Element {
  return (
    // Inline, so a long title wraps and reads in full, the icon after its
    // last word.
    <a
      className="font-medium break-words text-primary underline-offset-4 hover:underline"
      href={documentHref(document)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {documentTitle(document)}
      <ExternalLink
        aria-hidden="true"
        className="ml-1.5 inline size-3.5 align-[-2px] text-muted-foreground"
      />
      <span className="sr-only">{" (opens in a new tab)"}</span>
    </a>
  );
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
              <DocumentLink document={document} />
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
      // On a phone the dialog itself scrolls, so the list is not a second
      // scroller inside it; wider screens cap it.
      className="divide-y divide-border rounded-md border border-border text-sm sm:max-h-60 sm:overflow-y-auto"
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
            <DocumentLink document={entry.document} />
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
function PlanNotes({ tally }: { tally: DeleteTally }): JSX.Element | null {
  const drafts = documentCount(tally.drafts);
  const mayBeRefused = tally.mayBeRefused;
  if (drafts === 0 && mayBeRefused === 0) return null;
  return (
    <div className="space-y-2">
      {drafts > 0 ? (
        <Alert variant="warning" role="note">
          <AlertDescription>
            {`${documents(drafts)} ${drafts === 1 ? "has" : "have"} unpublished changes. ${drafts === 1 ? "Its copy is" : "Their copies are"} converted in those changes too, but the component is kept until they are published or discarded. Delete it again after that.`}
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

/** The face of a dry run's answer. */
function checkedFaceOf(
  result: ComponentDeleteResult,
  tally: DeleteTally,
  args: FaceArgs
): Face {
  const { name, cancelRef } = args;
  const count = tallyUses(tally);
  // "At least" while documents are still to be read.
  const atLeast = tally.complete ? "" : "at least ";
  const list =
    documentCount(tally.convert) > 0 ? (
      <DocumentLinks list={tally.convert} label="Documents that use it" />
    ) : documentCount(tally.drafts) > 0 ? (
      <DocumentLinks
        list={tally.drafts}
        label="Documents with unpublished changes"
      />
    ) : null;
  switch (checkedFace(result, tally)) {
    case "counting":
      return {
        title: "Delete component",
        sentence: (
          <>
            {count > 0 ? (
              <>
                <Named name={name} opening />
                {` is used in at least ${documents(count)} so far. The rest of the site is still being checked, so nothing can be deleted yet.`}
              </>
            ) : (
              <>
                {"Still checking where "}
                <Named name={name} />
                {" is used. This can take a moment on a large site."}
              </>
            )}
          </>
        ),
        body: (
          <div className="space-y-3">
            {list}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="inline-flex">
                <Spinner size="sm" />
              </span>
              <span>
                {count > 0
                  ? `Checking… ${documents(count)} found so far`
                  : "Checking… none found so far"}
              </span>
            </div>
          </div>
        ),
        announce:
          count > 0
            ? `Still checking. ${documents(count)} found so far.`
            : MESSAGES.counting,
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
            {count > 0 ? `. It is used in ${atLeast}${documents(count)}.` : "."}
          </>
        ),
        body: list,
        announce: "You don't have permission to delete this component.",
        footer: <SafeButton label="Close" cancelRef={cancelRef} />,
      };
    case "refused":
      return refusedFace(tally, args, false);
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
            <PlanNotes tally={tally} />
          </div>
        ),
        announce: `It is used in ${documents(count)}.`,
        footer: (
          <>
            <SafeButton label="Cancel" cancelRef={cancelRef} />
            <Button
              type="button"
              variant="destructive"
              // The words are long: on a phone they wrap rather than push
              // the dialog past the screen's edge.
              className="h-auto min-h-9 whitespace-normal py-2 text-center"
              onClick={args.onDelete}
            >
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
    title: "Delete in progress",
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
  tally: DeleteTally,
  { name, cancelRef, onCheck }: FaceArgs,
  afterStart: boolean
): Face {
  const layouts = tally.layouts;
  const left = tally.left;
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
            {left.length === 1
              ? "The document below stops the delete. Fix it, then check again."
              : "Each document below stops the delete. Fix them, then check again."}
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
        // The shape of the list to come, so the dialog does not jump.
        body: (
          <div
            aria-hidden="true"
            className="divide-y divide-border rounded-md border border-border"
          >
            <div className="px-3 py-2.5">
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="px-3 py-2.5">
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ),
        announce: "Checking where the component is used.",
        footer: <SafeButton label="Cancel" cancelRef={cancelRef} />,
      };
    case "checked":
      return checkedFaceOf(view.result, view.tally, args);
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
        return refusedFace(addSlice(EMPTY_TALLY, view.result), args, true);
      }
      return {
        title: "Component kept",
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
        // Refused part way: what an earlier step converted stays converted,
        // showing what it showed, and the component is kept.
        body:
          view.converted > 0 ? (
            <p className="text-sm text-muted-foreground">
              {`${documents(view.converted)} ${view.converted === 1 ? "was" : "were"} turned into plain blocks before that. The component was kept.`}
            </p>
          ) : null,
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
  retry: "check" | "delete",
  /** What the delete had converted when it was refused. */
  converted = 0
): View {
  switch (call.kind) {
    case "conflict":
      return { kind: "someone-else", message: call.message };
    case "forbidden":
      return { kind: "forbidden", converted };
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
    // Each slice answers only its own documents: they are added up, and the
    // next slice asked for from where this one stopped, until the plan is
    // whole or something already read decides the face.
    let tally = EMPTY_TALLY;
    let after: string | null = null;
    for (;;) {
      const answer = await checkComponentDelete(componentId, after);
      if (turn.current !== mine) return;
      if (answer.kind !== "answer") {
        setView(viewOfRefusal(answer, "check"));
        return;
      }
      const result = answer.result;
      // The author's own delete already removed it.
      if (result.run?.yours === true && result.run.step === "deleted") {
        setView({ kind: "deleted" });
        return;
      }
      tally = addSlice(tally, result);
      setView({ kind: "checked", result, tally });
      if (checkedFace(result, tally) !== "counting") return;
      const next = result.plan?.next ?? null;
      if (next === null) {
        // Not whole, with nowhere to read on: doubt is not "unused".
        setView({
          kind: "failed",
          message: "Not every document could be checked. Try again.",
          retry: "check",
        });
        return;
      }
      after = next;
    }
  }, [componentId]);

  const runDelete = useCallback(async (): Promise<void> => {
    turn.current += 1;
    const mine = turn.current;
    setView({ kind: "deleting", result: null });
    let last: ComponentDeleteResult | null = null;
    for (;;) {
      const answer = await stepComponentDelete(componentId);
      // Closed or moved on: the delete pauses here, and resumes when the
      // dialog is opened again.
      if (turn.current !== mine) return;
      if (answer.kind !== "answer") {
        setView(
          viewOfRefusal(answer, "delete", last?.progress?.converted ?? 0)
        );
        return;
      }
      const result = answer.result;
      if (underWay(result)) {
        last = result;
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
        // Its parts may shrink below their content (a grid item's minimum
        // is otherwise its content), so nothing pushes past the dialog.
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg [&>*]:min-w-0"
      >
        {/* Left-aligned at every width: the lists below read from the left. */}
        <AlertDialogHeader className="text-left sm:text-left">
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
