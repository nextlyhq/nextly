/**
 * How a part's pair is found from the server's baselines: what each query
 * asks, in what order, and what the answers come to. Each decision is a plain
 * function the review hooks only wire to queries.
 */
import { describe, expect, it } from "vitest";

import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

import {
  approvedBaselineOf,
  baselineAnswerOf,
  baselineTargetOf,
  languagePlanOf,
  pairWhereOf,
  publishedBaselineOf,
  serverPairOf,
  type BaselineAnswer,
} from "../server-pair";

/** A refusal the server names on `baseline`, as the API client throws it. */
function refusal(message: string): unknown {
  return Object.assign(new Error("Validation failed."), {
    status: 400,
    code: "VALIDATION_ERROR",
    data: { errors: [{ path: "baseline", code: "NO_BASELINE", message }] },
  });
}

const answer = (over: Partial<BaselineAnswer> = {}): BaselineAnswer => ({
  pair: undefined,
  refusal: undefined,
  failed: false,
  ...over,
});

const part = (over: Partial<PartReview>): PartReview =>
  ({ part: "en", approval: null, ...over }) as PartReview;

function version(versionNo: number, locale: string | null): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale,
    sourceVersionNo: null,
    createdBy: null,
    author: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
  };
}

describe("pairWhereOf", () => {
  it("pairs the shared part as the server's shared part, a language in itself", () => {
    expect(pairWhereOf(part({ part: null }))).toEqual({ part: "shared" });
    expect(pairWhereOf(part({ part: "fr" }))).toEqual({ locale: "fr" });
    expect(pairWhereOf(undefined)).toEqual({ locale: undefined });
  });
});

describe("languagePlanOf", () => {
  it("plans a language from its list, and nothing for the shared part or while reading", () => {
    const listed = [version(7, "en"), version(5, "en")];
    expect(languagePlanOf(part({ part: "en" }), listed)).toEqual({
      kind: "server",
      to: 7,
    });
    expect(languagePlanOf(part({ part: null }), listed)).toBeUndefined();
    expect(languagePlanOf(part({ part: "en" }), undefined)).toBeUndefined();
    expect(languagePlanOf(undefined, listed)).toBeUndefined();
  });
});

describe("baselineTargetOf", () => {
  it("names the version under review and where to pair, and nothing it was not given", () => {
    expect(
      baselineTargetOf({ kind: "server", to: 11 }, { part: "shared" })
    ).toEqual({ to: 11, part: "shared" });
    expect(
      baselineTargetOf({ kind: "server", to: undefined }, { locale: "fr" })
    ).toEqual({ locale: "fr" });
    expect(baselineTargetOf({ kind: "unchanged", to: 4 }, {})).toEqual({});
  });
});

describe("the baselines asked, in order", () => {
  it("asks since approved first, and only where the plan asks the server", () => {
    expect(approvedBaselineOf({ kind: "server", to: 7 })).toBe(
      "since-approved"
    );
    expect(approvedBaselineOf({ kind: "unchanged", to: 7 })).toBeNull();
    expect(approvedBaselineOf(undefined)).toBeNull();
  });

  it("asks published only once the server says there is no approval", () => {
    const plan = { kind: "server", to: 7 } as const;
    expect(
      publishedBaselineOf(plan, answer({ refusal: "Never approved." }))
    ).toBe("published");
    expect(publishedBaselineOf(plan, answer())).toBeNull();
    expect(
      publishedBaselineOf(plan, answer({ pair: { from: 3, to: 7 } }))
    ).toBeNull();
    expect(publishedBaselineOf(plan, answer({ failed: true }))).toBeNull();
    expect(
      publishedBaselineOf(
        { kind: "none" },
        answer({ refusal: "Never approved." })
      )
    ).toBeNull();
  });
});

describe("baselineAnswerOf", () => {
  it("keeps the pair alone, without the comparison's fields", () => {
    expect(
      baselineAnswerOf({
        data: { from: 3, to: 7, fields: [] } as { from: number; to: number },
        isError: false,
      })
    ).toEqual({ pair: { from: 3, to: 7 }, refusal: undefined, failed: false });
  });

  it("reads a refusal on the baseline as an answer, any other error as a failure", () => {
    expect(
      baselineAnswerOf({ isError: true, error: refusal("Never approved.") })
    ).toEqual({ pair: undefined, refusal: "Never approved.", failed: false });
    expect(
      baselineAnswerOf({ isError: true, error: new Error("offline") })
    ).toEqual({ pair: undefined, refusal: undefined, failed: true });
  });
});

describe("serverPairOf", () => {
  const plan = { kind: "server", to: 11 } as const;

  it("compares since the approval where the server had one, as the shared part where it is", () => {
    expect(
      serverPairOf(plan, answer({ pair: { from: 7, to: 11 } }), answer(), {
        part: "shared",
      })
    ).toEqual({
      pair: {
        kind: "pair",
        from: 7,
        to: 11,
        since: "approved",
        seededBy: "since-approved",
        part: "shared",
      },
      isError: false,
    });
  });

  it("compares since what is published where the part was never approved", () => {
    expect(
      serverPairOf(
        plan,
        answer({ refusal: "Never approved." }),
        answer({ pair: { from: 2, to: 11 } }),
        { locale: "fr" }
      )
    ).toEqual({
      pair: {
        kind: "pair",
        from: 2,
        to: 11,
        since: "published",
        seededBy: "published",
      },
      isError: false,
    });
  });

  it("shows the version whole with the server's reason when refused twice", () => {
    const refusedTwice = (to: number | undefined) =>
      serverPairOf(
        { kind: "server", to },
        answer({ refusal: "Never approved." }),
        answer({ refusal: "Nothing published." }),
        {}
      );
    expect(refusedTwice(11)).toEqual({
      pair: { kind: "first", to: 11, reason: "Nothing published." },
      isError: false,
    });
    expect(refusedTwice(undefined).pair).toEqual({ kind: "none" });
  });

  it("waits while an answer is outstanding, and fails on a failed query", () => {
    expect(serverPairOf(plan, answer(), answer(), {})).toEqual({
      pair: undefined,
      isError: false,
    });
    expect(
      serverPairOf(plan, answer({ failed: true }), answer(), {}).isError
    ).toBe(true);
    expect(
      serverPairOf(
        plan,
        answer({ refusal: "Never approved." }),
        answer({ failed: true }),
        {}
      ).isError
    ).toBe(true);
  });

  it("takes a plan that asks nothing of the server as its own answer", () => {
    expect(
      serverPairOf({ kind: "unchanged", to: 4 }, answer(), answer(), {}).pair
    ).toEqual({ kind: "unchanged", to: 4 });
    expect(
      serverPairOf(undefined, answer(), answer(), {}).pair
    ).toBeUndefined();
  });
});
