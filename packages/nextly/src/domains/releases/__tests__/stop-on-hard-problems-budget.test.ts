/**
 * The early stop, bounded by a caller's own deadline.
 *
 * The release engine's pass hands the early stop an `outOfTime` question so
 * that stopping many releases cannot use up the time it keeps for what is
 * due. Each release whose check is started is judged and, failing, stopped;
 * once the caller is out of time the rest are left scheduled for its next
 * call, and every call judges at least one, so a caller always out of time
 * still advances.
 *
 * Every release here holds one document with no recorded author, a hard
 * problem (`NO_AUTHOR`), and none is due, so each one judged is stopped on
 * its own.
 */
import { describe, expect, it, vi } from "vitest";

import { member } from "../readiness/__tests__/helpers/readiness-fixtures";
import type { ReleaseRow } from "../releases-repository";
import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** A scheduled release holding one authorless document. */
function failing(id: string) {
  return {
    release: {
      id,
      state: "scheduled",
      scheduledAt: LATER,
      revision: 3,
    } as unknown as ReleaseRow,
    members: [member(`${id}-m`, { releaseId: id, createdBy: null })],
  };
}

function service() {
  const blocked: string[] = [];
  const repository = {
    scheduledMembersFor: vi.fn(async () => [
      failing("r1"),
      failing("r2"),
      failing("r3"),
    ]),
    blockReleases: vi.fn(async (entries: readonly { id: string }[]) => {
      blocked.push(...entries.map(entry => entry.id));
      return entries.map(entry => entry.id);
    }),
    liveAuthors: vi.fn(async (ids: string[]) => new Set(ids)),
    findDueReleases: vi.fn(async () => []),
  };
  const deps = {
    repository,
    targets: { declaresLifecycle: async () => true },
    checks: READY_CHECKS,
    logger: { warn: () => {} },
  } as unknown as ReleasesServiceDeps;
  return { svc: new ReleasesService(deps), blocked };
}

const TARGET = {
  scopes: [{ scopeKind: "collection" as const, scopeSlug: "posts" }],
};

describe("stopOnHardProblems with a caller's deadline", () => {
  it("judges and stops every release while the caller has time", async () => {
    const { svc, blocked } = service();
    expect(
      await svc.stopOnHardProblems(TARGET, { outOfTime: () => false })
    ).toEqual(["r1", "r2", "r3"]);
    expect(blocked).toEqual(["r1", "r2", "r3"]);
  });

  it("stops what it judged once the caller is out of time, leaving the rest scheduled", async () => {
    const { svc, blocked } = service();
    let asked = 0;
    // Time runs out after the second release is judged.
    const outOfTime = () => ++asked >= 2;
    expect(await svc.stopOnHardProblems(TARGET, { outOfTime })).toEqual([
      "r1",
      "r2",
    ]);
    expect(blocked).toEqual(["r1", "r2"]);
  });

  it("judges at least one release, so a caller always out of time still advances", async () => {
    const { svc, blocked } = service();
    expect(
      await svc.stopOnHardProblems(TARGET, { outOfTime: () => true })
    ).toEqual(["r1"]);
    expect(blocked).toEqual(["r1"]);
  });

  it("judges every release for an event, which has no deadline", async () => {
    const { svc } = service();
    expect(await svc.stopOnHardProblems(TARGET)).toEqual(["r1", "r2", "r3"]);
  });
});
