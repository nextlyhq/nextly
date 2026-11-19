/**
 * The early stop's plan, grown by a due release outside it, plans each release from its members
 * as the walk that reached it read them.
 *
 * A release can change between two walks of one stop: its revision moves and its members with
 * it. The plan grown by the second walk must keep none of the first walk's members of a release
 * the second walk read again, or a document the release no longer holds joins it to a component
 * it has left, and a stop for one release stops another.
 */
import { describe, expect, it, vi } from "vitest";

import { member } from "../readiness/__tests__/helpers/readiness-fixtures";
import type {
  DrainMemberRow,
  ReleaseMemberRow,
  ReleaseRow,
} from "../releases-repository";
import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const PAST = new Date("2020-01-01T00:00:00Z");
const LATER_PAST = new Date("2020-01-01T01:00:00Z");

function release(id: string, revision: number, at = PAST): ReleaseRow {
  return {
    id,
    state: "scheduled",
    scheduledAt: at,
    revision,
  } as unknown as ReleaseRow;
}

/** A member of `releaseId` on `entryId`; no recorded author is a hard problem. */
function on(
  releaseId: string,
  entryId: string,
  over: Partial<DrainMemberRow> = {}
): DrainMemberRow {
  return {
    ...member(`${releaseId}-${entryId}`, { releaseId, entryId }),
    appliedRevision: null,
    ...over,
  };
}

describe("stopOnHardProblems over a release that changes between its walks", () => {
  it("plans a release read again from its new members alone, so a document it left joins nothing", async () => {
    // First walk, from a: release a holds p (already written, so its problem stops nothing) and
    // x; c holds x. Before b is judged, a drops x and takes q, which b holds too. The second walk,
    // from b, reads a again: a and b are one component, and c is apart.
    let moved = false;
    const releases = () => ({
      a: release("a", moved ? 1 : 0),
      b: release("b", 0, LATER_PAST),
      c: release("c", 0),
    });
    const membersOf = (): DrainMemberRow[] =>
      moved
        ? [
            on("a", "p", { appliedRevision: 0 }),
            on("a", "q"),
            on("b", "q", { createdBy: null }),
            on("c", "x"),
          ]
        : [
            on("a", "p", { appliedRevision: 0, createdBy: null }),
            on("a", "x"),
            on("b", "q", { createdBy: null }),
            on("c", "x"),
          ];
    const blocked: string[][] = [];
    const repository = {
      scheduledMembersFor: vi.fn(
        async (target: {
          documents?: readonly { entryId: string }[];
        }): Promise<{ release: ReleaseRow; members: ReleaseMemberRow[] }[]> => {
          if (!("documents" in target) || target.documents === undefined) {
            // The event: a's member on p, and b's on q.
            const all = membersOf();
            return [
              {
                release: releases().a,
                members: all.filter(m => m.id === "a-p"),
              },
              {
                release: releases().b,
                members: all.filter(m => m.id === "b-q"),
              },
            ];
          }
          const asked = new Set(target.documents.map(d => d.entryId));
          // The second walk starts from q: a has moved by then.
          if (asked.has("q")) moved = true;
          const all = membersOf();
          const now = releases();
          return (["a", "b", "c"] as const).flatMap(id => {
            const naming = all.filter(
              m => m.releaseId === id && asked.has(m.entryId)
            );
            return naming.length === 0
              ? []
              : [{ release: now[id], members: naming }];
          });
        }
      ),
      listMembersOf: vi.fn(async (ids: string[]) =>
        membersOf().filter(m => ids.includes(m.releaseId))
      ),
      blockReleases: vi.fn(async (entries: readonly { id: string }[]) => {
        blocked.push(entries.map(entry => entry.id).sort());
        return entries.map(entry => entry.id);
      }),
      liveAuthors: vi.fn(async (ids: string[]) => new Set(ids)),
      revalidateReleases: vi.fn(async () => {}),
      findDueReleases: vi.fn(async () => []),
    };
    const svc = new ReleasesService({
      repository,
      targets: { declaresLifecycle: async () => true },
      checks: READY_CHECKS,
      logger: { warn: () => {} },
    } as unknown as ReleasesServiceDeps);

    await svc.stopOnHardProblems({
      scopes: [{ scopeKind: "collection", scopeSlug: "posts" }],
    });

    expect(blocked).toEqual([["a", "b"]]);
  });
});
