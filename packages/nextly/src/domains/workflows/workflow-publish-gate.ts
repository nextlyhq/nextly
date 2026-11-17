/**
 * The workflow's answer to "may these parts go live now": the publish gate core asks before every
 * publish, whichever door the publish came through.
 *
 * Under a workflow, a part goes live only from a stage that allows publishing with a current
 * approval: one given under the definition attached now, whose digest still matches the content
 * going live (the stage's exempt fields left out). The stage is the part's review state's, or for
 * a part with none, where its content puts it (`partStage`). The decision never reads a status's
 * name. A part already live with nothing pending puts nothing new live, and is let through. An
 * unpublish is never held.
 *
 * "Publish without review" lets a person who holds `publish-without-review-<slug>`, or trusted
 * code, publish without an approval, with a reason that is recorded. An API key and a visitor are
 * refused it, and so is a request with no reason.
 *
 * `judge` is asked on the move's own transaction, after the entry's row is locked: it reads only
 * on that transaction. Its `settle`, once the parts are written, closes each published part's
 * review cycle (its review state removed, the versions workflows pinned for it released, the
 * approval it went live under kept in the history) by a compare-and-set on the revision judged,
 * so a step that lands between the judgement and the write makes the publish fail rather than go
 * live past it. The next working draft then reads as the stage named for after publishing.
 *
 * @module domains/workflows/workflow-publish-gate
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { decidePermission } from "../../auth/access/decide";
import { actorForUser } from "../../auth/access/resolve-actor";
import { webhookActorOf, type RequestActor } from "../../auth/request-actor";
import type {
  PublishCaller,
  PublishGate,
  PublishGateQuestion,
  PublishGateRefusal,
  PublishGateVerdict,
  PublishPart,
} from "../collections/services/publish-gate";
import { recordWriteEvent } from "../content-events/write-event";

import { partExemptFields, stillApproved } from "./approval-digest";
import { partStage, pendingPartsOn } from "./implicit-stage";
import { documentTableOn, shownContentOn } from "./part-versions";
import { workflowAttachedTo, type RegisteredWorkflow } from "./registry";
import {
  ensureReviewStateEventKinds,
  eventParts,
  REVIEW_STATE_EVENT_KINDS,
} from "./review-state-events";
import {
  deletePartReviewStateAt,
  readDocumentReviewStates,
  readReviewState,
  type ReviewDocument,
  type ReviewState,
} from "./review-state-repository";
import { recordStageChanged } from "./stage-changed";
import { allowsPublish, staleRefusal } from "./steps";
import { releasePartPins } from "./workflow-pins";

/** The permission's action, seeded per attached collection and Single. */
const WITHOUT_REVIEW_ACTION = "publish-without-review";

/**
 * The review part a publish part is judged as: a language, or null for the shared part. A document
 * that keeps no translations has one review part, its shared one, whichever languages core names:
 * its languages are not parts of their own, as a step reads them.
 */
const partKey = (part: PublishPart, localized: boolean): string | null =>
  part.kind === "shared" || !localized ? null : part.locale;

/**
 * Each review part the question moves, once, with the first publish part that names it: the one a
 * refusal of it is reported against.
 */
function reviewParts(
  question: PublishGateQuestion,
  localized: boolean
): { key: string | null; part: PublishPart }[] {
  const seen = new Map<string | null, PublishPart>();
  for (const part of question.parts) {
    const key = partKey(part, localized);
    // The shared part is reported as itself where the question names it, rather than as the
    // first language a document with no translations was asked about.
    if (!seen.has(key) || part.kind === "shared") seen.set(key, part);
  }
  return [...seen].map(([key, part]) => ({ key, part }));
}

/** A part named for a person. */
function partName(part: string | null): string {
  return part === null ? "The shared fields" : `The "${part}" language`;
}

/** Whether a part was live before the move, as core read it. */
function wasLive(question: PublishGateQuestion, part: string | null): boolean {
  return part === null
    ? question.live.shared
    : question.live.languages.includes(part);
}

