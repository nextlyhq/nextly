/**
 * What the status-carrying Save and Publish buttons say, row by row and in
 * the order the rows are tried: each case is built so that every row above
 * the one it pins would also be wrong for it, so a row moved up or down the
 * table fails here.
 */
import { describe, expect, it } from "vitest";

import { lifeStage, LIFE_STAGE_LABEL } from "../panels/pill-state";
import {
  LAST_VISIT_NOTICE,
  publishButtonView,
  publishShown,
  saveButtonView,
  type PublishButtonInput,
  type SaveButtonInput,
} from "../save-publish-state";
import type { DocumentLifecycle } from "../useDocumentActionBindings";

const savedAt = new Date(Date.now() - 2 * 60 * 1000);

function saveInput(over: Partial<SaveButtonInput> = {}): SaveButtonInput {
  return {
    saveState: { kind: "saved", at: null },
    storingAction: null,
    failedAction: null,
    dirty: false,
    writesPending: false,
    writeFailure: null,
    pendingRecovery: false,
    savedAt,
    ...over,
  };
}

describe("the Save button, first match wins", () => {
  it("1. reads Saving… while a save runs, whatever else holds", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "saving" },
          storingAction: "save",
          dirty: true,
          pendingRecovery: true,
        })
      )
    ).toEqual({ kind: "saving", label: "Saving…" });
  });

  it("1. reads Saving… while a write the page depends on is in flight, Publish waiting for it", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "saving" },
          storingAction: "publish",
          writesPending: true,
        })
      ).kind
    ).toBe("saving");
  });

  it("leaves a publish under way to Publish: Save keeps what the work calls for", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "saving" },
          storingAction: "publish",
          dirty: true,
        })
      )
    ).toMatchObject({ kind: "save", label: "Save" });
    expect(
      saveButtonView(
        saveInput({ saveState: { kind: "saving" }, storingAction: "publish" })
      ).kind
    ).toBe("saved");
  });

  it("2. reads Retry save with the reason after a failed save, over unsaved work and an offer", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "failed", message: "Network refused." },
          failedAction: "save",
          dirty: true,
          pendingRecovery: true,
        })
      )
    ).toEqual({
      kind: "retry",
      label: "Retry save",
      tooltip: "Not saved: Network refused.",
      reason: "Network refused.",
    });
  });

  it("does not read Saving… for a write of the status alone, such as Unpublish", () => {
    expect(
      saveButtonView(saveInput({ saveState: { kind: "saving" } })).kind
    ).toBe("saved");
    expect(
      saveButtonView(
        saveInput({ saveState: { kind: "saving" }, pendingRecovery: true })
      ).kind
    ).toBe("saving");
  });

  it("2. reads Retry save for a failed Design write that followed a failed publish", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "failed", message: "Offline." },
          failedAction: "publish",
          writeFailure: "Site colours wasn't saved: offline.",
        })
      )
    ).toMatchObject({
      kind: "retry",
      reason: "Site colours wasn't saved: offline.",
    });
  });

  it("2. reads Retry save after a failed Design write too", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "failed", message: "Site colours wasn't saved" },
          failedAction: "save",
        })
      ).label
    ).toBe("Retry save");
  });

  it("leaves a failed publish to Publish: Save keeps its label", () => {
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "failed", message: "Offline" },
          failedAction: "publish",
        })
      ).kind
    ).toBe("saved");
    expect(
      saveButtonView(
        saveInput({
          saveState: { kind: "failed", message: "Offline" },
          failedAction: "publish",
          dirty: true,
        })
      ).kind
    ).toBe("save");
  });

  it("3. reads Save, saying changes from the last visit wait, while they do", () => {
    expect(saveButtonView(saveInput({ pendingRecovery: true }))).toEqual({
      kind: "offered",
      label: "Save",
      tooltip: LAST_VISIT_NOTICE,
    });
    expect(LAST_VISIT_NOTICE).toBe(
      "Changes from your last visit aren't saved yet"
    );
  });

  it("4. reads Save, with the shortcut, over unsaved work", () => {
    expect(
      saveButtonView(saveInput({ saveState: { kind: "unsaved" }, dirty: true }))
    ).toEqual({
      kind: "save",
      label: "Save",
      tooltip: "Save your changes (⌘S)",
    });
  });

  it("5. reads ✓ Saved, with when in its tooltip, when everything is stored", () => {
    expect(saveButtonView(saveInput())).toEqual({
      kind: "saved",
      label: "Saved",
      tooltip: "Saved 2 minutes ago",
    });
  });

  it("5. says the work is saved without an age where none is known", () => {
    expect(saveButtonView(saveInput({ savedAt: null }))).toMatchObject({
      tooltip: "Your changes are saved",
    });
  });
});

