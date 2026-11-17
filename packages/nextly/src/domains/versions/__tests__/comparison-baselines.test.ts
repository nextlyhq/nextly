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
  resolveComparisonPair,
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

describe("why a baseline has nothing to compare with", () => {
  /** The reason a request is refused with, as the reader is shown it. */
  async function refusalOf(
    baseline: string,
    to: number,
    history: PartVersion[]
  ): Promise<string> {
    const refused = await resolveComparisonPair(
      {
        ref,
        to,
        baseline,
        userId: null,
        partIsLive: () => Promise.resolve(true),
        lifecycle: true,
      },
      history
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(refused).toBeInstanceOf(NextlyError);
    const issues = (
      (refused as NextlyError).publicData as {
        errors: { code: string; message: string }[];
      }
    ).errors;
    expect(issues[0]?.code).toBe("NO_BASELINE");
    return issues[0]?.message ?? "";
  }

  // Said as a sentence about the document, never by quoting the name the
  // request used for the baseline, which a reader did not type.
  it("says a part's first version has nothing before it", async () => {
    const message = await refusalOf(
      "previous",
      1,
      versions([1, "draft", "en"])
    );
    expect(message).toBe(
      "Version 1 is the earliest version kept of this part of the document, so there is nothing before it to compare with."
    );
  });

  it("says there is no current draft, or that this is it", async () => {
    expect(await refusalOf("draft", 5, versions([5, "published", "en"]))).toBe(
      "This part of the document has no draft saved since it was last published, so there is no current draft to compare with."
    );
    expect(
      await refusalOf(
        "draft",
        6,
        versions([6, "draft", "en"], [5, "published", "en"])
      )
    ).toBe(
      "This is the current draft, so there is no other draft to compare it with."
    );
  });

  it("says nothing published is kept, or that this is what is published", async () => {
    expect(await refusalOf("published", 5, versions([5, "draft", "en"]))).toBe(
      "No published version of this part of the document is kept, so there is nothing published to compare with."
    );
    expect(
      await refusalOf("published", 5, versions([5, "published", "en"]))
    ).toBe(
      "This is the version that is published, so there is nothing else published to compare it with."
    );
  });

  it("names a registered baseline by its label when it gives no reason of its own", async () => {
    registerComparisonBaseline({
      name: "test-never",
      label: "Since the launch",
      resolve: () => null,
    });
    expect(await refusalOf("test-never", 5, versions([5, "draft", "en"]))).toBe(
      "Version 5 has no version to compare with for since the launch."
    );
  });
});
