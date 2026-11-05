/**
 * An approval covers exactly the content it approved: what happens to it when that content, or
 * the definition it was given under, changes without a step.
 *
 * - A save. Every save that records a version of a document a workflow is attached to asks,
 *   in the save's own transaction, whether each approved part is still as approved: the digest of
 *   the part's content now (`approvalDigest`, the stage's exempt fields left out) against the
 *   approval's. A part that differs loses its approval and moves to `onEdit.to`, the editor
 *   becoming the person accountable for that stage, and one `workflow-approval-withdrawn` event
 *   per stage the parts left names the editor as the save's own history event does. A save that
 *   changed nothing records no version and so asks nothing.
 * - A deploy. A boot that registers a workflow whose definition hash moved withdraws the
 *   approvals given under the earlier one, unless the definition keeps them, and moves each such
 *   part to `approvalsWithdrawnTo`, recorded as the system's act.
 * - A publish closes a part's review cycle, releasing the versions workflows pinned for it.
 *
 * What a part's content is, is what a reviewer is shown of it: its newest recorded version
 * (`shownVersionOn`), the version an approval is given against. A save written in place on a
 * translated document changes every language's view of the fields they share, so each other
 * language's content is its own newest version with the shared values the save wrote.
 *
 * @module domains/workflows/approval-follows-content
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors";
import { REVIEW_STATES_TABLE } from "../../schemas/review-states";
import {
  recordWriteEvent,
  type StatusMove,
  type WriteEventDeps,
} from "../content-events/write-event";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import { lockDocument } from "../versions/history-locks";
import { snapshotRecord } from "../versions/shared-publish-base";
import { documentSystemKeys } from "../versions/snapshot-system-keys";
import {
  VersionsRepository,
  type VersionRef,
  type VersionRow,
} from "../versions/versions-repository";
import { statusEventsFor } from "../webhooks/status-events";

import { approvalDigest } from "./approval-digest";
import { entersReview } from "./define-workflow";
import { shownVersionOn } from "./part-versions";
import { workflowAttachedTo, type RegisteredWorkflow } from "./registry";
import {
  readDocumentReviewStates,
  readReviewState,
  updateReviewState,
  type ReviewDocument,
  type ReviewPart,
  type ReviewState,
  type ReviewStatesDb,
} from "./review-state-repository";
import {
  ensureWorkflowContentEventKinds,
  WORKFLOW_CONTENT_EVENT_KINDS,
} from "./steps";
import {
  enteredReviewSlot,
  pinPart,
  releasePartPins,
  workflowPins,
} from "./workflow-pins";

/** How often a withdrawal is tried again over a review state a step moved meanwhile. */
const MAX_WITHDRAW_ATTEMPTS = 3;

/**
 * A save that recorded a version, as its write path knows it.
 *
 * @experimental
 */
export interface RecordedSave {
  document: ReviewDocument;
  /** The version the save recorded; null when it changed nothing and recorded none. */
  versionNo: number | null;
  /** The language the version is recorded under; null for none. */
  locale: string | null;
  /** Who saved, as the write path resolved it for the save's history. */
  actor: RequestActor;
  personName?: string | null;
  /**
   * The document's translated fields, when the save wrote in place on a translated document:
   * then every other language shows the shared values it wrote. Null for a held save, which
   * changes only its own language's pending change, and for a document without translations.
   */
  inPlaceTranslated: readonly string[] | null;
}

/** The record a part's ref and a document's ref are read with. */
function refOf(document: ReviewDocument): VersionRef {
  return {
    scopeKind: document.scopeKind,
    scopeSlug: document.scopeSlug,
    entryId: document.entryId,
  };
}

const entityOf = (document: ReviewDocument) =>
  document.scopeKind === "single"
    ? ("single" as const)
    : ("collection" as const);

/**
 * A part's content now: its newest recorded version, and for another language than the one a
 * save wrote in place, that version with the shared values the save wrote over it. Null for a part
 * with no recorded version.
 */
