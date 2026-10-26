/**
 * The "is there content" check against a real instance: how many counts it
 * runs at once, and what it says when they are too slow to answer.
 *
 * `reader-content.test.ts` asks the pool directly, with a count the test
 * controls. What only a booted instance can show is that the check the
 * `content:empty` condition takes really is that pool: that its counts are the
 * reader's guarded Direct API counts, and that the bound and the budget hold
 * for them.
 *
 * SQLite only: the bound and the budget are the host's, not the database's.
 *
 * @module domains/widgets/__tests__/content-check-bound.integration.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTHORIZATION_CONCURRENCY } from "../../../auth/entity-read-access";
import { defineCollection, text } from "../../../config";
import { requireNextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { evaluateConditions } from "../conditions";
import { onboardingProgress } from "../onboarding";
import { conditionProbe } from "../condition-probe";
import { CONTENT_CHECK_BUDGET_MS } from "../reader-content";

/** An admin who may read every collection here. */
const admin: ReadCaller = { user: { id: "admin-1", roles: ["admin"] } };

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** An instance with `n` empty collections, every one readable, published as sources. */
async function bootWith(n: number): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: Array.from({ length: n }, (_, i) =>
      defineCollection({
        slug: `empty_${i}`,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      })
    ),
  });
  current = t;
  // As `POST /api/dashboard/query` does first: publish the collection sources from the live
  // registry, which is what the check walks.
  await refreshCollectionSources();
  return t;
}

async function contentEmpty(): Promise<boolean> {
  const verdicts = await evaluateConditions(new Set(["content:empty"]), admin);
  return verdicts.get("content:empty") === true;
}

describe("the content check, booted", () => {
  it(`counts 50 empty collections at most ${AUTHORIZATION_CONCURRENCY} at a time, and finds them empty`, async () => {
    await bootWith(50);
    const nextly = requireNextly();
    const real = nextly.count.bind(nextly);
    let inFlight = 0;
    let most = 0;
    const counted = vi.spyOn(nextly, "count").mockImplementation(async args => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      try {
        // Held a moment, so counts that could overlap do: a pool that ran them one at a time
        // would still show 1 here, and an unbounded one 50.
        await new Promise(resolve => setTimeout(resolve, 10));
        return await real(args);
      } finally {
        inFlight -= 1;
      }
    });

    expect(await contentEmpty()).toBe(true);
    expect(counted).toHaveBeenCalledTimes(50);
    expect(most).toBe(AUTHORIZATION_CONCURRENCY);
    // Answered in time, setup is known and the first-entry step is offered,
    // still open: the half the case below must differ from.
    const progress = await onboardingProgress(conditionProbe(admin));
    expect(progress.unknown).toBe(false);
    expect(progress.steps.find(step => step.id === "entry")?.complete).toBe(
      false
    );
  });

  it('says "unknown" rather than "empty" when the counts outlast the budget', async () => {
    await bootWith(3);
    // Counts that never answer, as a database stuck behind a lock would.
    vi.spyOn(requireNextly(), "count").mockImplementation(
      () => new Promise(() => {})
    );

    const started = Date.now();
    // Not empty: the check does not know, and not knowing must not offer a reader with content
    // the empty-install cards. The case above, on the same kind of install, shows the must-differ
    // half: answered in time, it IS empty.
    expect(await contentEmpty()).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      CONTENT_CHECK_BUDGET_MS - 50
    );
    // And the first-entry step is not ticked on a guess. A step whose check
    // could not finish is not offered at all, since that check is also what
    // decides whether the reader could finish it, and the answer says setup is
    // not known, which keeps the card offered.
    const progress = await onboardingProgress(conditionProbe(admin));
    expect(progress.unknown).toBe(true);
    expect(progress.steps.map(step => step.id)).not.toContain("entry");
  }, 20_000);
});
