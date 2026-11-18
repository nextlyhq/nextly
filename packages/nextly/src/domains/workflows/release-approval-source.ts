/**
 * "Not approved": workflows' hard check on a release, and the hold that keeps the release's run,
 * and a reader shown a due release, to the same answer.
 *
 * A member going live is held when any part its run would publish is not approved by the publish
 * gate's own per-part decision (`partApproved`), asked of each part and never decided here. The
 * parts a run publishes are those a document-wide publish moves: each language kept with a status
 * of its own that holds something (stored, or a pending draft), and the shared part; a part with
 * nothing to publish (live, with no pending draft) is not asked about, as `partStage` puts it in
 * no stage. A member coming down, and a document no workflow is attached to, is never held.
 *
 * What it reads, for a batch: each member's review states (one indexed read per member); each
 * scope's stored statuses and pending drafts once for the whole batch; for a Single's part that is
 * otherwise approved, the content it shows, since a Single's save leaves an approval in place; and
 * for a member held, whom its parts wait for. Liveness is the stored status, not a due release's
 * projection of it: the run judges a document as it is stored before it writes it, and the
 * projection asks this hold, so reading through it would ask the hold again.
 *
 * A finding names, for each held part, its stage and whom it waits for, as the review read names
 * them (`partsWaitingFor`): `user:<id>` for a person, `roles:<id>,<id>` for anyone holding one of
 * those roles (a role assigned or a stage's default reviewer, else the roles that may take the
 * stage's primary step), and `none` for a stage with no step out of it. Parts are named by language, and the shared part as
 * `shared`, as a publish's refusal names them.
 *
 * @module domains/workflows/release-approval-source
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { readCompanionLocaleStatusAllOf } from "../i18n/companion-join";
import { appLocalization } from "../i18n/configured-locales";
import { buildCompanionSchema } from "../i18n/runtime/companion-io";
import { resolveCompanionReadiness } from "../i18n/runtime/companion-readiness";
import { languageIsLive } from "../i18n/runtime/language-lifecycle";
import type {
  GoingLiveDocument,
  GoingLiveHold,
} from "../releases/going-live-hold";
import {
  defineReleaseCheckSource,
  type ReleaseCheckFinding,
  type ReleaseCheckSource,
} from "../releases/readiness/check-sources";
import { VersionsRepository } from "../versions/versions-repository";

import { entityOf, partStage } from "./implicit-stage";
import { partApproved } from "./part-approval";
import { documentTableOn, type DocumentTable } from "./part-versions";
import { partsWaitingFor, type PartWaitingFor } from "./part-waits-for";
import { workflowAttachedTo, type RegisteredWorkflow } from "./registry";
import { keepReleaseRecheck } from "./release-recheck-signal";
import {
  readDocumentReviewStates,
  type ReviewDocument,
  type ReviewState,
} from "./review-state-repository";
import { stillApprovedOn } from "./workflow-publish-gate";

/** The one code this check reports. */
type NotApproved = "NOT_APPROVED";

/** How a finding names the shared part, as a publish's refusal names it. */
const SHARED_PART = "shared";

/** A part a member going live would publish that its workflow holds back. */
interface HeldPart {
  part: string | null;
  stage: string;
  state: ReviewState | null;
}

/** A document held back, with the parts held and the workflow they are held by. */
interface HeldDocument {
  registered: RegisteredWorkflow;
  document: ReviewDocument;
  parts: HeldPart[];
}

/** What one part of a document holds: whether it is live, and whether a draft is pending. */
interface PartContent {
  live: boolean;
  pending: boolean;
}

/** One scope's stored statuses and pending drafts, read once for every document of a batch. */
interface ScopeContent {
  /** The languages a publish moves one by one: none where the scope publishes a document whole. */
  languages: readonly string[];
  /** What the part holds, or null for a language with nothing stored or pending. */
  of(entryId: string, part: string | null): PartContent | null;
  /**
   * Where a Single's content is read from, for comparing a part's content with its approval; null
   * for a collection, whose save withdraws an approval its content moved off.
   */
  table: DocumentTable | null;
}

/**
 * One scope's stored statuses and pending drafts for `entryIds`, or null when its collection or
 * Single is gone. Three reads at most, whatever the number of documents: the main rows, the
 * languages' own statuses, and the pending drafts.
 */
