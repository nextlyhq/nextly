"use client";

/**
 * The workflow's moves over the entry list's selection: Submit for review, Assign… and Send back…,
 * never Approve. Each document is moved as the list showed it: every part, with the revision and
 * version its row's review state named (`_review`), so a document changed since is refused rather
 * than moved over content no one saw. The server judges each document on its own and names each
 * refusal, and the list says what moved and why each other did not (`bulkMoveSummary`). Once
 * done, the list and the waiting list are read again.
 *
 * @module components/features/entries/EntryList/useWorkflowBulkMoves
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type JSX } from "react";

import { waitingKeys } from "@admin/hooks/queries/useWaitingForMe";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { entryKeys } from "@admin/services/entryApi";
import {
  assignManyWorkflowParts,
  stepManyWorkflowDocuments,
} from "@admin/services/workflowApi";
import type {
  BulkMoveAnswer,
  ReviewAssignee,
  StepManyDocument,
} from "@admin/types/workflows";

import { StepCommentDialog } from "../review/StepCommentDialog";

import {
  ASSIGNMENTS_PER_REQUEST,
  bulkMoveSteps,
  bulkMoveSummary,
  DOCUMENTS_PER_MOVE,
  inBatches,
  type BulkWorkflowMove,
} from "./bulk-workflow-moves";
import type { CollectionForColumns } from "./EntryTableColumns";
import { rowReviewParts } from "./ReviewCell";
import { rowId, type EntryRow } from "./useEntrySelection";

/** What the last move said: how many moved, and each refusal named. */
export interface BulkMoveResult {
  head: string;
  refusals: string[];
}

/** The moves the bar offers over `selected`, the dialogs they open, and the last move's result. */
export interface WorkflowBulkMoves {
  movesFor: (selected: readonly string[]) =>
    | {
        submit?: () => void;
        assign?: () => void;
        sendBack?: () => void;
        /** Whether a move is on its way: the bar offers no second one until it is answered. */
        pending: boolean;
      }
    | undefined;
  result: BulkMoveResult | null;
  dialogs: JSX.Element;
}

/** A reason as a sentence's end: the summary adds its own full stop. */
const reasonOf = (message: string): string => message.replace(/\.+$/, "");