/** The stage named for a person: its label, falling back to its name. */
function stageLabel(registered: RegisteredWorkflow, stage: string): string {
  return (
    registered.workflow.stages.find(candidate => candidate.name === stage)
      ?.label ?? stage
  );
}

/** Who the move counts as, for the record: the actor core passed, else the caller's kind. */
function actorOf(question: PublishGateQuestion): RequestActor {
  if (question.actor) return question.actor;
  const caller: PublishCaller = question.caller;
  switch (caller.kind) {
    case "user":
      return { type: "user", id: caller.userId };
    case "api-key":
      return { type: "apiKey" };
    case "trusted":
    case "visitor":
      return { type: "system" };
  }
}

/** Whether a person holds "Publish without review" on the collection or Single. */
type HoldsWithoutReview = (userId: string) => Promise<boolean>;

/**
 * What a request to publish without review comes to: not asked; let through, with the reason it
 * gave; or refused, with why.
 */
type Bypass =
  | { kind: "not-asked" }
  | { kind: "allowed"; reason: string }
  | { kind: "refused"; message: string };

async function bypassOf(
  question: PublishGateQuestion,
  holds: HoldsWithoutReview
): Promise<Bypass> {
  if (question.withoutReview === undefined) return { kind: "not-asked" };
  const reason = question.withoutReview.reason.trim();
  if (reason === "") {
    return {
      kind: "refused",
      message: "Publishing without review needs a reason.",
    };
  }
  const { caller } = question;
  switch (caller.kind) {
    case "trusted":
      return { kind: "allowed", reason };
    case "user":
      return (await holds(caller.userId))
        ? { kind: "allowed", reason }
        : {
            kind: "refused",
            message: `Publishing without review needs the permission "${WITHOUT_REVIEW_ACTION}-${question.scope.slug}".`,
          };
    case "api-key":
      // An emergency publish is a person's act, and a key may act for an agent.
      return {
        kind: "refused",
        message: "An API key may not publish without review.",
      };
    case "visitor":
      return {
        kind: "refused",
        message: "Only a signed-in person may publish without review.",
      };
  }
}

/** Every part of the question refused with `message`. */
function refuseEvery(
  question: PublishGateQuestion,
  message: string
): PublishGateRefusal[] {
  return question.parts.map(part => ({
    part,
    code: "WITHOUT_REVIEW_REFUSED" as const,
    message,
  }));
}

/**
 * Why a part may not go live, or null where it may: its stage (the review state's, or where its
 * content puts it) must allow publishing, and it must hold an approval given under the definition
 * attached now, whose content is still what goes live (`approvedNow`; undefined where the content
 * was not compared).
 */
function holdReason(
  registered: RegisteredWorkflow,
  part: string | null,
  state: ReviewState | null,
  content: { live: boolean; pending: boolean },
  approvedNow: boolean | undefined
): string | null {
  const stage = partStage(registered.workflow, state, content);
  // Live with nothing pending: the publish puts nothing new live.
  if (stage === null) return null;
  if (!allowsPublish(registered.workflow, stage)) {
    return `${partName(part)} is in "${stageLabel(registered, stage)}", which does not allow publishing.`;
  }
  if (
    state?.approval == null ||
    state.definitionHash !== registered.definitionHash
  ) {
    return `${partName(part)} has no current approval.`;
  }
  if (approvedNow === false) {
    return `${partName(part)} changed since it was approved.`;
  }
  return null;
}

/**
 * Whether the gate judges a Single's publish. Off until Singles take workflow steps: a step on a
 * Single is refused today (`WORKFLOW_SINGLES_NOT_SUPPORTED`), so no Single can hold an approval,
 * and judging one would hold every publish of it. A Single with a workflow attached publishes as
 * one without; turned on, with its tests, once a Single's steps can approve it.
 */
const SINGLES_GOVERNED = false;

/** Whether the gate judges a publish of `scope` at all. */
function governs(scope: PublishGateQuestion["scope"]): boolean {
  return scope.kind === "collection" || SINGLES_GOVERNED;
}

