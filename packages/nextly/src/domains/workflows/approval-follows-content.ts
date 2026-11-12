/**
 * An approval covers exactly the content it approved: what happens to it when that content, or
 * the definition it was given under, changes without a step.
 *
 * - A save. Every save that records a version of a document a workflow is attached to asks,
 *   in the save's own transaction, whether each approved part is still as approved: the digest of
 *   the part's content now (`stillApproved`, the stage's exempt fields left out) against the
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
import { z } from "zod";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors";
import { REVIEW_STATES_TABLE } from "../../schemas/review-states";
import {
  contentEventKind,
  registerContentEventKind,
  type ContentEventKind,
} from "../content-events/kinds";
import {
  recordWriteEvent,
  type StatusMove,
  type WriteEventDeps,
} from "../content-events/write-event";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import { lockDocument } from "../versions/history-locks";
import { snapshotRecord } from "../versions/shared-publish-base";
import {
  VersionsRepository,
  type VersionRef,
  type VersionRow,
} from "../versions/versions-repository";
import { statusEventsFor } from "../webhooks/status-events";

import { stillApproved } from "./approval-digest";
import { entersReview } from "./define-workflow";
import { shownVersionOn } from "./part-versions";
import { workflowAttachedTo, type RegisteredWorkflow } from "./registry";
import {
  readDocumentReviewStates,
  readReviewState,
  updateReviewState,
  type ReviewApproval,
  type ReviewDocument,
  type ReviewPart,
  type ReviewState,
  type ReviewStatesDb,
} from "./review-state-repository";
import { sharedValuesOf } from "./shared-values";
import type { Workflow } from "./types";
import {
  enteredReviewSlot,
  pinPart,
  releasePartPins,
  workflowPins,
} from "./workflow-pins";

/**
 * A withdrawal's payload: why the approval went (`edited`, a save changed the approved content;
 * `definition-changed`, a deploy changed the workflow), and, for an edit through an API key, the
 * key's owner.
 */
const withdrawalPayload = z
  .object({
    cause: z.enum(["edited", "definition-changed"]),
    ownerId: z.string().min(1).optional(),
  })
  .strict();

/**
 * The content event kinds an approval withdrawn without a step is recorded as: by an edit, and by
 * a deploy that changed the definition, so history never reads a deploy as an edit. Named with the
 * `workflow-` prefix every workflow kind carries.
 */
const WITHDRAWAL_KINDS = {
  edited: {
    name: "workflow-approval-withdrawn",
    label: "Approval withdrawn: edited by {actor}",
    payload: withdrawalPayload,
  },
  definitionChanged: {
    name: "workflow-approval-withdrawn-by-definition",
    label: "Approval withdrawn: the workflow changed",
    payload: withdrawalPayload,
  },
} as const satisfies Record<string, ContentEventKind>;

/** Registers each withdrawal kind not registered yet; safe on every write. */
function ensureWithdrawalKinds(): void {
  for (const kind of Object.values(WITHDRAWAL_KINDS)) {
    if (!contentEventKind(kind.name)) registerContentEventKind(kind);
  }
}

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
 * The shared values a save wrote in place, when they change what `part` shows: another language
 * than the one written, on a translated document. Null when the part shows only its own version.
 */
function sharedOverlay(
  document: ReviewDocument,
  part: string | null,
  save: RecordedSave,
  saved: VersionRow | undefined
): Record<string, unknown> | null {
  const translated = save.inPlaceTranslated;
  if (part === null || part === save.locale) return null;
  if (translated === null || saved === undefined) return null;
  // The same reading of a snapshot's shared values a step approving the part uses.
  return sharedValuesOf(document, saved.snapshot, translated);
}

