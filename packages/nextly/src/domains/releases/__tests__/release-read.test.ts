/**
 * The one place a read decides what releases say about the documents it holds.
 *
 * Two properties, and neither is visible in the answers:
 *
 *   1. When the cheap check says nothing can be due, the repository is never
 *      asked. A helper that queried anyway would return exactly the same
 *      effects, so the only thing separating the two is that the call did not
 *      happen.
 *   2. The lookup is batched. A per-row implementation is correct and
 *      quadratic on a listing, and the call count is what keeps it out.
 *
 * @module domains/releases/__tests__/release-read.test
 */
import { describe, it, expect, vi } from "vitest";

import type { DocumentRef } from "../releases-repository";
import type { DueMember } from "../resolve-release-effect";
import { resolveReleaseEffects } from "../release-read";

const NOW = new Date("2026-06-01T12:00:00.000Z");

const ref = (entryId: string, locale: string | null = null): DocumentRef => ({
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId,
  locale,
});

const member = (
  over: Partial<DueMember> & { memberId: string }
): DueMember => ({
  releaseId: `r-${over.memberId}`,
  action: "publish",
  scheduledAt: new Date("2026-05-01T00:00:00.000Z"),
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  ...over,
});

/** A cheap check that answers without a database, as the real one does. */
const cacheSaying = (due: boolean) => ({
  mayHaveDue: vi.fn<(now: Date) => Promise<boolean>>().mockResolvedValue(due),
});

const repositoryReturning = (grouped: Map<string, DueMember[]>) => ({
  findDueMembersFor: vi
    .fn<(refs: DocumentRef[], now: Date) => Promise<Map<string, DueMember[]>>>()
    .mockResolvedValue(grouped),
});

describe("resolveReleaseEffects", () => {
  it("never asks the repository when the cheap check rules it out", async () => {
    const cache = cacheSaying(false);
    const repository = repositoryReturning(new Map());

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a"), ref("b")],
      now: NOW,
    });

    // The answers are identical either way; the absent call is the property.
    expect(repository.findDueMembersFor).not.toHaveBeenCalled();
    expect(effects.for(ref("a")).effect).toBe("none");
  });

  it("asks the cheap check before deciding anything", async () => {
    // A positive control for the test above: without this, a helper that
    // consulted neither collaborator would satisfy it.
    const cache = cacheSaying(false);
    const repository = repositoryReturning(new Map());

    await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a")],
      now: NOW,
    });

    expect(cache.mayHaveDue).toHaveBeenCalledTimes(1);
    expect(cache.mayHaveDue).toHaveBeenCalledWith(NOW);
  });

  it("asks nothing at all for an empty result set", async () => {
    const cache = cacheSaying(true);
    const repository = repositoryReturning(new Map());

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [],
      now: NOW,
    });

    expect(cache.mayHaveDue).not.toHaveBeenCalled();
    expect(repository.findDueMembersFor).not.toHaveBeenCalled();
    expect(effects.for(ref("a")).effect).toBe("none");
  });

  it("answers for a whole result set in ONE repository call", async () => {
    // A per-row lookup is the failure mode: correct, and quadratic on a
    // listing. Asserting the count is what keeps it from creeping back.
    const refs = Array.from({ length: 25 }, (_, i) => ref(`e${i}`));
    const cache = cacheSaying(true);
    const repository = repositoryReturning(new Map());

    await resolveReleaseEffects({ cache, repository, refs, now: NOW });

    expect(repository.findDueMembersFor).toHaveBeenCalledTimes(1);
    expect(repository.findDueMembersFor.mock.calls[0]?.[0]).toHaveLength(25);
  });

  it("reports the effect the members resolve to, per document", async () => {
    const cache = cacheSaying(true);
    const repository = repositoryReturning(
      new Map([
        ["collection:posts:a:", [member({ memberId: "m1" })]],
        [
          "collection:posts:b:",
          [member({ memberId: "m2", action: "unpublish" })],
        ],
      ])
    );

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a"), ref("b"), ref("c")],
      now: NOW,
    });

    expect(effects.for(ref("a"))).toEqual({
      effect: "publish",
      memberId: "m1",
      releaseId: "r-m1",
    });
    expect(effects.for(ref("b")).effect).toBe("unpublish");
    // A document nothing scheduled is not a special case; it is just no members.
    expect(effects.for(ref("c")).effect).toBe("none");
  });

  it("applies the total ordering rather than the first member returned", async () => {
    // The flagship pair: live on the 1st, down on the 20th. From the 21st both
    // are due and the later must win, whichever order the driver returned.
    const cache = cacheSaying(true);
    const publish = member({
      memberId: "m1",
      action: "publish",
      scheduledAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const unpublish = member({
      memberId: "m2",
      action: "unpublish",
      scheduledAt: new Date("2026-05-20T00:00:00.000Z"),
    });
    const repository = repositoryReturning(
      new Map([["collection:posts:a:", [publish, unpublish]]])
    );

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a")],
      now: NOW,
    });

    expect(effects.for(ref("a")).effect).toBe("unpublish");
  });

  it("keeps two locales of one document apart", async () => {
    // The key carries the locale, so a localized document scheduled in one
    // language must not answer for another. Collapsing them would publish a
    // language nobody scheduled.
    const cache = cacheSaying(true);
    const repository = repositoryReturning(
      new Map([["collection:posts:a:fr", [member({ memberId: "m1" })]]])
    );

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a", "fr"), ref("a", "en")],
      now: NOW,
    });

    expect(effects.for(ref("a", "fr")).effect).toBe("publish");
    expect(effects.for(ref("a", "en")).effect).toBe("none");
  });

  it("ignores a member whose instant has not arrived", async () => {
    // The cheap check answers for the whole deployment, so a read can reach
    // here with members that are scheduled but not yet due.
    const cache = cacheSaying(true);
    const repository = repositoryReturning(
      new Map([
        [
          "collection:posts:a:",
          [
            member({
              memberId: "m1",
              scheduledAt: new Date("2026-07-01T00:00:00.000Z"),
            }),
          ],
        ],
      ])
    );

    const effects = await resolveReleaseEffects({
      cache,
      repository,
      refs: [ref("a")],
      now: NOW,
    });

    expect(effects.for(ref("a")).effect).toBe("none");
  });
});