async function contentNow(
  tx: TransactionContext,
  document: ReviewDocument,
  part: string | null,
  save: RecordedSave,
  saved: VersionRow | undefined
): Promise<{ snapshot: unknown; versionNo: number | null } | null> {
  const shown = await shownVersionOn(tx, document, part);
  if (!shown) return null;
  const overlaid =
    part !== null &&
    part !== save.locale &&
    save.inPlaceTranslated !== null &&
    saved !== undefined;
  if (!overlaid)
    return { snapshot: shown.snapshot, versionNo: shown.versionNo };
  const translated = new Set(save.inPlaceTranslated);
  const system = documentSystemKeys(entityOf(document));
  const shared = Object.entries(snapshotRecord(saved.snapshot)).filter(
    ([key]) => !translated.has(key) && !system.has(key)
  );
  return {
    snapshot: {
      ...snapshotRecord(shown.snapshot),
      ...Object.fromEntries(shared),
    },
    versionNo: shown.versionNo,
  };
}

/** Whom a save counts as for the stage it moves a part to, and a key's owner for its event. */
async function accountableFor(
  tx: TransactionContext,
  actor: RequestActor
): Promise<{ accountable: string | null; ownerId: string | null }> {
  if (actor.type === "user" && actor.id) {
    return { accountable: actor.id, ownerId: null };
  }
  if (actor.type === "apiKey" && actor.id) {
    // A key's act counts as its owner's, read on the save's own transaction.
    const [row] = await tx.select<{ userId: string }>("api_keys", {
      columns: ["userId"],
      where: { and: [{ column: "id", op: "=", value: actor.id }] },
      limit: 1,
    });
    const owner = row?.userId ?? null;
    return { accountable: owner, ownerId: owner };
  }
  // Trusted code and a plugin-defined person are no staff user: the part keeps the accountable
  // person it had, as a move with no actor does.
  return { accountable: null, ownerId: null };
}

/** One part a save or a deploy withdrew the approval of. */
interface Withdrawn {
  part: string | null;
  from: string;
}

/**
 * Withdraws each approval a save left behind, in the save's transaction `tx`: see the module.
 * Does nothing for a save that recorded no version, a document no workflow is attached to, or one
 * with no approved part. A part a step moved while this ran is judged again; one still moving
 * after a few tries refuses the save, which then keeps nothing.
 *
 * @experimental
 */
export async function withdrawApprovalsOnSave(
  tx: TransactionContext,
  deps: WriteEventDeps,
  save: RecordedSave
): Promise<void> {
  if (save.versionNo === null) return;
  const registered = workflowAttachedTo(
    save.document.scopeKind,
    save.document.scopeSlug
  );
  if (!registered) return;
  const db: ReviewStatesDb = tx;
  const approved = (await readDocumentReviewStates(db, save.document)).filter(
    state => state.approval !== null
  );
  if (approved.length === 0) return;

  const { workflow, definitionHash } = registered;
  const saved = await new VersionsRepository(tx).findByVersionNo(
    refOf(save.document),
    save.versionNo
  );
  const { accountable, ownerId } = await accountableFor(tx, save.actor);
  const now = new Date();
  const withdrawn: Withdrawn[] = [];
  for (const first of approved) {
    let state: ReviewState | null = first;
    for (let attempt = 1; ; attempt++) {
      if (!state?.approval) break;
      const content = await contentNow(
        tx,
        save.document,
        state.part,
        save,
        saved
      );
      // A part with no recorded version has nothing left that the approval names.
      if (
        content !== null &&
        approvalDigest(
          content.snapshot,
          entityOf(save.document),
          workflow.onEdit.exemptFields
        ) === state.approval.digest
      ) {
        break;
      }
      const part: ReviewPart = { ...save.document, part: state.part };
      const written = await updateReviewState(db, part, state.revision, {
        approval: null,
        stage: workflow.onEdit.to,
        enteredAt: now,
        definitionHash,
        ...(accountable !== null ? { enteredBy: accountable } : {}),
      });
      if (written) {
        // An edit that returns the part to review opens a cycle at the version it holds now.
        if (
          entersReview(workflow, state.stage, workflow.onEdit.to) &&
          typeof content?.versionNo === "number"
        ) {
          await pinPart(
            tx,
            refOf(save.document),
            enteredReviewSlot(state.part),
            content.versionNo
          );
        }
        withdrawn.push({ part: state.part, from: state.stage });
        break;
      }
      if (attempt >= MAX_WITHDRAW_ATTEMPTS) {
        throw NextlyError.conflict({
          reason: "state",
          logContext: {
            refusal: "workflow-withdraw-contended",
            part: state.part,
          },
        });
      }
      // A step moved the part since it was read: judge it as it is now.
      state = await readReviewState(db, part);
    }
  }
  await recordWithdrawals(tx, deps, {
    document: save.document,
    withdrawn,
    to: workflow.onEdit.to,
    actor: save.actor,
    personName: save.personName ?? null,
    versionNo: save.versionNo,
    payload: {
      cause: "edited",
      ...(ownerId !== null ? { ownerId } : {}),
    },
    kind: WORKFLOW_CONTENT_EVENT_KINDS.approvalWithdrawn,
    definitionHash,
  });
}