/** A part's content now, and the version it is read from. */
interface PartContent {
  snapshot: unknown;
  versionNo: number | null;
}

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
): Promise<PartContent | null> {
  const shown = await shownVersionOn(tx, document, part);
  if (!shown) return null;
  const overlay = sharedOverlay(document, part, save, saved);
  const snapshot =
    overlay === null
      ? shown.snapshot
      : { ...snapshotRecord(shown.snapshot), ...overlay };
  return { snapshot, versionNo: shown.versionNo };
}

/** The owner of the API key `keyId`, read on the save's own transaction. */
async function keyOwner(
  tx: TransactionContext,
  keyId: string
): Promise<string | null> {
  const [row] = await tx.select<{ userId: string }>("api_keys", {
    columns: ["userId"],
    where: { and: [{ column: "id", op: "=", value: keyId }] },
    limit: 1,
  });
  return row?.userId ?? null;
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
    // A key's act counts as its owner's.
    const owner = await keyOwner(tx, actor.id);
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

/** What judging and withdrawing each approved part of one save needs. */
interface SaveWithdrawal {
  tx: TransactionContext;
  save: RecordedSave;
  registered: RegisteredWorkflow;
  /** The version the save recorded, whose shared values other languages may show. */
  saved: VersionRow | undefined;
  accountable: string | null;
  now: Date;
}

/** Whether `content` is still what `approval` named, the stage's exempt fields left out. */
function asApproved(
  c: SaveWithdrawal,
  approval: ReviewApproval,
  content: PartContent | null
): boolean {
  // A part with no recorded version has nothing left that the approval names.
  if (content === null) return false;
  return stillApproved(
    approval.digest,
    content.snapshot,
    entityOf(c.save.document),
    c.registered.workflow.onEdit.exemptFields
  );
}

/**
 * Pins the version a part entered review at, when moving it from `from` to `to` enters review: a
 * withdrawal that returns a part to review opens a cycle at the version it holds now.
 */
async function pinEnteringReview(
  tx: TransactionContext,
  workflow: Workflow,
  part: ReviewPart,
  move: { from: string; to: string; versionNo: number | null | undefined }
): Promise<void> {
  if (!entersReview(workflow, move.from, move.to)) return;
  if (typeof move.versionNo !== "number") return;
  await pinPart(tx, refOf(part), enteredReviewSlot(part.part), move.versionNo);
}

/**
 * Withdraws one part's approval over the revision it was read at, moving it to `onEdit.to` with
 * the editor accountable. False when a step moved it since, having written nothing.
 */
async function withdrawPart(
  c: SaveWithdrawal,
  state: ReviewState,
  content: PartContent | null
): Promise<boolean> {
  const { workflow, definitionHash } = c.registered;
  const written = await updateReviewState(c.tx, state, state.revision, {
    approval: null,
    stage: workflow.onEdit.to,
    enteredAt: c.now,
    definitionHash,
    ...(c.accountable !== null ? { enteredBy: c.accountable } : {}),
  });
  if (!written) return false;
  await pinEnteringReview(c.tx, workflow, state, {
    from: state.stage,
    to: workflow.onEdit.to,
    versionNo: content?.versionNo,
  });
  return true;
}

/**
 * Judges one approved part and withdraws its approval when the content moved off it. A part a
 * step moved while this ran is judged again as it is now; one still moving after a few tries
 * refuses the save, which then keeps nothing.
 */
async function withdrawIfChanged(
  c: SaveWithdrawal,
  first: ReviewState
): Promise<Withdrawn | null> {
  let state: ReviewState | null = first;
  for (let attempt = 1; attempt <= MAX_WITHDRAW_ATTEMPTS; attempt++) {
    if (!state?.approval) return null;
    const content = await contentNow(
      c.tx,
      c.save.document,
      state.part,
      c.save,
      c.saved
    );
    if (asApproved(c, state.approval, content)) return null;
    if (await withdrawPart(c, state, content)) {
      return { part: state.part, from: state.stage };
    }
    state = await readReviewState(c.tx, state);
  }
  throw NextlyError.conflict({
    reason: "state",
    logContext: { refusal: "workflow-withdraw-contended", part: first.part },
  });
}

/** The parts of a document a save could withdraw an approval from: those holding one. */
async function approvedParts(
  tx: TransactionContext,
  document: ReviewDocument
): Promise<ReviewState[]> {
  const db: ReviewStatesDb = tx;
  return (await readDocumentReviewStates(db, document)).filter(
    state => state.approval !== null
  );
}

/**
 * Withdraws each approval a save left behind, in the save's transaction `tx`: see the module.
 * Does nothing for a save that recorded no version, a document no workflow is attached to, or one
 * with no approved part.
 *
 * @experimental
 */
export async function withdrawApprovalsOnSave(
  tx: TransactionContext,
  deps: WriteEventDeps,
  save: RecordedSave
): Promise<void> {
  const { document, versionNo } = save;
  if (versionNo === null) return;
  const registered = workflowAttachedTo(document.scopeKind, document.scopeSlug);
  if (!registered) return;
  const approved = await approvedParts(tx, document);
  if (approved.length === 0) return;
  const { accountable, ownerId } = await accountableFor(tx, save.actor);
  const c: SaveWithdrawal = {
    tx,
    save,
    registered,
    saved: await new VersionsRepository(tx).findByVersionNo(
      refOf(document),
      versionNo
    ),
    accountable,
    now: new Date(),
  };
  const withdrawn: Withdrawn[] = [];
  for (const state of approved) {
    const done = await withdrawIfChanged(c, state);
    if (done) withdrawn.push(done);
  }
  await recordWithdrawals(tx, deps, {
    document,
    withdrawn,
    to: registered.workflow.onEdit.to,
    actor: save.actor,
    personName: save.personName ?? null,
    versionNo,
    payload: editedPayload(ownerId),
    kind: WITHDRAWAL_KINDS.edited,
    definitionHash: registered.definitionHash,
  });
}

/** An edit's withdrawal payload: its cause, and a key's owner where a key saved. */
function editedPayload(ownerId: string | null): Record<string, unknown> {
  return { cause: "edited", ...(ownerId !== null ? { ownerId } : {}) };
}

/** Each part of `group` as the record names it: its languages, and whether the shared part. */
function withdrawnParts(group: readonly Withdrawn[]): {
  locales: string[];
  shared: boolean;
} {
  return {
    locales: group.flatMap(entry => (entry.part === null ? [] : [entry.part])),
    shared: group.some(entry => entry.part === null),
  };
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
    kind: (typeof WITHDRAWAL_KINDS)[keyof typeof WITHDRAWAL_KINDS];
    definitionHash: string;
  }
): Promise<void> {
  if (args.withdrawn.length === 0) return;
  ensureWithdrawalKinds();
  for (const from of new Set(args.withdrawn.map(entry => entry.from))) {
    await recordWriteEvent(tx, deps, {
      subject: {
        kind: args.document.scopeKind,
        slug: args.document.scopeSlug,
        id: args.document.entryId,
      },
      kind: args.kind,
      actor: args.actor,
      personName: args.personName,
      parts: withdrawnParts(
        args.withdrawn.filter(entry => entry.from === from)
      ),
      fromState: from,
      toState: args.to,
      versionNo: args.versionNo,
      payload: args.payload,
      definitionHash: args.definitionHash,
    });
  }
}

