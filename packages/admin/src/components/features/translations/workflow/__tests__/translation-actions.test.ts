/**
 * What a person may do with one language from its translation page: which
 * action leads, which stand beside it, and which are held and why, with the
 * verbs that act on the language named for it.
 */
import { describe, expect, it } from "vitest";

import {
  HISTORY_REASON,
  type ReviewActionState,
  type ReviewStepState,
} from "@admin/components/features/entries/EntryForm/document-actions";

import {
  translationActions,
  type TranslationActionFacts,
} from "../translation-actions";

/** A draft in a language with a lifecycle, to a person who may do it all. */
function facts(
  over: Partial<TranslationActionFacts> = {}
): TranslationActionFacts {
  return {
    languageLabel: "Spanish",
    hasStatus: true,
    holdsDrafts: true,
    status: "draft",
    pendingChange: false,
    canEdit: true,
    canPublish: true,
    isDirty: false,
    readingHistory: false,
    writesRefused: false,
    review: undefined,
    ...over,
  };
}

/** The editor's verbs on the whole document, which this page never wires. */
const NOT_WIRED: ReadonlySet<string> = new Set([
  "view-api",
  "discard-draft",
  "discard-changes",
  "unpublish",
  "delete",
]);

/** Where an action is drawn, its id, what it says, and why it is held. */
type Offered = [
  placement: string,
  id: string,
  label: string,
  reason: string | null,
];

/** The actions the page draws, in order. */
function offered(over: Partial<TranslationActionFacts> = {}): Offered[] {
  return translationActions(facts(over))
    .filter(action => !NOT_WIRED.has(action.id))
    .map(action => [
      action.placement,
      action.id,
      action.label,
      action.disabledReason ?? null,
    ]);
}

const SUBMIT: ReviewStepState = {
  name: "submit",
  label: "Submit for review",
  kind: "submit",
  held: true,
  primary: true,
};

const APPROVE: ReviewStepState = {
  name: "approve",
  label: "Approve",
  kind: "approve",
  held: true,
  primary: true,
};

const REQUEST_CHANGES: ReviewStepState = {
  name: "requestChanges",
  label: "Request changes…",
  kind: "request-changes",
  held: true,
  primary: false,
};

/** Being written: a stage that does not allow publishing. */
function drafting(over: Partial<ReviewActionState> = {}): ReviewActionState {
  return {
    stageLabel: "Drafting",
    publishable: false,
    steps: [SUBMIT],
    waitingFor: null,
    ...over,
  };
}

/** Waiting for approval, with whether the person may take its steps. */
function inReview(
  held: boolean,
  over: Partial<ReviewActionState> = {}
): ReviewActionState {
  return {
    stageLabel: "In review",
    publishable: false,
    steps: [
      { ...APPROVE, held },
      { ...REQUEST_CHANGES, held },
    ],
    waitingFor: "Editors",
    ...over,
  };
}

/** Approved: a stage that allows publishing. */
function approved(held: boolean): ReviewActionState {
  return {
    stageLabel: "Approved",
    publishable: true,
    steps: [{ ...REQUEST_CHANGES, held }],
    waitingFor: null,
  };
}

const NEEDS_APPROVAL = "Needs approval: In review, waiting for Editors";