export function useWorkflowBulkMoves(args: {
  collection: CollectionForColumns;
  /** Whether the reader is offered the moves at all (`useEntryBulkActions`). */
  offered: boolean;
  rows: readonly EntryRow[];
  /** A row's title as the list shows it, for a refusal to name. */
  titleOf: (row: EntryRow | undefined, id: string) => string;
}): WorkflowBulkMoves {
  const { collection, offered, rows, titleOf } = args;
  const queryClient = useQueryClient();
  const me = useCurrentUserId();
  const [result, setResult] = useState<BulkMoveResult | null>(null);
  const [pending, setPending] = useState(false);
  const [sendingBack, setSendingBack] = useState<readonly string[] | null>(
    null
  );
  const [assigning, setAssigning] = useState<readonly string[] | null>(null);
  const steps = bulkMoveSteps(collection.workflow?.steps ?? []);
  // Each row as the list last showed it, kept across pages: a selection carried from an earlier
  // page is moved as that page showed it, not left without what it saw.
  const shownRows = useRef(new Map<string, EntryRow>());
  useEffect(() => {
    for (const row of rows) shownRows.current.set(rowId(row), row);
  }, [rows]);
  const rowOf = (id: string) => shownRows.current.get(id);

  /**
   * Each selected document as a move names it: the parts its row showed the reader, and no
   * other (a language the read withheld is not the reader's to move), each as it was shown.
   */
  const documentsOf = (ids: readonly string[]): StepManyDocument[] =>
    ids.map(id => {
      const shown = rowReviewParts(rowOf(id) ?? {});
      return {
        document: { collection: collection.slug, id },
        parts: shown.map(part => part.part),
        seen: shown.map(part => ({
          part: part.part,
          revision: part.revision,
          version: part.version ?? "",
        })),
      };
    });

  /** Runs one move, says what it did, and reads the lists again. */
  const run = async (
    move: BulkWorkflowMove,
    send: () => Promise<BulkMoveAnswer>
  ) => {
    setPending(true);
    try {
      const answer = await send();
      setResult(
        bulkMoveSummary(move, {
          moved: answer.items.length,
          refused: answer.errors.map(refusal => {
            const id = "id" in refusal ? refusal.id : refusal.single;
            return {
              title: titleOf(rowOf(id), id),
              reason: reasonOf(refusal.message),
            };
          }),
        })
      );
    } catch (reason) {
      setResult({
        head: apiErrorMessage(reason, "The move wasn't made."),
        refusals: [],
      });
    } finally {
      setPending(false);
      setSendingBack(null);
      setAssigning(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: entryKeys.listsByCollection(collection.slug),
        }),
        queryClient.invalidateQueries({ queryKey: waitingKeys.all() }),
      ]);
    }
  };

  const movesFor: WorkflowBulkMoves["movesFor"] = selected => {
    if (!offered || !collection.workflow || selected.length === 0) {
      return undefined;
    }
    const ids = [...selected];
    const submitStep = steps.submit;
    return {
      pending,
      ...(submitStep
        ? {
            submit: () =>
              void run("submit", () =>
                inBatches(documentsOf(ids), DOCUMENTS_PER_MOVE, documents =>
                  stepManyWorkflowDocuments({ step: submitStep, documents })
                )
              ),
          }
        : {}),
      assign: () => setAssigning(ids),
      ...(steps.sendBack ? { sendBack: () => setSendingBack(ids) } : {}),
    };
  };

  /** Each role the selected parts wait for, by id, as the editor offers them. */
  const rolesOf = (ids: readonly string[]) => {
    const roles = new Map<string, string>();
    for (const id of ids) {
      for (const part of rowReviewParts(rowOf(id) ?? {})) {
        if (part.waitingFor?.kind !== "roles") continue;
        for (const role of part.waitingFor.roles) {
          roles.set(role.id, role.name ?? "this role");
        }
      }
    }
    return [...roles];
  };

  const assignTo = (ids: readonly string[], assignee: ReviewAssignee | null) =>
    void run("assign", () =>
      inBatches(
        ids.flatMap(id =>
          rowReviewParts(rowOf(id) ?? {})
            .filter(part => part.stage !== null)
            .map(part => ({
              document: { collection: collection.slug, id },
              part: part.part,
              revision: part.revision,
              assignee,
            }))
        ),
        ASSIGNMENTS_PER_REQUEST,
        assignManyWorkflowParts
      )
    );

  const sendBackStep = steps.sendBack;
  const sendBackLabel =
    collection.workflow?.steps?.find(step => step.name === sendBackStep)
      ?.label ?? "Send back";
  const dialogs = (
    <>
      {sendBackStep ? (
        <StepCommentDialog
          open={sendingBack !== null}
          label={sendBackLabel}
          pending={pending}
          asksForChanges
          onCancel={() => setSendingBack(null)}
          onSend={comment => {
            const ids = sendingBack ?? [];
            void run("sendBack", () =>
              inBatches(documentsOf(ids), DOCUMENTS_PER_MOVE, documents =>
                stepManyWorkflowDocuments({
                  step: sendBackStep,
                  comment,
                  documents,
                })
              )
            );
          }}
        />
      ) : null}
      <Dialog
        open={assigning !== null}
        onOpenChange={next => {
          if (!next && !pending) setAssigning(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign</DialogTitle>
            <DialogDescription>
              Assign the selected documents&apos; parts in review. A part is
              assigned only to someone who may take its next step.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {me === null ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  assignTo(assigning ?? [], { kind: "user", id: me })
                }
              >
                Assign to me
              </Button>
            )}
            {rolesOf(assigning ?? []).map(([id, name]) => (
              <Button
                key={id}
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => assignTo(assigning ?? [], { kind: "role", id })}
              >
                Assign to {name}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => assignTo(assigning ?? [], null)}
            >
              Unassign
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setAssigning(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { movesFor, result, dialogs };
}

/** What the last move did, said where the bar is: its head, then each refusal on a line. */
export function BulkMoveResultNote({
  result,
}: {
  result: BulkMoveResult;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Bulk move result"
      className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <p className="font-medium">{result.head}</p>
      {result.refusals.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {result.refusals.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
