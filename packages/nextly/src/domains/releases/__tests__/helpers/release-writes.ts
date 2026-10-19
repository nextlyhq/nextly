/**
 * Repository writes for fixtures that are not about the fences.
 *
 * Every membership change and every schedule is fenced: a membership change on
 * the states its caller judged it may land on, a schedule on the release's
 * revision as its caller read it. A suite arranging releases to test something
 * else — a read, a drain, a cache bound — has no judgement to express, so these
 * write against the release as it stands. The fences themselves are tested in
 * `release-revision-fence.integration.test.ts`.
 *
 * @module domains/releases/__tests__/helpers/release-writes
 */
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
  RELEASE_SCHEDULABLE_FROM,
  type ReleaseState,
} from "../../../../schemas/releases/types";
import type { ReleasesRepository } from "../../releases-repository";

/** Every state a membership change can land on, for a caller who may publish. */
export const ANY_EDITABLE_STATE: readonly ReleaseState[] = [
  ...RELEASE_ASSEMBLABLE_FROM,
  ...RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
];

/**
 * Schedule a release from any schedulable state, fenced on the revision it
 * has now. Throws when the release is not there, so a fixture with a wrong id
 * fails where it is wrong rather than as a schedule that silently missed.
 */
export async function scheduleAsItStands(
  repo: ReleasesRepository,
  id: string,
  at: Date,
  timezone: string
): Promise<boolean> {
  const [row] = await repo.findReleases({ ids: [id] });
  if (row === undefined) throw new Error(`no release ${id} to schedule`);
  return repo.scheduleRelease(
    id,
    at,
    timezone,
    RELEASE_SCHEDULABLE_FROM,
    row.revision
  );
}

/**
 * Mark a release published, fenced on the revision and instant it has now,
 * as a drain that planned against it this moment would. Throws when the
 * release is not there or has no instant, for the reason the helper above
 * does.
 */
export async function publishAsItStands(
  repo: ReleasesRepository,
  id: string,
  at: Date
): Promise<boolean> {
  const [row] = await repo.findReleases({ ids: [id] });
  if (row?.scheduledAt == null) {
    throw new Error(`no scheduled release ${id} to publish`);
  }
  return repo.markReleasePublished(id, at, {
    revision: row.revision,
    scheduledAt: row.scheduledAt,
  });
}