describe("a language's actions where no workflow holds it", () => {
  it("leads a draft with its publish, its save on the menu", () => {
    expect(offered()).toEqual([
      ["primary", "publish", "Publish Spanish", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("leads a draft with its save for a person who may not publish it", () => {
    expect(offered({ canPublish: false })).toEqual([
      ["primary", "save", "Save Spanish", null],
    ]);
  });

  it.each([true, false])(
    "leads a live language with nothing pending with its save (holds drafts: %s)",
    holdsDrafts => {
      expect(offered({ status: "published", holdsDrafts })).toEqual([
        ["primary", "save", "Save Spanish", null],
      ]);
    }
  );

  it("leads a live language's pending change with Publish Spanish, in place of Publish changes", () => {
    expect(offered({ status: "published", pendingChange: true })).toEqual([
      ["primary", "publish", "Publish Spanish", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("leads a live language's pending change with its save for a person who may not publish it", () => {
    expect(
      offered({ status: "published", pendingChange: true, canPublish: false })
    ).toEqual([["primary", "save", "Save Spanish", null]]);
  });

  it("offers the save alone where the type has no lifecycle", () => {
    expect(offered({ hasStatus: false, status: undefined })).toEqual([
      ["primary", "save", "Save Spanish", null],
    ]);
  });

  it("treats a language with no content yet as a draft: nothing of it is live", () => {
    expect(offered({ status: undefined })).toEqual([
      ["primary", "publish", "Publish Spanish", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("names each action for the language the page writes", () => {
    expect(offered({ languageLabel: "Arabic" })).toEqual([
      ["primary", "publish", "Publish Arabic", null],
      ["publish-menu", "save", "Save Arabic", null],
    ]);
  });
});

describe("a language's actions while a workflow holds it", () => {
  it("leads a writer with the submission, their save on the menu", () => {
    expect(offered({ canPublish: false, review: drafting() })).toEqual([
      ["primary", "review-step:submit", "Submit for review", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("offers the save once to a writer who may publish too, and no publish beside the step", () => {
    expect(offered({ review: drafting() })).toEqual([
      ["primary", "review-step:submit", "Submit for review", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("leads a reviewer who may not edit with the approval, asking for changes beside it", () => {
    expect(
      offered({ canEdit: false, canPublish: false, review: inReview(true) })
    ).toEqual([
      ["primary", "review-step:approve", "Approve", null],
      ["toolbar", "review-step:requestChanges", "Request changes…", null],
    ]);
  });

  it("puts every other step on the main button's menu", () => {
    const review = inReview(true, {
      steps: [
        APPROVE,
        REQUEST_CHANGES,
        {
          name: "legal",
          label: "Send to legal",
          kind: "move",
          held: true,
          primary: false,
        },
      ],
    });
    expect(offered({ canEdit: false, canPublish: false, review })).toEqual([
      ["primary", "review-step:approve", "Approve", null],
      ["toolbar", "review-step:requestChanges", "Request changes…", null],
      ["publish-menu", "review-step:legal", "Send to legal", null],
    ]);
  });

  it("leads with no step the person may not take", () => {
    const review = inReview(false, {
      steps: [{ ...APPROVE, held: false }, REQUEST_CHANGES],
    });
    expect(offered({ canEdit: false, canPublish: false, review })).toEqual([
      ["toolbar", "review-step:requestChanges", "Request changes…", null],
    ]);
  });

  it("leaves a step's own words as they are, the languages' verbs notwithstanding", () => {
    const review = drafting({
      steps: [{ ...SUBMIT, name: "publish", label: "Publish" }],
    });
    expect(offered({ canPublish: false, review })[0]).toEqual([
      "primary",
      "review-step:publish",
      "Publish",
      null,
    ]);
  });

  it("holds a publisher's publish until the language is approved, saying who it waits for", () => {
    expect(offered({ review: inReview(false) })).toEqual([
      ["primary", "publish", "Publish Spanish", NEEDS_APPROVAL],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("holds the publish of a live language's pending change the same way", () => {
    expect(
      offered({
        status: "published",
        pendingChange: true,
        review: inReview(false),
      })
    ).toEqual([
      ["primary", "publish", "Publish Spanish", NEEDS_APPROVAL],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("names the stage alone where the language waits for no one", () => {
    expect(
      offered({ review: inReview(false, { waitingFor: null }) })[0]
    ).toEqual([
      "primary",
      "publish",
      "Publish Spanish",
      "Needs approval: In review",
    ]);
  });

  it("frees the publish once the language is approved", () => {
    expect(offered({ review: approved(false) })).toEqual([
      ["primary", "publish", "Publish Spanish", null],
      ["publish-menu", "save", "Save Spanish", null],
    ]);
  });

  it("puts asking for changes in More once the language is approved", () => {
    expect(offered({ review: approved(true) })).toEqual([
      ["primary", "publish", "Publish Spanish", null],
      ["publish-menu", "save", "Save Spanish", null],
      ["menu", "review-step:requestChanges", "Request changes…", null],
    ]);
  });

  it("holds every step for what stops one at this moment, and leaves the save free", () => {
    const stepReason = "Save your changes first.";
    expect(
      offered({
        canPublish: false,
        isDirty: true,
        review: inReview(true, { stepReason }),
      })
    ).toEqual([
      ["primary", "review-step:approve", "Approve", stepReason],
      ["publish-menu", "save", "Save Spanish", null],
      ["toolbar", "review-step:requestChanges", "Request changes…", stepReason],
    ]);
  });

  it("leaves the actions of a type with no lifecycle as they are without one", () => {
    expect(offered({ hasStatus: false, review: inReview(true) })).toEqual(
      offered({ hasStatus: false })
    );
  });
});

describe("a language's actions where the person may not write it", () => {
  it("offers nothing on a read-only draft", () => {
    expect(offered({ canEdit: false, canPublish: false })).toEqual([]);
  });

  it("offers the publish alone to a person who may publish and not edit", () => {
    expect(offered({ canEdit: false })).toEqual([
      ["primary", "publish", "Publish Spanish", null],
    ]);
    expect(
      offered({ canEdit: false, status: "published", pendingChange: true })
    ).toEqual([["primary", "publish", "Publish Spanish", null]]);
  });

  it("offers nothing of a live language with nothing pending", () => {
    expect(offered({ canEdit: false, status: "published" })).toEqual([]);
  });

  it.each([
    ["where no workflow holds it", undefined],
    ["while it waits for approval", inReview(true)],
    ["once it is approved", approved(true)],
  ])("offers no write where every write is refused, %s", (_when, review) => {
    // Someone who may otherwise do everything: the refusal alone decides.
    expect(offered({ review })).not.toEqual([]);

    const actions = translationActions(facts({ writesRefused: true, review }));
    expect(actions.map(action => action.id)).toEqual(["view-api"]);
  });
});

describe("a language's actions while a past version is on screen", () => {
  it("holds the publish and the save, saying a past version is on screen", () => {
    expect(offered({ readingHistory: true })).toEqual([
      ["primary", "publish", "Publish Spanish", HISTORY_REASON],
      ["publish-menu", "save", "Save Spanish", HISTORY_REASON],
    ]);
  });

  it("holds every step and the save beside them", () => {
    expect(
      offered({
        canPublish: false,
        readingHistory: true,
        review: inReview(true),
      })
    ).toEqual([
      ["primary", "review-step:approve", "Approve", HISTORY_REASON],
      ["publish-menu", "save", "Save Spanish", HISTORY_REASON],
      [
        "toolbar",
        "review-step:requestChanges",
        "Request changes…",
        HISTORY_REASON,
      ],
    ]);
  });

  it("says so ahead of the approval a publish waits for", () => {
    expect(
      offered({ readingHistory: true, review: inReview(false) })[0]
    ).toEqual(["primary", "publish", "Publish Spanish", HISTORY_REASON]);
  });
});
