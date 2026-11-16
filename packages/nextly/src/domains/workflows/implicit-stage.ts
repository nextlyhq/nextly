/**
 * Where a part of a document stands in its workflow: the one rule every step and assignment reads
 * a part's stage by.
 *
 * - A part with a review state is in its stage, unless the workflow no longer has that stage:
 *   then it reads as the first stage, and waits as stranded (`stranded-stages`).
 * - A part with none stands where its content puts it (`implicitStage`): a part with nothing
 *   unpublished has no stage, since published content stays live and has no review to open; a
 *   part that is not live starts at the first stage; a live part's working draft starts at the
 *   stage the definition names for after a publish. So attaching a workflow to a collection with
 *   documents starts each unpublished part at the first stage, lazily, and a draft begun after a
 *   discard starts where one begun after a publish would.
 *
 * Whether a part is live is the versions domain's answer (`readPartIsLive`), read on the pool
 * before a step's transaction opens; whether it holds unpublished changes is the working-draft
 * shape (`findPendingChangeLocales`), read on the transaction. A publish or a discard between the
 * two moves the document's version, which a step's compare-and-set refuses as stale.
 *
 * @module domains/workflows/implicit-stage
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { container } from "../../di/container";
import type { CollectionRegistryService } from "../collections/services/collection-registry-service";
import { appLocalization } from "../i18n/configured-locales";
import type { SingleRegistryService } from "../singles/services/single-registry-service";
import { readPartIsLive } from "../versions/part-liveness";
import { VersionsRepository } from "../versions/versions-repository";

import type { ReviewDocument, ReviewState } from "./review-state-repository";
import type { Workflow } from "./types";

/** What a part's content says of it: whether it is live, and whether a draft is pending. */
interface PartContent {
  live: boolean;
  pending: boolean;
}

/** Where a part with no review state stands: see the module. Null for no stage at all. */
function implicitStage(
  workflow: Workflow,
  content: PartContent
): string | null {
  if (!content.live) return workflow.firstStage;
  return content.pending ? workflow.afterPublish : null;
}

/**
 * The stage a part is in: its review state's, read as the first stage when the workflow no longer
 * has it, and otherwise where its content puts it. Null for a part with nothing to review.
 *
 * @experimental
 */
export function partStage(
  workflow: Workflow,
  state: Pick<ReviewState, "stage"> | null,
  content: PartContent
): string | null {
  if (state === null) return implicitStage(workflow, content);
  const known = workflow.stages.some(stage => stage.name === state.stage);
  return known ? state.stage : workflow.firstStage;
}

/** The registry record a document's liveness is read from, or null when it is gone. */
async function entityOf(document: ReviewDocument) {
  return document.scopeKind === "single"
    ? container
        .get<SingleRegistryService>("singleRegistryService")
        .getSingleBySlug(document.scopeSlug)
    : container
        .get<CollectionRegistryService>("collectionRegistryService")
        .getCollectionBySlug(document.scopeSlug);
}

/**
 * Whether each of `parts` of a document is live, read on the pool before a transaction opens. A
 * document whose collection or Single is gone is live nowhere.
 *
 * @experimental
 */
export async function livePartsOf(
  adapter: DrizzleAdapter,
  document: ReviewDocument,
  parts: readonly (string | null)[]
): Promise<ReadonlyMap<string | null, boolean>> {
  const entity = await entityOf(document);
  const live = new Map<string | null, boolean>();
  for (const part of parts) {
    live.set(
      part,
      entity !== null &&
        (await readPartIsLive({
          adapter,
          scopeKind: document.scopeKind,
          entity,
          entryId: document.entryId,
          part,
          defaultLocale: appLocalization()?.defaultLocale ?? null,
        }))
    );
  }
  return live;
}

/**
 * Which parts of a document hold changes not yet published, read on `tx`: a language with its own
 * working draft, and the shared part while any part holds one, since a draft carries the shared
 * values it changes.
 *
 * @experimental
 */
export async function pendingPartsOn(
  tx: TransactionContext,
  document: ReviewDocument
): Promise<(part: string | null) => boolean> {
  const byEntry = await new VersionsRepository(tx).findPendingChangeLocales(
    document.scopeKind,
    document.scopeSlug,
    [document.entryId]
  );
  const pending = byEntry.get(document.entryId) ?? new Set<string | null>();
  return part => (part === null ? pending.size > 0 : pending.has(part));
}