async function scopeContent(
  adapter: DrizzleAdapter,
  scope: Pick<ReviewDocument, "scopeKind" | "scopeSlug">,
  entryIds: readonly string[]
): Promise<ScopeContent | null> {
  const entity = await entityOf(scope);
  if (entity === null) return null;
  const localization = appLocalization();
  const ids = [...new Set(entryIds)];
  const mainRows = await adapter.select<{ id: unknown; status?: unknown }>(
    entity.tableName,
    {
      columns: ["id", "status"],
      where: { and: [{ column: "id", op: "IN", value: ids }] },
    }
  );
  const mainStatus = new Map(mainRows.map(row => [String(row.id), row.status]));
  // Languages move one by one only where the entity keeps a status per language, as a
  // document-wide publish asks the publish gate about them.
  const companion =
    entity.localized === true && localization
      ? buildCompanionSchema({
          slug: entity.slug,
          tableName: entity.tableName,
          fields: entity.fields as { name: string; type: string }[],
          dialect: adapter.dialect,
          status: true,
        })
      : null;
  const perLanguage = companion?.hasStatus === true;
  let ownStatuses = new Map<string, Map<string, string | null>>();
  if (companion !== null && perLanguage) {
    const readiness = await resolveCompanionReadiness(adapter, {
      companionTableName: companion.companionTableName,
      mainTableName: entity.tableName,
      localizedColumns: companion.localizedFields.map(field => field.column),
    });
    ownStatuses = await readCompanionLocaleStatusAllOf(
      adapter.getDrizzle<
        Parameters<typeof readCompanionLocaleStatusAllOf>[0]
      >(),
      companion.table,
      ids,
      readiness
    );
  }
  const pendingByEntry = await new VersionsRepository(
    adapter
  ).findPendingChangeLocales(scope.scopeKind, scope.scopeSlug, ids);
  return {
    table: scope.scopeKind === "single" ? await documentTableOn(scope) : null,
    languages: perLanguage
      ? (localization?.locales.map(locale => locale.code) ?? [])
      : [],
    of(entryId, part) {
      const pending = pendingByEntry.get(entryId) ?? new Set<string | null>();
      const own = ownStatuses.get(entryId);
      if (part !== null && own?.has(part) !== true && !pending.has(part)) {
        return null;
      }
      // The decision every path reads liveness by, over the statuses as stored.
      const live =
        entity.status !== true ||
        languageIsLive({
          mainStatus: mainStatus.get(entryId),
          ownStatus: part === null ? null : (own?.get(part) ?? null),
          locale: part,
          defaultLocale: localization?.defaultLocale ?? null,
          perLanguageStatus: perLanguage,
        });
      // A draft carries the shared values it changes, so the shared part is pending while any
      // part is, as `pendingPartsOn` reads it.
      return {
        live,
        pending: part === null ? pending.size > 0 : pending.has(part),
      };
    },
  };
}

/** Whom a part waits for, as a finding spells it: see the module. */
function waitsForOf(waiting: PartWaitingFor | null): string {
  if (waiting === null) return "none";
  if (waiting.kind === "user") return `user:${waiting.id}`;
  return `roles:${waiting.roles.map(role => role.id).join(",")}`;
}

/** The parts of one document going live that its workflow holds back, in publishing order. */
async function heldPartsOf(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  document: ReviewDocument,
  content: ScopeContent
): Promise<HeldPart[]> {
  const states = await readDocumentReviewStates(adapter, document);
  const held: HeldPart[] = [];
  for (const part of [...content.languages, null]) {
    const holds = content.of(document.entryId, part);
    if (holds === null) continue;
    const state = states.find(candidate => candidate.part === part) ?? null;
    const stage = partStage(registered.workflow, state, holds);
    if (stage === null) continue;
    const table = content.table;
    const approved = await partApproved({
      registered,
      document,
      part,
      state,
      content: holds,
      // A Single's save leaves an approval in place, so its content is compared with it.
      ...(table !== null && state !== null
        ? {
            approvedNow: () =>
              stillApprovedOn(
                adapter,
                registered,
                document,
                table,
                part,
                state,
                "pool"
              ),
          }
        : {}),
    });
    if (!approved) held.push({ part, stage, state });
  }
  return held;
}

