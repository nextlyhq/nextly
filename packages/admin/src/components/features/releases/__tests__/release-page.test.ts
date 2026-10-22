/**
 * What a release's page says about the release as a whole: when it runs,
 * how ready it is, and how full it is.
 *
 * @module components/features/releases/__tests__/release-page.test
 */
import { describe, expect, it } from "vitest";

import type { ReleaseReadiness } from "@admin/types/releases";

import {
  commitBlockedBy,
  memberLimitLine,
  readinessHeadline,
  releaseWhenLine,
} from "../release-page";

const NOW = Date.parse("2026-10-14T04:00:00.000Z");
const KARACHI = { readerZone: "Asia/Karachi", now: NOW };

function plain(text: string | undefined): string | undefined {
  return text?.replace(/ /g, " ");
}

const base = {
  scheduledAt: "2026-10-17T14:00:00.000Z",
  timezone: "America/New_York",
  publishedAt: null,
  updatedAt: "2026-10-13T04:00:00.000Z",
};

describe("releaseWhenLine", () => {
  it("says when a scheduled release goes live, in the reader's zone and as scheduled", () => {
    const line = releaseWhenLine({ ...base, state: "scheduled" }, KARACHI);
    expect(line.lead).toBe("Goes live");
    expect(plain(line.time?.local)).toBe("Sat, Oct 17, 2026 7:00 PM");
    expect(plain(line.time?.scheduled?.text)).toBe("10:00 AM");
    expect(line.time?.scheduled?.zone).toBe("America/New_York");
  });

  it("says a stopped release was due, and a draft is not scheduled", () => {
    expect(releaseWhenLine({ ...base, state: "blocked" }, KARACHI).lead).toBe(
      "Was due"
    );
    expect(releaseWhenLine({ ...base, state: "draft" }, KARACHI)).toEqual({
      lead: "Not scheduled yet",
      time: null,
    });
  });

  it("says when a published release went out, in the reader's zone alone", () => {
    const line = releaseWhenLine(
      { ...base, state: "published", publishedAt: "2026-10-13T04:00:00.000Z" },
      KARACHI
    );
    expect(line.lead).toBe("Went live");
    expect(line.time?.scheduled).toBeNull();
    expect(line.time?.relative).toBe("1 day ago");
  });
});

const finding = (memberId: string) => ({
  memberId,
  code: "DOCUMENT_GONE",
  source: "core.exists",
  action: "publish" as const,
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: memberId,
});

const READY: ReleaseReadiness = { releaseId: "r1", hard: [], soft: [] };

describe("readinessHeadline", () => {
  it("counts documents ready, the hidden ones included", () => {
    const headline = readinessHeadline({ state: "draft" }, 6, {
      ...READY,
      hard: [finding("m1"), finding("m1")],
      hidden: [
        {
          scopeKind: "collection",
          scopeSlug: "secret",
          count: 2,
          hard: 1,
          soft: 0,
        },
      ],
    });
    expect(headline.tone).toBe("fix");
    expect(headline.lead).toBe("4 of 6 ready.");
    expect(headline.detail).toBe(
      "2 need a fix before this release can be scheduled or published."
    );
  });

  it("says a ready release is ready, with its notes beside it", () => {
    const headline = readinessHeadline({ state: "draft" }, 3, {
      ...READY,
      soft: [finding("m1"), finding("m2")],
    });
    expect(headline).toMatchObject({
      tone: "ready",
      lead: "All 3 ready.",
      detail: "2 documents have notes, which won't stop it.",
    });
  });

  it("says a stopped release will not run on its own", () => {
    expect(
      readinessHeadline({ state: "blocked" }, 2, {
        ...READY,
        hard: [finding("m1")],
      })
    ).toMatchObject({
      tone: "stopped",
      detail: "1 needs a fix. Once fixed, schedule it again.",
    });
  });
});

describe("commitBlockedBy", () => {
  it("holds scheduling back while a document needs a fix, and only then", () => {
    expect(commitBlockedBy({ hard: [finding("m1")] }, 3)).toBe(
      "Fix the document marked below first."
    );
    expect(
      commitBlockedBy(
        {
          hard: [],
          hidden: [
            {
              scopeKind: "collection",
              scopeSlug: "s",
              count: 2,
              hard: 2,
              soft: 0,
            },
          ],
        },
        3
      )
    ).toBe("Fix the 2 documents marked below first.");
    expect(commitBlockedBy({ hard: [] }, 3)).toBeNull();
    // Not yet checked is not a reason: the server judges when asked.
    expect(commitBlockedBy(undefined, 3)).toBeNull();
  });
});

describe("memberLimitLine", () => {
  it("says a release is full at the limit, and over it when made before it", () => {
    expect(memberLimitLine(199)).toBeNull();
    expect(memberLimitLine(200)).toBe(
      "This release holds its limit of 200 documents."
    );
    expect(memberLimitLine(240)).toMatch(
      /^This release holds 240 documents, more than the 200 a release may now hold\./
    );
  });
});
