/**
 * `upcomingWithAttention`: the Upcoming tab and the Needs attention tab's
 * counts, read together as the dashboard's Upcoming releases card shows them,
 * by the tabs' own queries and against one clock reading.
 */
import { describe, expect, it, vi } from "vitest";

import { RELEASE_ATTENTION_REASONS } from "../release-tabs";
import type { ReleasePageQuery } from "../releases-repository";
import {
  ReleasesService,
  type ReleaseAuthority,
  type ReleasesServiceDeps,
} from "../services/releases-service";

const READER = { userId: "u1" };

/** A service whose reader may read releases, over a repository of spies. */
function service(holds: ReleaseAuthority[] = ["read"]) {
  const repository = {
    findReleasePage: vi.fn(async (_query: ReleasePageQuery) => ({
      rows: [],
      total: 0,
    })),
    countReleases: vi.fn(async (query: ReleasePageQuery) =>
      query.reason === "stopped" ? 2 : 3
    ),
  };
  const deps = {
    repository,
    canManageReleases: vi.fn(async (_id: string, authority: ReleaseAuthority) =>
      holds.includes(authority)
    ),
  } as unknown as ReleasesServiceDeps;
  return { svc: new ReleasesService(deps), repository };
}

describe("the Upcoming tab and its attention counts, read together", () => {
  it("asks the tabs' own queries, every one at the same instant", async () => {
    // 🔴 One clock reading for all three: read one after the other, a release crossing the
    // overdue cutoff between them would be in the rows and the overdue count, or in neither.
    const { svc, repository } = service();
    const answer = await svc.upcomingWithAttention(
      { limit: 4, attention: true },
      READER
    );

    const [page] = repository.findReleasePage.mock.calls[0]!;
    expect(page).toMatchObject({
      tab: "upcoming",
      order: "soonest",
      offset: 0,
      limit: 4,
    });
    const counted = repository.countReleases.mock.calls.map(([query]) => query);
    expect(counted.map(query => [query.tab, query.reason])).toEqual(
      RELEASE_ATTENTION_REASONS.map(reason => ["attention", reason])
    );
    expect(page.now).toBeInstanceOf(Date);
    for (const query of counted) expect(query.now).toBe(page.now);
    expect(answer.attention).toEqual({ stopped: 2, overdue: 3 });
  });

  it("counts nothing when the attention counts are not asked for", async () => {
    const { svc, repository } = service();
    const answer = await svc.upcomingWithAttention(
      { limit: 4, attention: false },
      READER
    );
    expect(repository.countReleases).not.toHaveBeenCalled();
    expect(answer.attention).toEqual({});
  });

  it("is refused, reading nothing, for a reader who may not read releases", async () => {
    const { svc, repository } = service([]);
    await expect(
      svc.upcomingWithAttention({ limit: 4, attention: true }, READER)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.findReleasePage).not.toHaveBeenCalled();
    expect(repository.countReleases).not.toHaveBeenCalled();
  });
});