/** The documents of one scope with a workflow attached, among those asked about. */
interface AttachedScope {
  registered: RegisteredWorkflow;
  scope: Pick<ReviewDocument, "scopeKind" | "scopeSlug">;
  documents: GoingLiveDocument[];
}

/** `documents` grouped by scope, keeping only those of a collection or Single with a workflow. */
function attachedScopes(
  documents: readonly GoingLiveDocument[]
): AttachedScope[] {
  const byScope = new Map<string, AttachedScope>();
  for (const document of documents) {
    const { scopeKind, scopeSlug } = document;
    // A page, and a document no workflow governs, are never held.
    if (scopeKind !== "collection" && scopeKind !== "single") continue;
    const registered = workflowAttachedTo(scopeKind, scopeSlug);
    if (registered === undefined) continue;
    const key = JSON.stringify([scopeKind, scopeSlug]);
    const entry = byScope.get(key) ?? {
      registered,
      scope: { scopeKind, scopeSlug },
      documents: [],
    };
    entry.documents.push(document);
    byScope.set(key, entry);
  }
  return [...byScope.values()];
}

/**
 * Of `documents` going live, those their workflow holds back now, each with the parts held, by
 * the document's key. The one answer the check, the run and a reader's projection all give.
 */
async function heldForApproval(
  adapter: DrizzleAdapter,
  documents: readonly GoingLiveDocument[]
): Promise<Map<string, HeldDocument>> {
  const held = new Map<string, HeldDocument>();
  for (const { registered, scope, documents: inScope } of attachedScopes(
    documents
  )) {
    const content = await scopeContent(
      adapter,
      scope,
      inScope.map(document => document.entryId)
    );
    // A collection or Single gone from the registry has no documents to publish; the release
    // checks name it as removed.
    if (content === null) continue;
    for (const document of inScope) {
      const reviewed = { ...scope, entryId: document.entryId };
      const parts = await heldPartsOf(adapter, registered, reviewed, content);
      if (parts.length > 0) {
        held.set(document.id, { registered, document: reviewed, parts });
      }
    }
  }
  return held;
}

/**
 * A finding's detail: each held part, its stage and whom it waits for, in step. Who a part waits
 * for is read here, for a finding alone: the run and a reader's projection need only whether a
 * document is held.
 */
async function detailOf(adapter: DrizzleAdapter, held: HeldDocument) {
  const waiting = await partsWaitingFor(
    adapter,
    held.registered,
    held.document.scopeSlug,
    held.parts.map(entry => ({
      stage: entry.stage,
      assignee: entry.state?.assignee ?? null,
    }))
  );
  return {
    parts: held.parts.map(entry => entry.part ?? SHARED_PART),
    stages: held.parts.map(entry => entry.stage),
    waitsFor: held.parts.map((_entry, index) =>
      waitsForOf(waiting[index] ?? null)
    ),
  };
}

/**
 * The check: a finding for each member going live that its workflow holds back. Its signal keeps
 * the function the release checks hand it, which workflows call where an approval goes without a
 * save (`release-recheck-signal`).
 */
export function releaseApprovalSource(
  adapter: DrizzleAdapter
): ReleaseCheckSource<NotApproved> {
  return defineReleaseCheckSource({
    key: "workflows.approval",
    severity: "hard",
    codes: ["NOT_APPROVED"],
    async check(batch) {
      // A member coming down is never blocked.
      const goingLive = batch.filter(member => member.action === "publish");
      const held = await heldForApproval(adapter, goingLive);
      const findings: ReleaseCheckFinding<NotApproved>[] = [];
      for (const member of goingLive) {
        const document = held.get(member.id);
        if (document === undefined) continue;
        findings.push({
          memberId: member.id,
          code: "NOT_APPROVED",
          detail: await detailOf(adapter, document),
        });
      }
      return findings;
    },
    signal: keepReleaseRecheck,
  });
}

/** The hold the release's run and a reader's projection ask: the same answer as the check. */
export function releaseApprovalHold(adapter: DrizzleAdapter): GoingLiveHold {
  return {
    held: async documents =>
      new Set((await heldForApproval(adapter, documents)).keys()),
  };
}
