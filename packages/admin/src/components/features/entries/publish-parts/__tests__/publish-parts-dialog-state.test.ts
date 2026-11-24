/**
 * What "Choose what to publish" says beside its parts, decided apart from drawing it.
 *
 * The plausible broken versions: a hold read on an unpublish, which no review holds; the offer to
 * publish without review made for a hold it cannot go past, or to a person the server has not
 * allowed; a refusal said twice, once beside its hold and once below; a refusal that names no part
 * dropped instead of read; and a change since opening read as a general failure.
 */
import { describe, expect, it } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";
import type { PartReview } from "@admin/types/workflows";

import {
  dialogRefusals,
  holdingProblems,
  offersPublishWithoutReview,
  outcomesByLocale,
} from "../publish-parts-dialog-state";
import type { ReadyProblem } from "../ready-to-publish";

const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish" })[code] ?? code;

/** A part waiting in a stage that holds publishing, with no step this person may take. */
function heldPart(part: string | null): PartReview {
  return {
    part,
    stage: "review",
    stageLabel: "In review",
    stageColour: null,
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 1,
    version: null,
    reviewedVersionNo: null,
    steps: [],
    waitingFor: null,
    lastMove: null,
  };
}

const unapproved: ReadyProblem = {
  key: "part:es",
  text: "Spanish: not approved (In review)",
  unapproved: true,
};
const missingField: ReadyProblem = {
  key: "field:title",
  text: "Title is required.",
  unapproved: false,
};

function validationRefusal(
  errors: { path: string; code: string; message: string }[]
) {
  return parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "r1",
        data: { errors },
      },
    },
    400
  );
}

describe("what holds Publish", () => {
  const args = {
    choice: { locales: ["es"], shared: false },
    refusal: null,
    languages: ["en", "es"],
    labelOf,
  };

  it("names a chosen part that waits for approval", () => {
    const problems = holdingProblems({
      ...args,
      parts: [heldPart("es")],
      direction: "publish",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ unapproved: true });
    expect(problems[0]?.text).toContain("Spanish");
  });

  it("holds nothing on an unpublish, which no review holds", () => {
    expect(
      holdingProblems({
        ...args,
        parts: [heldPart("es")],
        direction: "unpublish",
      })
    ).toEqual([]);
  });

  it("holds nothing where no workflow is attached", () => {
    expect(
      holdingProblems({ ...args, parts: undefined, direction: "publish" })
    ).toEqual([]);
  });
});

describe("the offer to publish without review", () => {
  it("is made to a person who may, while a part waits for approval", () => {
    expect(offersPublishWithoutReview(true, [missingField, unapproved])).toBe(
      true
    );
  });

  it("is not made for a hold it cannot go past", () => {
    expect(offersPublishWithoutReview(true, [missingField])).toBe(false);
  });

  it("is not made to a person the server has not allowed, or where nothing says", () => {
    expect(offersPublishWithoutReview(false, [unapproved])).toBe(false);
    expect(offersPublishWithoutReview(undefined, [unapproved])).toBe(false);
  });
});

describe("the refusals read below the parts", () => {
  it("says nothing where nothing is refused", () => {
    expect(dialogRefusals(null, new Map(), [])).toEqual({
      messages: [],
      changedSince: false,
    });
  });

  it("lists a refusal no part names, but not one a hold already says", () => {
    const refusal = validationRefusal([
      { path: "", code: "REQUIRED", message: "Title is required." },
      { path: "", code: "FORBIDDEN", message: "You may not publish this." },
    ]);
    const refused = new Map([
      ["", ["Title is required.", "You may not publish this."]],
    ]);

    expect(dialogRefusals(refusal, refused, [missingField])).toEqual({
      messages: ["You may not publish this."],
      changedSince: false,
    });
  });

  it("reads a refusal that names no part in the server's words", () => {
    const refusal = parseApiError(
      {
        error: {
          code: "INTERNAL",
          message: "The publish could not start.",
          requestId: "r2",
        },
      },
      500
    );

    expect(dialogRefusals(refusal, new Map(), [])).toEqual({
      messages: ["The publish could not start."],
      changedSince: false,
    });
  });

  it("says a change since opening in words of its own, not as a failure", () => {
    const refusal = parseApiError(
      {
        error: {
          code: "STALE_VERSION",
          message: "Stale.",
          requestId: "r3",
          data: { currentVersion: "v2" },
        },
      },
      409
    );

    expect(dialogRefusals(refusal, new Map(), [])).toEqual({
      messages: [],
      changedSince: true,
    });
  });
});

describe("what each language will do", () => {
  it("is keyed by language, and empty before the server has said", () => {
    expect(outcomesByLocale(undefined).size).toBe(0);
    const outcomes = outcomesByLocale({
      id: "d1",
      languages: [{ locale: "es", outcome: "goes-live" }],
      shared: { changes: false, added: false },
    });
    expect(outcomes.get("es")).toEqual({ locale: "es", outcome: "goes-live" });
    expect(outcomes.has("en")).toBe(false);
  });
});