const NOTHING_HELD: PublishGateVerdict = {
  refusals: [],
  settle: () => Promise.resolve(),
};

/** The document a question is about, as review state keys it. */
const documentOf = (question: PublishGateQuestion): ReviewDocument => ({
  scopeKind: question.scope.kind,
  scopeSlug: question.scope.slug,
  entryId: question.entryId,
});

/** One part as `judge` read it: its review state, or none. */
interface JudgedPart {
  part: string | null;
  state: ReviewState | null;
}

/**
 * The early answer, read on the pool before the move locks anything: the stage and the approval
 * as the review states hold them, and "Publish without review" as the caller holds it now. The
 * content is compared with the approval only under the lock, where it cannot change before the
 * write.
 */
async function earlyRefusals(
  adapter: DrizzleAdapter,
  question: PublishGateQuestion
): Promise<readonly PublishGateRefusal[]> {
  const registered = workflowAttachedTo(
    question.scope.kind,
    question.scope.slug
  );
  if (
    !registered ||
    question.direction === "unpublish" ||
    !governs(question.scope)
  ) {
    return [];
  }
  const bypass = await bypassOf(question, async userId =>
    holdsWithoutReview(await actorForUser(userId), question.scope.slug)
  );
  if (bypass.kind === "refused") return refuseEvery(question, bypass.message);
  if (bypass.kind === "allowed") return [];
  const document = documentOf(question);
  const { localized } = await documentTableOn(document);
  const states = await readDocumentReviewStates(adapter, document);
  const refusals: PublishGateRefusal[] = [];
  for (const { key, part } of reviewParts(question, localized)) {
    const state = states.find(candidate => candidate.part === key) ?? null;
    // Whether a live part holds a pending draft is read under the lock; here a live part with no
    // review state is let through, and `judge` decides it.
    const message = holdReason(
      registered,
      key,
      state,
      { live: wasLive(question, key), pending: false },
      undefined
    );
    if (message !== null) {
      refusals.push({ part, code: "NOT_APPROVED", message });
    }
  }
  return refusals;
}

/** Whether `actor` holds "Publish without review" on `slug`. */
function holdsWithoutReview(
  actor: Awaited<ReturnType<typeof actorForUser>>,
  slug: string
): boolean {
  return decidePermission(actor, WITHOUT_REVIEW_ACTION, slug).allowed;
}

/**
 * The verdict on the move's transaction, after the entry's row is locked: every read is on `tx`.
 */
async function judgeOnLock(
  adapter: DrizzleAdapter,
  tx: TransactionContext,
  question: PublishGateQuestion
): Promise<PublishGateVerdict> {
  const registered = workflowAttachedTo(
    question.scope.kind,
    question.scope.slug
  );
  if (
    !registered ||
    question.direction === "unpublish" ||
    !governs(question.scope)
  ) {
    return NOTHING_HELD;
  }
  const executor = tx.getDrizzle();
  const bypass = await bypassOf(question, async userId =>
    holdsWithoutReview(
      await actorForUser(userId, { executor }),
      question.scope.slug
    )
  );
  if (bypass.kind === "refused") {
    return {
      refusals: refuseEvery(question, bypass.message),
      settle: () => Promise.resolve(),
    };
  }
  const document = documentOf(question);
  const table = await documentTableOn(document, executor);
  const states = await readDocumentReviewStates(tx, document);
  const pending = await pendingPartsOn(tx, document);
  const judged: JudgedPart[] = [];
  const refusals: PublishGateRefusal[] = [];
  for (const { key, part } of reviewParts(question, table.localized)) {
    const state = states.find(candidate => candidate.part === key) ?? null;
    judged.push({ part: key, state });
    // Let through without review: its parts are judged only so the move closes their cycles.
    if (bypass.kind === "allowed") continue;
    const approvedNow =
      state?.approval == null
        ? undefined
        : await stillApprovedOn(tx, registered, document, table, key, state);
    const message = holdReason(
      registered,
      key,
      state,
      { live: wasLive(question, key), pending: pending(key) },
      approvedNow
    );
    if (message !== null) {
      refusals.push({ part, code: "NOT_APPROVED", message });
    }
  }
  if (refusals.length > 0) {
    return { refusals, settle: () => Promise.resolve() };
  }
  return {
    refusals: [],
    settle: () => settle(adapter, tx, question, registered, judged, bypass),
  };
}