/** Whether `move` published its part, by the rule that decides a publish everywhere else. */
function publishes(move: StatusMove, write: { isCreate?: boolean }): boolean {
  if (typeof move.to !== "string") return false;
  return statusEventsFor({
    from: move.from ?? null,
    to: move.to,
    isCreate: write.isCreate === true,
  }).includes("entry.published");
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
  for (const move of moves.filter(candidate => publishes(candidate, write))) {
    if (move.locale === undefined) {
      await workflowPins.releaseAll(tx, ref);
      return;
    }
    await releasePartPins(tx, ref, move.locale);
  }
}

/**
 * The review states of one collection's or Single's documents holding an approval given under
 * another definition than `definitionHash`, read on `db`.
 */
async function approvalsUnderOtherHash(
  db: ReviewStatesDb,
  entity: Pick<ReviewDocument, "scopeKind" | "scopeSlug">,
  definitionHash: string
): Promise<ReviewState[]> {
  const rows = await db.select<{ entryId: string; part: string | null }>(
    REVIEW_STATES_TABLE,
    {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: entity.scopeKind },
          { column: "scopeSlug", op: "=", value: entity.scopeSlug },
          { column: "approvedVersionNo", op: "IS NOT NULL" },
          { column: "definitionHash", op: "!=", value: definitionHash },
        ],
      },
    }
  );
  const found: ReviewState[] = [];
  for (const row of rows) {
    const state = await readReviewState(db, { ...entity, ...row });
    if (state) found.push(state);
  }
  return found;
}

