/**
 * The notice a release's owner is given when it stops.
 *
 * Written by the one transition into `blocked`
 * (`ReleasesRepository.blockReleases`), in its transaction, so whichever path
 * stops a release (the drain, or a hard problem found before the moment) its
 * owner is told, and none can stop one without telling them. Once per
 * occurrence: the occurrence is the revision the release moved to `blocked`
 * at, so one stop seen twice gives one notice and a release stopped again
 * after it was rescheduled gives another.
 *
 * Registered by the releases feature's registration (`register-releases`).
 *
 * @module domains/releases/release-stopped-notice
 * @experimental Until the notices feature is complete.
 */
import { z } from "zod";

import { container } from "../../di/container";
import { hasPermission } from "../../services/lib/permissions";
import { defineNoticeKind } from "../notices/notice-kinds";
import type { VersionsDbApi } from "../versions/db-api";

import { RELEASES_TABLE } from "./release-tables";
import { RELEASES_RESOURCE } from "./releases-resource";

/** What the notice keeps of its release, so it reads after a deletion. */
const stoppedData = z.object({
  title: z.string(),
  /** The instant the release was scheduled for, as an ISO string. */
  scheduledAt: z.string().nullable(),
});

/** @experimental */
export type ReleaseStoppedNoticeData = z.infer<typeof stoppedData>;

/** @experimental */
export const RELEASE_STOPPED_NOTICE =
  defineNoticeKind<ReleaseStoppedNoticeData>({
    key: "releases.stopped",
    subjectType: "release",
    data: stoppedData,
    // The cause is not recorded, and a release is also stopped when it shares
    // documents with a due release that has a problem, so the text names both
    // causes rather than telling every owner to look for a fault of their own.
    render: (data, { subjectGone }) => ({
      title: `“${data.title}” stopped`,
      body: subjectGone
        ? "The release has since been deleted."
        : "It stopped because one of its documents has a problem, or because it shares documents with a release that has one. Open it to see what needs attention, then schedule it again.",
    }),
    // The releases that still exist, each with its page in the admin. One read
    // for a page of notices.
    link: async ids => {
      if (ids.length === 0 || !container.has("adapter")) return new Map();
      const rows = await container
        .get<Pick<VersionsDbApi, "select">>("adapter")
        .select<{ id: string }>(RELEASES_TABLE, {
          columns: ["id"],
          where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
        });
      return new Map(rows.map(row => [row.id, `/admin/releases/${row.id}`]));
    },
    // A person who may no longer read releases stops seeing these, as the
    // releases themselves are hidden from them.
    visible: userId => hasPermission(userId, "read", RELEASES_RESOURCE),
  });