/** One event per stage the withdrawn parts left, on `tx`. */
async function recordWithdrawals(
  tx: TransactionContext,
  deps: WriteEventDeps,
  args: {
    document: ReviewDocument;
    withdrawn: readonly Withdrawn[];
    to: string;
    actor: RequestActor;
    personName: string | null;
    versionNo: number | null;
    payload: Record<string, unknown>;
    kind: (typeof WORKFLOW_CONTENT_EVENT_KINDS)[
      | "approvalWithdrawn"
      | "approvalWithdrawnByDefinition"];
    definitionHash: string;
  }
): Promise<void> {
  if (args.withdrawn.length === 0) return;
  ensureWorkflowContentEventKinds();
  for (const from of [...new Set(args.withdrawn.map(entry => entry.from))]) {
    const group = args.withdrawn.filter(entry => entry.from === from);
    await recordWriteEvent(tx, deps, {
      subject: {
        kind: args.document.scopeKind,
        slug: args.document.scopeSlug,
        id: args.document.entryId,
      },
      kind: args.kind,
      actor: args.actor,
      personName: args.personName,
      parts: {
        locales: group.flatMap(entry =>
          entry.part === null ? [] : [entry.part]
        ),
        shared: group.some(entry => entry.part === null),
      },
      fromState: from,
      toState: args.to,
      versionNo: args.versionNo,
      payload: args.payload,
      definitionHash: args.definitionHash,
    });
  }
}

/**
 * Releases what workflows pinned for each part a write published, on the write's transaction:
 * a publish closes the part's review cycle. A language's publish releases that language's slots;
 * the document's own status published releases every part's. Decided by the rule that decides a
 * publish everywhere else (`statusEventsFor`), so history and these pins never disagree.
 *
 * @experimental
 */
export async function releaseWorkflowPinsOnPublish(
  tx: TransactionContext,
  document: ReviewDocument,
  write: { isCreate?: boolean },
  moves: readonly StatusMove[]
): Promise<void> {
  if (!workflowAttachedTo(document.scopeKind, document.scopeSlug)) return;
  const ref = refOf(document);
  for (const move of moves) {
    if (typeof move.to !== "string") continue;
    const published = statusEventsFor({
      from: move.from ?? null,
      to: move.to,
      isCreate: write.isCreate === true,
    }).includes("entry.published");
    if (!published) continue;
    if (move.locale === undefined) {
      await workflowPins.releaseAll(tx, ref);
      return;
    }
    await releasePartPins(tx, ref, move.locale);
  }
}

/**
 * The review states of `registered`'s documents holding an approval given under another
 * definition than its current one, read on `db`.
 */