function life(over: Partial<DocumentLifecycle> = {}): DocumentLifecycle {
  return {
    hasStatus: true,
    draftsEnabled: true,
    canPublish: true,
    status: "published",
    hasWorkingDraft: false,
    everPublished: true,
    liveSince: new Date("2026-11-10T09:00:00Z"),
    ...over,
  };
}

function publishInput(
  over: Partial<PublishButtonInput> = {}
): PublishButtonInput {
  return {
    lifecycle: life(),
    dirty: false,
    storingAction: null,
    scheduled: null,
    ...over,
  };
}

const goesLive = new Date("2026-12-03T09:00:00Z");

describe("the Publish button, first match wins", () => {
  it("1. reads Publishing… while a publish runs, even when scheduled", () => {
    expect(
      publishButtonView(
        publishInput({ storingAction: "publish", scheduled: { at: goesLive } })
      )
    ).toEqual({ kind: "publishing", label: "Publishing…" });
  });

  it("does not read Publishing… while only a save runs", () => {
    expect(
      publishButtonView(publishInput({ storingAction: "save", dirty: true }))
        .label
    ).toBe("Publish changes");
  });

  it("2. reads Scheduled, with when it goes live, before history and working changes", () => {
    const view = publishButtonView(
      publishInput({
        scheduled: { at: goesLive },
        dirty: true,
        lifecycle: life({ hasWorkingDraft: true }),
      })
    );
    expect(view.kind).toBe("scheduled");
    expect(view.label).toBe("Scheduled");
    expect("tooltip" in view && view.tooltip).toMatch(/^Goes live /);
  });

  it("2. reads Scheduled for a page scheduled for its first publication", () => {
    expect(
      publishButtonView(
        publishInput({
          scheduled: { at: goesLive },
          lifecycle: life({
            status: "draft",
            everPublished: false,
            liveSince: null,
          }),
        })
      ).label
    ).toBe("Scheduled");
  });

  it("3. reads Publish for a page never published, though it has unsaved work", () => {
    expect(
      publishButtonView(
        publishInput({
          dirty: true,
          lifecycle: life({
            status: "draft",
            everPublished: false,
            liveSince: null,
          }),
        })
      )
    ).toEqual({
      kind: "publish",
      label: "Publish",
      tooltip: "Publish this page (saves first)",
    });
  });

  it("4. reads Publish for a page unpublished since it was live, from its status, not its history", () => {
    expect(
      publishButtonView(
        publishInput({
          dirty: true,
          lifecycle: life({
            status: "draft",
            hasWorkingDraft: true,
            liveSince: null,
          }),
        })
      )
    ).toEqual({
      kind: "publish",
      label: "Publish",
      tooltip: "This page isn't live · publish it (saves first)",
    });
  });

  it("5. reads Publish changes over unsaved work on a live page", () => {
    expect(publishButtonView(publishInput({ dirty: true }))).toEqual({
      kind: "publish-changes",
      label: "Publish changes",
      tooltip: "Put your changes on the live page",
    });
  });

  it("5. reads Publish changes for a live page with a saved working draft", () => {
    expect(
      publishButtonView(
        publishInput({ lifecycle: life({ hasWorkingDraft: true }) })
      ).label
    ).toBe("Publish changes");
  });

  it("6. reads Published, with when it went live, when the live page matches", () => {
    const view = publishButtonView(publishInput());
    expect(view.kind).toBe("published");
    expect(view.label).toBe("Published");
    expect("tooltip" in view && view.tooltip).toMatch(
      /^Live since .+ · the live page matches this version$/
    );
  });

  it("is shown only where the collection keeps drafts and the person may publish", () => {
    expect(publishShown(life())).toBe(true);
    expect(publishShown(life({ canPublish: false }))).toBe(false);
    // Without drafts, saving a live page publishes it, so Save leads alone;
    // a page not yet live keeps its way to go live.
    expect(publishShown(life({ draftsEnabled: false }))).toBe(false);
    expect(publishShown(life({ draftsEnabled: false, status: "draft" }))).toBe(
      true
    );
    expect(publishShown(life({ hasStatus: false }))).toBe(false);
  });
});

describe("the page's life stage", () => {
  it("is Draft, Published or Scheduled, never a word about the work", () => {
    expect(lifeStage("draft", false)).toBe("draft");
    expect(lifeStage("published", false)).toBe("published");
    expect(lifeStage("draft", true)).toBe("scheduled");
    expect(lifeStage("published", true)).toBe("scheduled");
    expect(Object.values(LIFE_STAGE_LABEL)).toEqual([
      "Draft",
      "Published",
      "Scheduled",
    ]);
  });
});
