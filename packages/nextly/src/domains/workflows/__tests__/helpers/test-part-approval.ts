/**
 * A stand-in for the per-part decision (`partApproval`) where a release holds a Single.
 *
 * The publish gate does not judge a Single yet: a Single's steps are not offered, so none can be
 * approved, and the gate lets every Single through. A release of a Single is therefore never held
 * by the real decision, and the cases about how a release stops for a Single register this one,
 * which judges a Single's part as the gate judges a collection's: a stage that allows publishing,
 * an approval given under the definition attached now, and, since a Single's save leaves an
 * approval in place, a digest that still names the content the part shows (its newest recorded
 * version; for the shared part, the newest of any part). Every other part is held.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../../../di/container";
import type { VersionsDbApi } from "../../../versions/db-api";
import { VersionsRepository } from "../../../versions/versions-repository";
import { stillApproved } from "../../approval-digest";
import type { PartApproval, PartApprovalQuestion } from "../../part-approval";

/** The snapshot a reviewer is shown of the part now, or undefined for a part never saved. */
async function shownSnapshot(
  adapter: DrizzleAdapter,
  question: PartApprovalQuestion
): Promise<unknown> {
  const repo = new VersionsRepository(adapter as unknown as VersionsDbApi);
  const newest = await repo.newestVersionNoByLocale(
    question.document,
    question.part === null ? [null, "en", "es"] : [question.part]
  );
  if (newest.size === 0) return undefined;
  return (
    await repo.findByVersionNo(question.document, Math.max(...newest.values()))
  )?.snapshot;
}

/** Whether the part holds a current approval of what it shows, as described above. */
async function approvedNow(
  adapter: DrizzleAdapter,
  question: PartApprovalQuestion
): Promise<boolean> {
  const { registered, state } = question;
  const stage = registered.workflow.stages.find(
    candidate => candidate.name === question.stage
  );
  if (stage?.allowsPublish !== true) return false;
  if (state === null || state.approval === null) return false;
  if (state.definitionHash !== registered.definitionHash) return false;
  const shown = await shownSnapshot(adapter, question);
  return (
    shown !== undefined &&
    stillApproved(
      state.approval.digest,
      shown,
      question.document.scopeKind,
      registered.workflow.onEdit.exemptFields
    )
  );
}

/** Registers the stand-in on the booted instance's container, reading through `adapter`. */
export function registerTestPartApproval(adapter: DrizzleAdapter): void {
  container.registerSingleton<PartApproval>("partApproval", () => ({
    approved: question => approvedNow(adapter, question),
  }));
}