/**
 * Whether the content a part puts live is still what its approval approved: the part's newest
 * recorded version, as a reviewer is shown it, without the stage's exempt fields. A Single's saves
 * do not withdraw an approval as they write, so this is the check that holds one to its content.
 */
async function stillApprovedOn(
  tx: TransactionContext,
  registered: RegisteredWorkflow,
  document: ReviewDocument,
  table: Awaited<ReturnType<typeof documentTableOn>>,
  part: string | null,
  state: ReviewState
): Promise<boolean> {
  if (state.approval === null) return false;
  const shown = await shownContentOn(tx, document, table, part);
  if (!shown) return false;
  return stillApproved(
    state.approval.digest,
    shown.snapshot,
    document.scopeKind,
    partExemptFields(
      registered.workflow.onEdit.exemptFields,
      part,
      table.translated
    )
  );
}

/**
 * Closes each published part's review cycle on the move's transaction, once its parts are
 * written: a compare-and-set on the revision `judge` read (a part with none must still have
 * none), then the pins released, the stage change recorded for integrations, and the approval it
 * went live under kept in the document's history. A publish without review is recorded with its
 * reason. Any part that moved since it was judged refuses the whole publish.
 */
async function settle(
  adapter: DrizzleAdapter,
  tx: TransactionContext,
  question: PublishGateQuestion,
  registered: RegisteredWorkflow,
  judged: readonly JudgedPart[],
  bypass: Bypass
): Promise<void> {
  const document = documentOf(question);
  const stale: (string | null)[] = [];
  for (const { part, state } of judged) {
    const unchanged =
      state === null
        ? (await readReviewState(tx, { ...document, part })) === null
        : await deletePartReviewStateAt(
            tx,
            { ...document, part },
            state.revision
          );
    if (!unchanged) stale.push(part);
  }
  if (stale.length > 0) throw staleRefusal(stale);

  const actor = actorOf(question);
  const subject = {
    kind: document.scopeKind,
    slug: document.scopeSlug,
    id: document.entryId,
  };
  ensureReviewStateEventKinds();
  for (const { part, state } of judged) {
    if (state === null) continue;
    await releasePartPins(tx, document, part);
    await recordStageChanged(tx, {
      document,
      part,
      from: state.stage,
      to: null,
      cause: "publish",
      approvalWithdrawn: false,
      definitionHash: registered.definitionHash,
      actor: webhookActorOf(actor),
    });
    await recordWriteEvent(
      tx,
      { adapter },
      {
        subject,
        kind: REVIEW_STATE_EVENT_KINDS.published,
        actor,
        parts: eventParts([part]),
        fromState: state.stage,
        definitionHash: registered.definitionHash,
        payload: {
          approval:
            state.approval === null
              ? null
              : {
                  versionNo: state.approval.versionNo,
                  by: state.approval.by,
                  at: state.approval.at.toISOString(),
                },
        },
      }
    );
  }
  if (bypass.kind === "allowed") {
    await recordWriteEvent(
      tx,
      { adapter },
      {
        subject,
        kind: REVIEW_STATE_EVENT_KINDS.publishedWithoutReview,
        actor,
        note: bypass.reason,
        parts: eventParts(judged.map(entry => entry.part)),
        definitionHash: registered.definitionHash,
      }
    );
  }
}

/**
 * The workflow's publish gate, registered as `publishGate`. Collections and Singles with no
 * workflow attached are let through as before.
 *
 * @experimental
 */
export function workflowPublishGate(adapter: DrizzleAdapter): PublishGate {
  return {
    refusals: question => earlyRefusals(adapter, question),
    judge: (tx, question) => judgeOnLock(adapter, tx, question),
  };
}