/**
 * The review states of `registered`'s documents holding an approval given under another
 * definition than its current one, read on `db`.
 */
async function approvalsUnderEarlierDefinitions(
  db: ReviewStatesDb,
  registered: RegisteredWorkflow
): Promise<ReviewState[]> {
  const entities = [
    ...registered.collections.map(scopeSlug => ({
      scopeKind: "collection" as const,
      scopeSlug,
    })),
    ...registered.singles.map(scopeSlug => ({
      scopeKind: "single" as const,
      scopeSlug,
    })),
  ];
  const found: ReviewState[] = [];
  for (const entity of entities) {
    found.push(
      ...(await approvalsUnderOtherHash(db, entity, registered.definitionHash))
    );
  }
  return found;
}

/**
 * Withdraws one part's approval given under an earlier definition, in its own transaction `tx`:
 * see {@link withdrawApprovalsUnderEarlierDefinitions}.
 */
async function withdrawUnderDefinition(
  tx: TransactionContext,
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  stale: ReviewState
): Promise<void> {
  const { workflow, definitionHash } = registered;
  // The document's lock first, the order a save takes it in before it writes review state.
  await lockDocument(tx, refOf(stale));
  const state = await readReviewState(tx, stale);
  // Approved again under this definition, or withdrawn, since it was found: nothing left to do.
  if (!state?.approval || state.definitionHash === definitionHash) return;
  const to = workflow.approvalsWithdrawnTo;
  const written = await updateReviewState(tx, state, state.revision, {
    approval: null,
    stage: to,
    enteredAt: new Date(),
    definitionHash,
  });
  if (!written) return;
  const shown = await shownVersionOn(tx, state, state.part);
  await pinEnteringReview(tx, workflow, state, {
    from: state.stage,
    to,
    versionNo: shown?.versionNo,
  });
  await recordWithdrawals(
    tx,
    { adapter },
    {
      document: state,
      withdrawn: [{ part: state.part, from: state.stage }],
      to,
      actor: { type: "system" },
      personName: null,
      versionNo: state.approval.versionNo,
      payload: { cause: "definition-changed" },
      kind: WITHDRAWAL_KINDS.definitionChanged,
      definitionHash,
    }
  );
}

/** Whether the database holds the review states table: none before its migrations. */
async function reviewStatesTableExists(
  adapter: DrizzleAdapter
): Promise<boolean> {
  const live = await liveColumnNames(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    [REVIEW_STATES_TABLE]
  );
  return live.has(REVIEW_STATES_TABLE);
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
  if (!(await reviewStatesTableExists(adapter))) return;
  for (const registered of withdrawing) {
    // Read on a transaction of its own: the review states surface is a transaction's.
    const found = await adapter.transaction(tx =>
      approvalsUnderEarlierDefinitions(tx, registered)
    );
    for (const stale of found) {
      await adapter.transaction(tx =>
        withdrawUnderDefinition(tx, adapter, registered, stale)
      );
    }
  }
}
