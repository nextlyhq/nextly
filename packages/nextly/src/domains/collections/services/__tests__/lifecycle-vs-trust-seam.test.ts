/**
 * Trust and draft-ness are decided by DIFFERENT rules, and the two must not
 * drift back together.
 *
 * `trustsTarget` answers *may this caller read this target's rows* —
 * `overrideAccess`, narrowed per collection by the caller's `trusted` set.
 * `widensLifecycle` answers *may it see the ones that are not published yet* —
 * true only for a trusted caller that has NOT bounded itself.
 *
 * They coincide for every caller except the one this task exists for: a public,
 * pre-rendering route that trusts a collection so its PUBLISHED content can be
 * shown, and must still never pull that collection's pending edits into a
 * static artifact.
 *
 * Asserted on the source because the behavioural difference is invisible to the
 * unit harness: the adapter double resolves at `where()` without exposing the
 * predicate, so a lifecycle filter that was computed and then applied to the
 * wrong branch produces the same rows either way. A test that cannot observe
 * the mechanism cannot protect it, and the honest alternative to a test that
 * passes for the wrong reason is one that reads the decision directly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SERVICE = join(__dirname, "..", "collection-relationship-service.ts");

/** Each `resolveStatusFilter({ ... })` call, with its arguments. */
function statusFilterCalls(): string[] {
  const source = readFileSync(SERVICE, "utf8");
  return [...source.matchAll(/resolveStatusFilter\(\{[\s\S]*?\n\s*\}\)/g)].map(
    match => match[0]
  );
}

describe("the lifecycle decision is separate from the trust decision", () => {
  it("is exercised — the service resolves a status filter at all", () => {
    // Without this the assertion below passes against an empty list, which is
    // the shape of a guard reporting success because it found nothing.
    expect(statusFilterCalls().length).toBeGreaterThanOrEqual(2);
  });

  it("never decides the lifecycle from the trust predicate", () => {
    const offenders = statusFilterCalls().filter(call =>
      /overrideAccess:\s*trustsTarget\(/.test(call)
    );

    expect(
      offenders,
      "a status filter resolved from `trustsTarget` grants unpublished rows " +
        "for every collection the caller trusts. Trusting a collection says " +
        "its PUBLISHED content may be shown, not its pending edits. Use " +
        "`widensLifecycle(access)`."
    ).toEqual([]);
  });

  it("decides every lifecycle filter from widensLifecycle", () => {
    const missing = statusFilterCalls().filter(
      call => !/overrideAccess:\s*widensLifecycle\(access\)/.test(call)
    );

    expect(
      missing,
      "every `resolveStatusFilter` on this path must take its override from " +
        "`widensLifecycle`, or the row filter and the companion filter can " +
        "disagree — and a draft row whose published translation satisfies the " +
        "rule is admitted by the half that was left behind."
    ).toEqual([]);
  });
});
