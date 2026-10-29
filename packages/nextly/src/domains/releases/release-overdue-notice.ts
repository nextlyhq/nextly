/**
 * The notice a release's owner is given when it misses its time.
 *
 * A scheduled release is overdue once it is still not run some minutes past
 * its moment (`RELEASE_OVERDUE_AFTER_MS`). Two paths record this notice:
 *
 * - the drain's own pass, before it runs anything, for each release that is
 *   overdue as the pass starts (`ReleasesRepository.recordOverdueReleases`);
 * - the transition to published, for a release that ran that late
 *   (`ReleasesRepository.markReleasesPublished`), which catches a runner that
 *   caught up late without a pass having seen the release overdue first.
 *
 * Both key the notice on the missed instant, so the owner is told once for
 * each time a release missed, whichever path sees it first, and again only if
 * it is rescheduled and misses its new time.
 *
 * Registered by the releases feature's registration (`register-releases`).
 *
 * @module domains/releases/release-overdue-notice
 * @experimental Until the notices feature is complete.
 */
import { z } from "zod";

import { defineNoticeKind } from "../notices/notice-kinds";

import {
  mayReadReleaseNotices,
  releaseNoticeLinks,
} from "./release-notice-links";
import { RELEASE_OVERDUE_AFTER_MS } from "./release-tabs";

/** What the notice keeps of its release, so it reads after a deletion. */
const overdueData = z.object({
  title: z.string(),
  /** The instant the release was scheduled for, as an ISO string. */
  scheduledAt: z.string(),
  /** The zone it was scheduled in, named, or `null` where none was given. */
  timezone: z.string().nullable(),
  /** When it ran, as an ISO string, or `null` while it has not. */
  ranAt: z.string().nullable(),
});

/** @experimental */
export type ReleaseOverdueNoticeData = z.infer<typeof overdueData>;

/** How long past its moment a release is overdue, in the words a notice says. */
const OVERDUE_AFTER_WORDS = `${RELEASE_OVERDUE_AFTER_MS / 60_000} minutes`;

/** @experimental */
export const RELEASE_OVERDUE_NOTICE =
  defineNoticeKind<ReleaseOverdueNoticeData>({
    key: "releases.overdue",
    subjectType: "release",
    data: overdueData,
    // Said as what happened by the time it was recorded: not run yet, or run
    // late. A release runs when the site's jobs trigger runs, so the cause is
    // almost always a trigger that stopped or runs too seldom, and the text
    // says where to look.
    render: (data, { subjectGone }) => {
      const gone = "The release has since been deleted.";
      if (data.ranAt === null) {
        return {
          title: `“${data.title}” missed its time`,
          body: subjectGone
            ? gone
            : `It is more than ${OVERDUE_AFTER_WORDS} past its time and hasn't run. Releases run when the site's jobs trigger runs, so check that it is scheduled, or open the release and publish it now.`,
        };
      }
      return {
        title: `“${data.title}” ran late`,
        body: subjectGone
          ? gone
          : `It ran more than ${OVERDUE_AFTER_WORDS} after its time. Releases run when the site's jobs trigger runs, so check that it runs often enough.`,
      };
    },
    // Where it leads, and to whom it shows, as every release notice.
    link: releaseNoticeLinks,
    visible: mayReadReleaseNotices,
  });
