/**
 * Another core feature adds a comparison baseline without changing the history
 * code: Workflows registers "since submitted" and "since approved".
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  comparisonBaselineNames,
  registerComparisonBaseline,
  resolveComparisonBaseline,
  type PartVersion,
} from "../comparison-baselines";

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function versions(
  ...rows: [number, "draft" | "published", string | null][]
): PartVersion[] {
  // Newest first, as the history is read.
  return rows.map(([versionNo, status, locale]) => ({
    versionNo,
    status,
    locale,
  }));
}

describe("comparison baselines", () => {
  it("offers the core baselines", () => {
    expect(comparisonBaselineNames()).toEqual(
      expect.arrayContaining(["previous", "published", "draft"])
    );
  });

  it("lets a feature add a baseline, and resolves through it", async () => {
    registerComparisonBaseline({
      name: "test-oldest",
      label: "Oldest in this language",
      resolve: ({ versions: inPart }) =>
        inPart.length > 0 ? inPart[inPart.length - 1].versionNo : null,
    });

    expect(comparisonBaselineNames()).toContain("test-oldest");
    await expect(
      resolveComparisonBaseline("test-oldest", {
        ref,
        part: "en",
        target: 9,
        userId: null,
        lifecycle: true,
        live: true,
        versions: versions(
          [9, "draft", "en"],
          [5, "published", "en"],
          [2, "draft", "en"]
        ),
      })
    ).resolves.toBe(2);
  });

  it("refuses a second baseline under a name already taken", () => {
    expect(() =>
      registerComparisonBaseline({
        name: "previous",
        label: "Mine",
        resolve: () => null,
      })
    ).toThrow(/already registered/);
  });

  it("refuses a name that is not kebab-case", () => {
    for (const name of ["Since Approved", "since_approved", "", "-x"]) {
      expect(() =>
        registerComparisonBaseline({ name, label: "x", resolve: () => null })
      ).toThrow(NextlyError);
    }
  });

  it("has nothing currently published in a part that is not live", async () => {
    // A withdrawn part keeps its last published version in its history.
    const history = versions([9, "draft", "en"], [5, "published", "en"]);
    const context = {
      ref,
      part: "en",
      target: 9,
      userId: null,
      lifecycle: true,
    };
    await expect(
      resolveComparisonBaseline("published", {
        ...context,
        live: true,
        versions: history,
      })
    ).resolves.toBe(5);
    await expect(
      resolveComparisonBaseline("published", {
        ...context,
        live: false,
        versions: history,
      })
    ).resolves.toBeNull();
  });

  it("finds the published version of a document without the lifecycle, whatever its own status says", async () => {
    // Without the lifecycle a version records the document's own status, and
    // what was saved is what readers were served.
    // A word the lifecycle also uses means nothing to it here.
    for (const word of ["draft", "unpublished"]) {
      const history: PartVersion[] = [
        { versionNo: 9, status: word, locale: "en" },
        { versionNo: 5, status: word, locale: "en" },
      ];
      await expect(
        resolveComparisonBaseline("published", {
          ref,
          part: "en",
          target: 5,
          userId: null,
          live: true,
          lifecycle: false,
          versions: history,
        })
      ).resolves.toBe(9);
      // And none is a draft.
      await expect(
        resolveComparisonBaseline("draft", {
          ref,
          part: "en",
          target: 5,
          userId: null,
          live: true,
          lifecycle: false,
          versions: history,
        })
      ).resolves.toBeNull();
    }
  });

  it("only offers versions of the part being compared", async () => {
    // A German version is never another language's "previous".
    await expect(
      resolveComparisonBaseline("previous", {
        ref,
        part: "en",
        target: 9,
        userId: null,
        lifecycle: true,
        live: true,
        versions: versions(
          [9, "draft", "en"],
          [8, "draft", "de"],
          [4, "draft", "en"]
        ),
      })
    ).resolves.toBe(4);
  });
});
