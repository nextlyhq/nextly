/**
 * A write of several documents names one release throughout.
 *
 * The step locks, fences and counts the release it names, so the release it
 * creates and each document it writes must name that same release: a row
 * naming another would land in a release nobody locked or counted. A write
 * whose ids disagree is refused before its transaction opens, with nothing
 * written.
 */
import { describe, expect, it, vi } from "vitest";

import {
  draftReleaseRow,
  ReleasesRepository,
  type NewReleaseMember,
  type ReleasesDbApi,
} from "../releases-repository";

/** A repository whose database fails the test if a transaction opens. */
function repositoryWithNoTransaction() {
  const transaction = vi.fn(() => {
    throw new Error("a transaction opened");
  });
  const repository = new ReleasesRepository({
    transaction,
  } as unknown as ReleasesDbApi);
  return { transaction, repository };
}

function member(releaseId: string, entryId = "e1"): NewReleaseMember {
  return {
    releaseId,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    locale: null,
    action: "publish",
  };
}

describe("ReleasesRepository.addMembers", () => {
  it("refuses a document naming another release, before its transaction opens", async () => {
    const { transaction, repository } = repositoryWithNoTransaction();

    await expect(
      repository.addMembers({
        releaseId: "r1",
        members: [member("r1"), member("r2", "e2")],
        allowedStates: ["draft"],
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a release to create that is not the release it names", async () => {
    const { transaction, repository } = repositoryWithNoTransaction();
    const create = draftReleaseRow({ title: "Launch" });

    await expect(
      repository.addMembers({
        releaseId: "r1",
        create,
        members: [member("r1")],
        allowedStates: ["draft"],
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    expect(transaction).not.toHaveBeenCalled();
  });
});