async function approvalsUnderEarlierDefinitions(
  db: ReviewStatesDb,
  registered: RegisteredWorkflow
): Promise<ReviewState[]> {
  const found: ReviewState[] = [];
  const targets = [
    ...registered.collections.map(slug => ["collection", slug] as const),
    ...registered.singles.map(slug => ["single", slug] as const),
  ];
  for (const [scopeKind, scopeSlug] of targets) {
    const rows = await db.select<{
      entryId: string;
      part: string | null;
    }>(REVIEW_STATES_TABLE, {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: scopeKind },
          { column: "scopeSlug", op: "=", value: scopeSlug },
          { column: "approvedVersionNo", op: "IS NOT NULL" },
          {
            column: "definitionHash",
            op: "!=",
            value: registered.definitionHash,
          },
        ],
      },
    });
    for (const row of rows) {
      const state = await readReviewState(db, {
        scopeKind,
        scopeSlug,
        entryId: row.entryId,
        part: row.part,
      });
      if (state) found.push(state);
    }
  }
  return found;
}

/**
 * Withdraws, at boot, the approvals given under an earlier definition of each registered
 * workflow that does not keep them, each part in a transaction of its own: the approval is
 * cleared, the part moves to `approvalsWithdrawnTo` under the current definition hash, keeping
 * the person accountable it had, and a `workflow-approval-withdrawn-by-definition` event records
 * it as the system's act. A workflow that keeps approvals keeps them as they are. Nothing is read
 * on a database the review states table is not on yet (before its migrations), which holds none.
 *
 * @experimental
 */
export async function withdrawApprovalsUnderEarlierDefinitions(
  adapter: DrizzleAdapter,
  workflows: Iterable<RegisteredWorkflow>
): Promise<void> {
  const withdrawing = [...workflows].filter(
    registered => !registered.workflow.keepApprovals
  );
  if (withdrawing.length === 0) return;
  const live = await liveColumnNames(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    [REVIEW_STATES_TABLE]
  );
  if (!live.has(REVIEW_STATES_TABLE)) return;
  for (const registered of withdrawing) {
    const { workflow, definitionHash } = registered;
    // Read on a transaction of its own: the review states surface is a transaction's.
    const found = await adapter.transaction(tx =>
      approvalsUnderEarlierDefinitions(tx, registered)
    );
    for (const stale of found) {
      await adapter.transaction(async tx => {
        const document: ReviewDocument = {
          scopeKind: stale.scopeKind,
          scopeSlug: stale.scopeSlug,
          entryId: stale.entryId,
        };
        // The document's lock first, the order a save takes it in before it writes review state.
        await lockDocument(tx, refOf(document));
        const state = await readReviewState(tx, {
          ...document,
          part: stale.part,
        });
        // Approved again, or withdrawn, since it was found: nothing left to do.
        if (!state?.approval || state.definitionHash === definitionHash) return;
        const written = await updateReviewState(tx, state, state.revision, {
          approval: null,
          stage: workflow.approvalsWithdrawnTo,
          enteredAt: new Date(),
          definitionHash,
        });
        if (!written) return;
        if (
          entersReview(workflow, state.stage, workflow.approvalsWithdrawnTo)
        ) {
          const shown = await shownVersionOn(tx, document, state.part);
          if (typeof shown?.versionNo === "number") {
            await pinPart(
              tx,
              refOf(document),
              enteredReviewSlot(state.part),
              shown.versionNo
            );
          }
        }
        await recordWithdrawals(
          tx,
          { adapter },
          {
            document,
            withdrawn: [{ part: state.part, from: state.stage }],
            to: workflow.approvalsWithdrawnTo,
            actor: { type: "system" },
            personName: null,
            versionNo: state.approval.versionNo,
            payload: { cause: "definition-changed" },
            kind: WORKFLOW_CONTENT_EVENT_KINDS.approvalWithdrawnByDefinition,
            definitionHash,
          }
        );
      });
    }
  }
}
